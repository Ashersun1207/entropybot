import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { BEFORE_CAP, adoptMemoryJournal, beginMemoryTurn, endMemoryTurn, recordMemoryChange, flushAllMemoryJournals, flushMemoryJournal, journalFile, journalMemoryDelete, journalMemoryWrite, journalTurnWrite, readMemoryJournal, revertMemoryChange } from "./memory-journal.ts";
import { MEMORY_INDEX, hashMemoryText, readMemoryDoc } from "./memory-store.ts";
import { ensureWorkspace, syncMemoryIndex, workspaceDir } from "./workspace.ts";
import { memoryFileDocuments, memoryVectorRows, searchMemoryBigram, upsertMemoryVector } from "./message-db.ts";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, readFileSync: vi.fn(fs.readFileSync) };
});
afterEach(() => vi.mocked(readFileSync).mockRestore());
afterAll(flushAllMemoryJournals);
let sequence = 0;
const actor = { actor: "person" as const, via: "ui" };

it.each([
  { kind: "edited", later: "C\r\nUnrelated 新事实\n", path: "memory/edit.md" },
  { kind: "created", later: "new fact", path: "memory/topic.md" },
  { kind: "created", later: "new core fact", path: MEMORY_INDEX },
  { kind: "deleted", later: "recreated", path: "memory/deleted.md" },
  { kind: "deleted", later: "", path: "memory/deleted-empty.md" },
  { kind: "edited", later: null, path: "memory/missing-edit.md" },
  { kind: "created", later: null, path: "memory/missing-create.md" },
  { kind: "edited", later: null, path: MEMORY_INDEX },
  { kind: "created", later: null, path: MEMORY_INDEX },
])("refuses stale $kind of $path with later=$later and preserves exact bytes and audit", async ({ kind, later, path }) => {
  const bot = `revert-conflict-${sequence++}`;
  ensureWorkspace(bot);
  if (kind === "created") rmSync(join(workspaceDir(bot), path), { force: true });
  else journalMemoryWrite(bot, path, "A", actor);
  let entry;
  if (kind === "created" && path === MEMORY_INDEX) {
    journalTurnWrite(bot, path, "synthetic-core", () => writeFileSync(join(workspaceDir(bot), path), "B"));
    await flushMemoryJournal(bot);
    entry = readMemoryJournal(bot, 1)[0];
  } else entry = kind === "deleted" ? journalMemoryDelete(bot, path, actor) : journalMemoryWrite(bot, path, later === null ? "" : "B", actor).entry;
  expect(entry?.kind).toBe(kind);
  if (later === null) rmSync(join(workspaceDir(bot), path));
  else journalMemoryWrite(bot, path, later, actor);
  await flushMemoryJournal(bot);
  const before = readMemoryDoc(bot, path);
  syncMemoryIndex(bot);
  upsertMemoryVector(bot, path, "synthetic", before.hash, new Float32Array([1, 0]));
  const projections = () => ({ files: memoryFileDocuments(bot), vectors: memoryVectorRows(bot, "synthetic"), hits: searchMemoryBigram(bot, "fact", 10) });
  const cached = projections();
  const journal = readFileSync(journalFile(bot));
  expect(revertMemoryChange(bot, entry!.id)).toMatchObject({ ok: false, status: 409 });
  await flushMemoryJournal(bot);
  expect(readMemoryDoc(bot, path)).toEqual(before);
  expect(projections()).toEqual(cached);
  expect(readFileSync(journalFile(bot))).toEqual(journal);
});

it.each(["edited", "created", "deleted"])("rechecks %s at the actual store read after a successful preflight", async (kind) => {
  const bot = `revert-boundary-${sequence++}`, path = "memory/boundary.md";
  if (kind !== "created") journalMemoryWrite(bot, path, "A", actor);
  const entry = kind === "deleted" ? journalMemoryDelete(bot, path, actor) : journalMemoryWrite(bot, path, "B", actor).entry;
  await flushMemoryJournal(bot);
  const journal = readFileSync(journalFile(bot));
  const realRead = vi.mocked(readFileSync).getMockImplementation()!;
  let intercepted = false, reads = 0;
  vi.mocked(readFileSync).mockImplementation((...args: Parameters<typeof readFileSync>) => {
    if (!intercepted && args[0] === join(workspaceDir(bot), path) && ++reads === (kind === "created" ? 1 : 2)) {
      intercepted = true;
      try { return realRead(...args); }
      finally { writeFileSync(join(workspaceDir(bot), path), "interleaved current bytes\r\n"); }
    }
    return realRead(...args);
  });
  expect(revertMemoryChange(bot, entry!.id)).toMatchObject({ ok: false, status: 409 });
  expect(intercepted).toBe(true);
  await flushMemoryJournal(bot);
  expect(readMemoryDoc(bot, path).text).toBe("interleaved current bytes\r\n");
  expect(readFileSync(journalFile(bot))).toEqual(journal);
});

it.each([
  ...[undefined, null, "", "bad", "f".repeat(63)].map((afterHash) => ({ afterHash, deleted: false })),
  ...[undefined, "", "bad", "f".repeat(64)].map((afterHash) => ({ afterHash, deleted: true })),
])("refuses invalid expected afterHash $afterHash (deleted=$deleted) without guessing current state", async ({ afterHash, deleted }) => {
  const bot = `revert-invalid-${sequence++}`, path = "memory/invalid.md";
  journalMemoryWrite(bot, path, "A", actor);
  const entry = deleted ? journalMemoryDelete(bot, path, actor) : journalMemoryWrite(bot, path, "B", actor).entry;
  await flushMemoryJournal(bot);
  const rows = readMemoryJournal(bot);
  writeFileSync(journalFile(bot), rows.reverse().map((row) => JSON.stringify(row.id === entry!.id ? { ...row, afterHash } : row)).join("\n") + "\n");
  const journal = readFileSync(journalFile(bot));
  expect(revertMemoryChange(bot, entry!.id)).toMatchObject({ ok: false, status: 409 });
  await flushMemoryJournal(bot);
  expect(readMemoryDoc(bot, path)).toMatchObject({ text: deleted ? "" : "B", exists: !deleted });
  expect(readFileSync(journalFile(bot))).toEqual(journal);
});

const inconsistentRows = [
  { name: "unknown kind", kind: "edited", patch: { kind: "unknown-operation" } },
  ...[undefined, null, 7, { text: "A" }].map((before) => ({ name: `edited before ${JSON.stringify(before)}`, kind: "edited", patch: { before } })),
  ...[undefined, null, 7].map((before) => ({ name: `deleted before ${JSON.stringify(before)}`, kind: "deleted", patch: { before } })),
  ...["edited", "deleted"].flatMap((kind) => [undefined, null, "", "nonhex", "F".repeat(64), hashMemoryText("different retained before")].map((beforeHash) => ({ name: `${kind} beforeHash ${beforeHash}`, kind, patch: { beforeHash } }))),
  { name: "created unexpected before", kind: "created", patch: { before: "A" } },
  { name: "created missing before", kind: "created", patch: { before: undefined } },
  { name: "created unexpected beforeHash", kind: "created", patch: { beforeHash: hashMemoryText("A") } },
  { name: "created missing beforeHash", kind: "created", patch: { beforeHash: undefined } },
  { name: "created null afterHash", kind: "created", patch: { afterHash: null } },
  { name: "edited null afterHash", kind: "edited", patch: { afterHash: null } },
  { name: "deleted nonnull afterHash", kind: "deleted", patch: { afterHash: hashMemoryText("") } },
];

it.each(inconsistentRows)("refuses persisted inconsistent metadata: $name", async ({ name, kind, patch }) => {
  const bot = `revert-inconsistent-${sequence++}`, path = "memory/inconsistent.md", thread = `${bot}-turn`;
  if (kind !== "created") journalMemoryWrite(bot, path, "A: retained old fact\r\n", actor);
  const selected = kind === "deleted" ? journalMemoryDelete(bot, path, actor) : journalMemoryWrite(bot, path, "B: current fact\r\n", actor).entry;
  await flushMemoryJournal(bot);
  const rows = readMemoryJournal(bot).reverse();
  writeFileSync(journalFile(bot), rows.map((row) => JSON.stringify(row.id === selected!.id ? { ...row, ...patch } : row)).join("\n") + "\n");
  expect(readMemoryJournal(bot).find((row) => row.id === selected!.id)).toBeDefined();
  beginMemoryTurn(bot, thread);
  await flushMemoryJournal(bot);
  syncMemoryIndex(bot);
  const current = readMemoryDoc(bot, path);
  upsertMemoryVector(bot, path, "synthetic", current.hash, new Float32Array([1, 0]));
  const projections = () => ({ files: memoryFileDocuments(bot), vectors: memoryVectorRows(bot, "synthetic"), hits: searchMemoryBigram(bot, "current fact", 10) });
  const cached = projections();
  const journal = readFileSync(journalFile(bot));
  const beforeBytes = current.exists ? readFileSync(join(workspaceDir(bot), path)) : null;
  let result: unknown;
  try { result = revertMemoryChange(bot, selected!.id); }
  catch (error) { result = { threw: error instanceof Error ? error.name : "unknown" }; }
  await flushMemoryJournal(bot);
  const afterBytes = readMemoryDoc(bot, path).exists ? readFileSync(join(workspaceDir(bot), path)) : null;
  const boundaryRows = endMemoryTurn(thread);
  await flushMemoryJournal(bot);
  console.log(JSON.stringify({ phase: "persisted-journal-consistency", name, result, docPreserved: beforeBytes === null ? afterBytes === null : beforeBytes.equals(afterBytes ?? Buffer.alloc(0)), journalPreserved: readFileSync(journalFile(bot)).equals(journal), beforeHash: current.exists ? current.hash : null, afterHash: afterBytes === null ? null : hashMemoryText(afterBytes.toString("utf8")) }));
  expect(result).toEqual({ ok: false, status: 409, error: "This journal entry is inconsistent. Reread and review the current memory before undoing." });
  expect(afterBytes).toEqual(beforeBytes);
  expect(boundaryRows).toEqual([]);
  expect(readFileSync(journalFile(bot))).toEqual(journal);
  expect(projections()).toEqual(cached);
});

it.each(["edited", "created", "deleted"])("keeps empty-string before/after states valid for latest %s undo and undo-of-revert", async (kind) => {
  const bot = `revert-empty-${sequence++}`, path = "memory/empty.md";
  if (kind !== "created") journalMemoryWrite(bot, path, "", actor);
  const selected = kind === "deleted" ? journalMemoryDelete(bot, path, actor) : journalMemoryWrite(bot, path, "B", actor).entry;
  await flushMemoryJournal(bot);
  expect(revertMemoryChange(bot, selected!.id).ok).toBe(true);
  await flushMemoryJournal(bot);
  expect(readMemoryDoc(bot, path)).toMatchObject({ exists: kind !== "created", text: "" });
  const [undo] = readMemoryJournal(bot);
  expect(undo.via).toBe("revert");
  expect(revertMemoryChange(bot, undo.id).ok).toBe(true);
  await flushMemoryJournal(bot);
  expect(readMemoryDoc(bot, path)).toMatchObject({ exists: kind !== "deleted", text: kind === "deleted" ? "" : "B" });
  expect(readMemoryJournal(bot).slice(0, 3).map((row) => row.id)).toEqual([readMemoryJournal(bot)[0].id, undo.id, selected!.id]);
});

it.each(["redacted", "over-cap"])("keeps the existing 400 refusal before consistency validation for %s retained before", async (reason) => {
  const bot = `revert-unavailable-${sequence++}`, path = "memory/unavailable.md";
  journalMemoryWrite(bot, path, "B", actor);
  const before = reason === "over-cap" ? "A".repeat(BEFORE_CAP + 1) : "token: sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH\n";
  const entry = recordMemoryChange(bot, { path, ...actor, before, after: "B" })!;
  await flushMemoryJournal(bot);
  expect(entry.canRevert).toBe(false);
  const journal = readFileSync(journalFile(bot));
  expect(revertMemoryChange(bot, entry.id)).toEqual({ ok: false, status: 400, error: entry.revertUnavailableReason });
  await flushMemoryJournal(bot);
  expect(readMemoryDoc(bot, path).text).toBe("B");
  expect(readFileSync(journalFile(bot))).toEqual(journal);
});

it("undoes an actual core creation, then undoes that revert without losing chronology", async () => {
  const bot = `revert-core-latest-${sequence++}`;
  ensureWorkspace(bot);
  const absolute = join(workspaceDir(bot), MEMORY_INDEX);
  rmSync(absolute);
  journalTurnWrite(bot, MEMORY_INDEX, "synthetic-create", () => writeFileSync(absolute, "core B"));
  await flushMemoryJournal(bot);
  const [created] = readMemoryJournal(bot);
  expect(created.kind).toBe("created");
  const reverted = revertMemoryChange(bot, created.id);
  expect(reverted.ok).toBe(true);
  expect(readMemoryDoc(bot, MEMORY_INDEX)).toMatchObject({ exists: true, text: "" });
  await flushMemoryJournal(bot);
  const [undo] = readMemoryJournal(bot);
  expect(undo).toMatchObject({ kind: "edited", via: "revert", before: "core B" });
  expect(revertMemoryChange(bot, undo.id).ok).toBe(true);
  await flushMemoryJournal(bot);
  expect(readMemoryDoc(bot, MEMORY_INDEX).text).toBe("core B");
  expect(readMemoryJournal(bot).map((row) => row.via)).toEqual(["revert", "revert", "turn"]);
});

it("still refuses imported entries and retains their audit rows", async () => {
  const source = `revert-import-source-${sequence++}`, target = `revert-import-target-${sequence++}`;
  journalMemoryWrite(source, "memory/import.md", "earlier local", actor);
  journalMemoryWrite(source, "memory/import.md", "local", actor);
  await flushMemoryJournal(source);
  await adoptMemoryJournal(target, readMemoryJournal(source, 1));
  const [entry] = readMemoryJournal(target);
  expect(entry.kind).toBe("edited");
  const journal = readFileSync(journalFile(target));
  expect(entry.canRevert).toBe(false);
  expect(revertMemoryChange(target, entry.id)).toMatchObject({ ok: false, status: 400 });
  await flushMemoryJournal(target);
  expect(readFileSync(journalFile(target))).toEqual(journal);
  expect(readMemoryDoc(target, entry.path).exists).toBe(false);
});
