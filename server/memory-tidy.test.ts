import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR } from "./config.ts";
import { parseMemoryEntries } from "./memory-entries.ts";
import { closeMessageDb, memoryFileDocuments } from "./message-db.ts";
import { buildRecall } from "./recall.ts";
import { applyTidy, contradictionCandidates, planTidy } from "./memory-tidy.ts";
import { createMemoryUpkeep } from "./memory-upkeep.ts";
import { ensureWorkspace, loadMemory, memorySystemPrompt, readMemoryFile, readMemoryTopic, searchMemoryFiles, syncMemoryIndex, writeMemoryFile, writeMemoryTopic } from "./workspace.ts";

const BOT = "tidy-spans-fixture";
const TODAY = "2026-09-25";
const NOW = new Date(2026, 8, 25, 12);
const CONT = "Expiredcontinuationcanary";
const CODE = "Expiredfencedcanary";
const FIRST = '- 2026-09-01 · from chat "Synthetic provenance" · Old deployment · until 2026-09-24';
const SPAN = [FIRST, `  ${CONT}`, "```sh", CODE, "```"].join("\n");
const RETAINED = [
  "# Memory",
  "handwritten before",
  '- 2026-09-01 · from chat "Control" · Samedaycontrol · until 2026-09-25',
  "  same day continuation",
  "- 2026-09-02 · Liveadjacentcontrol",
  "handwritten after",
  "",
].join("\n");
const SOURCE = `${SPAN}\n${RETAINED}`;
const ARCHIVED = [FIRST + ` · expired ${TODAY}`, `  ${CONT}`, "```sh", CODE, "```"].join("\n");

beforeEach(() => {
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  ensureWorkspace(BOT);
});
afterEach(() => { vi.useRealTimers(); });

describe("tidy complete entry spans", () => {
  it("archives the complete expired span with its original source and closed fence", () => {
    const result = applyTidy(SOURCE, planTidy(SOURCE, TODAY), TODAY);
    expect(result.archived).toEqual([ARCHIVED]);
    expect(result.text).toBe(RETAINED);
    expect(parseMemoryEntries(result.archived[0])[0]).toMatchObject({ line: 0, end: 5, until: "2026-09-24" });
  });

  it("does not turn expired continuations into active prompt, index or recall content", async () => {
    const result = applyTidy(SOURCE, planTidy(SOURCE, TODAY), TODAY);
    writeMemoryFile(BOT, result.text);
    syncMemoryIndex(BOT);
    const projections = [result.text, loadMemory(BOT, { now: NOW })?.text, memorySystemPrompt(BOT), memoryFileDocuments(BOT).find(doc => doc.path === "MEMORY.md")?.text];
    for (const projection of projections) {
      expect(projection).toContain("Liveadjacentcontrol");
      expect.soft(projection).not.toContain(CONT);
      expect.soft(projection).not.toContain(CODE);
    }
    for (const canary of [CONT, CODE]) {
      expect.soft(searchMemoryFiles(BOT, canary)).toEqual([]);
      expect.soft(await buildRecall({ botId: BOT, message: canary, threadIds: [], label: () => "fixture", author: () => "fixture" })).toBeNull();
    }
  });

  it("leaves unrecognized CRLF entries intact", () => {
    const source = SOURCE.replaceAll("\n", "\r\n");
    expect(parseMemoryEntries(source)).toEqual([]);
    expect(applyTidy(source, planTidy(source, TODAY), TODAY)).toEqual({ text: source, archived: [] });
  });

  it.each(["different", "identical"])("conservatively retains multiline notes with %s continuation bodies", (kind) => {
    const earlier = "- 2026-09-01 · Deployment settings\n  region: west\n```sh\necho west\n```";
    const later = `- 2026-09-02 · Deployment settings\n  region: ${kind === "identical" ? "west" : "east"}\n\`\`\`sh\necho ${kind === "identical" ? "west" : "east"}\n\`\`\``;
    const source = `${earlier}\n${later}\n`;
    const plan = planTidy(source, TODAY);
    expect(plan.duplicates).toEqual([]);
    expect(contradictionCandidates(source, TODAY)).toHaveLength(2);
    expect(applyTidy(source, plan, TODAY).text).toBe(source);
  });

  it("keeps multiline content when single-line duplicates share its heading", () => {
    const source = [
      "- 2026-09-01 · Deployment settings", "  unique continuation",
      "- 2026-09-02 · Deployment settings", "- 2026-09-03 · Deployment settings.",
      "- 2026-09-04 · Balance is -10", "- 2026-09-05 · Balance is 10",
    ].join("\n");
    const plan = planTidy(source, TODAY);
    expect(plan.duplicates.map(entry => entry.date)).toEqual(["2026-09-02"]);
    expect(applyTidy(source, plan, TODAY).text).toBe([
      "- 2026-09-01 · Deployment settings", "  unique continuation",
      "- 2026-09-03 · Deployment settings.",
      "- 2026-09-04 · Balance is -10", "- 2026-09-05 · Balance is 10",
    ].join("\n"));
  });
});

describe("production upkeep archival", () => {
  it.each(["MEMORY.md", "memory/deployment.md"])("archives a full expired block from %s and keeps active projections clean", async (path) => {
    if (path === "MEMORY.md") writeMemoryFile(BOT, SOURCE);
    else {
      writeMemoryFile(BOT, RETAINED);
      writeMemoryTopic(BOT, "deployment.md", SOURCE);
    }
    const bot = { id: BOT, name: "Synthetic tidy" };
    const upkeep = createMemoryUpkeep({
      bots: () => [bot], bot: () => bot, engine: () => null,
      busy: () => false, addToAboutMe: () => 0, sourceLabel: () => "fixture",
      quietMs: () => 60_000, tidyHour: () => 3, now: () => NOW,
    });
    try {
      const report = await upkeep.tidy(BOT);
      expect(report).toMatchObject({ expired: 1, duplicates: 0, superseded: 0 });
      const archive = readMemoryTopic(BOT, "archive.md")!;
      expect(archive).toBe(`${ARCHIVED}\n`);
      const active = path === "MEMORY.md" ? readMemoryFile(BOT).text : readMemoryTopic(BOT, "deployment.md")!;
      expect(active).toBe(RETAINED);
      syncMemoryIndex(BOT);
      const documents = memoryFileDocuments(BOT);
      const activeDocument = documents.find(doc => doc.path === path)!;
      expect(activeDocument.text).toContain("Samedaycontrol");
      expect(activeDocument.text).toContain("handwritten after");
      expect(documents.find(doc => doc.path === "memory/archive.md")?.text).toContain(ARCHIVED);
      for (const canary of [CONT, CODE]) {
        expect(activeDocument.text).not.toContain(canary);
        expect(memorySystemPrompt(BOT)).not.toContain(canary);
        expect(searchMemoryFiles(BOT, canary).filter(hit => hit.file === path)).toEqual([]);
      }
      expect(await upkeep.tidy(BOT)).toMatchObject({ expired: 0, duplicates: 0 });
      expect(readMemoryTopic(BOT, "archive.md")!).toBe(archive);
    } finally {
      upkeep.stop();
      await upkeep.idle();
    }
  });
});
