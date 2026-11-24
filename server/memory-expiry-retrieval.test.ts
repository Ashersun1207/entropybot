import { readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DATA_DIR } from "./config.ts";
import { closeMessageDb, memoryFileDocuments } from "./message-db.ts";
import { buildRecall } from "./recall.ts";
import { ensureWorkspace, searchMemoryFiles, syncMemoryIndex, workspaceDir, writeMemoryTopic } from "./workspace.ts";

const BOT = "expiry-retrieval-fixture";
const PATH = "memory/launch.md";
const CONTINUATION = "Obsoletecontinuationcanary";
const CODE = "Obsoletefencedcanary";
const LIVE = "Liveadjacentcanary";
const TODAY = "Samedaycanary";
const HAND = "Handwrittencontrolcanary";
const source = [
  "---", "title: Launch", "aliases: [flightdeck]", "---",
  '- 2026-09-01 · from chat "Synthetic source" · Old deployment · until 2026-09-14',
  `  ${CONTINUATION}`, "```sh", CODE, "```",
  `- 2026-09-01 · from chat "Synthetic source" · ${LIVE}`,
  `- 2026-09-01 · ${TODAY} · until 2026-09-15`,
  `  ${TODAY} continuation`,
  HAND, "",
].join("\n");
const recall = (message: string) => buildRecall({ botId: BOT, message, threadIds: [], label: () => { throw new Error("history must not be read"); }, author: () => { throw new Error("history must not be read"); } });
const document = () => memoryFileDocuments(BOT).find(doc => doc.path === PATH)!;
const rawPath = () => join(workspaceDir(BOT), PATH);

beforeEach(() => {
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 15, 12));
  ensureWorkspace(BOT);
  writeMemoryTopic(BOT, "launch.md", source);
});
afterEach(() => vi.useRealTimers());

it("filters full expired spans from the actual index, file search and lexical recall", async () => {
  const original = readFileSync(rawPath());
  syncMemoryIndex(BOT);
  const text = document().text;
  for (const hidden of [CONTINUATION, CODE, "Old deployment"]) {
    expect(text).not.toContain(hidden);
    expect(searchMemoryFiles(BOT, hidden)).toEqual([]);
    expect(await recall(hidden)).toBeNull();
  }
  for (const retained of [LIVE, TODAY, HAND]) {
    expect(text).toContain(retained);
    expect(searchMemoryFiles(BOT, retained).map(hit => hit.file)).toContain(PATH);
    const result = await recall(retained);
    expect(result?.text).toContain(PATH);
    expect(result?.text).toContain(retained);
    expect(result?.conversations).toBe(0);
  }
  expect(text).toContain('from chat "Synthetic source"');
  expect(readFileSync(rawPath())).toEqual(original);
});

it("filters named-topic alias passages even when the body does not match the query", async () => {
  expect(searchMemoryFiles(BOT, "flightdecks")).toEqual([]);
  const result = await recall("flightdecks");
  expect(result?.notes).toBe(1);
  expect(result?.conversations).toBe(0);
  expect(result?.text).toContain(PATH);
  expect(result?.text).toContain(LIVE);
  expect(result?.text).toContain(TODAY);
  expect(result?.text).toContain(HAND);
  expect(result?.text).not.toContain(CONTINUATION);
  expect(result?.text).not.toContain(CODE);
  expect(readFileSync(rawPath(), "utf8")).toBe(source);
});

it("reprojects the local index on day rollover without editing Markdown", async () => {
  const original = readFileSync(rawPath());
  const stat = statSync(rawPath());
  syncMemoryIndex(BOT);
  expect(document().text).toContain(TODAY);
  expect((await recall(TODAY))?.text).toContain(TODAY);
  vi.setSystemTime(new Date(2026, 8, 16, 0, 1));
  syncMemoryIndex(BOT);
  const text = document().text;
  expect(text).toContain(LIVE);
  expect(text).toContain(HAND);
  for (const hidden of [CONTINUATION, CODE, TODAY]) {
    expect(text).not.toContain(hidden);
    expect(searchMemoryFiles(BOT, hidden)).toEqual([]);
    expect(await recall(hidden)).toBeNull();
  }
  const alias = await recall("flightdeck");
  expect(alias?.text).toContain(LIVE);
  expect(alias?.text).not.toContain(TODAY);
  expect(statSync(rawPath()).mtimeMs).toBe(stat.mtimeMs);
  expect(readFileSync(rawPath())).toEqual(original);
});
