import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR } from "./config.ts";
import { parseMemoryEntries } from "./memory-entries.ts";
import { closeMessageDb, memoryFileDocuments } from "./message-db.ts";
import { buildRecall } from "./recall.ts";
import { applyTidy, contradictionCandidates, contradictionPrompt, parseContradictions, planTidy, TIDY_MARKER } from "./memory-tidy.ts";
import { createMemoryUpkeep } from "./memory-upkeep.ts";
import { ensureWorkspace, loadMemory, memorySystemPrompt, memoryVisibleText, readMemoryFile, readMemoryTopic, searchMemoryFiles, syncMemoryIndex, writeMemoryFile, writeMemoryTopic } from "./workspace.ts";

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
    expect(contradictionCandidates(source, TODAY)).toHaveLength(0);
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

const OLD_CANARY = "Supersededcontinuationcanary";
const MULTILINE = [
  '- 2026-09-01 · from chat "Synthetic correction" · Legacy region is west and keeps tea',
  `  ${OLD_CANARY}`, "```txt", "legacy west detail", "```",
].join("\n");
const SINGLE_OLD = "- 2026-09-02 · Balance is -10 and likes chess";
const SINGLE_NEW = "- 2026-09-04 · Balance is 10";
const INTERLEAVED = [MULTILINE, SINGLE_OLD, "- 2026-09-03 · Other multiline note\n  Othercontinuationcontrol", SINGLE_NEW,
  "- 2026-09-05 · Legacy region is east", "- 2026-09-06 · Fillercontrol", "- 2026-09-07 · Extracontrol", ""].join("\n");

function candidatePair(prompt: string, earlier: string, later: string, remainder: string) {
  const indexOf = (body: string) => Number(new RegExp(`\\[(\\d+)\\] \\([^\\n]+\\) ${body}`).exec(prompt)?.[1] ?? -1);
  return { a: indexOf(earlier), b: indexOf(later), keep: "b" as const, remainder };
}

function continuationOwner(text: string) {
  const line = text.split("\n").findIndex(value => value.includes(OLD_CANARY));
  return parseMemoryEntries(text).find(entry => entry.line <= line && entry.end > line);
}

describe("tidy supported correction spans", () => {
  it("does not supersede a multiline header or reparent its continuation to a remainder", () => {
    const candidates = contradictionCandidates(INTERLEAVED, TODAY);
    const prompt = contradictionPrompt(candidates);
    const pair = candidatePair(prompt, "Legacy region is west and keeps tea", "Legacy region is east", "Keeps tea");
    const plan = planTidy(INTERLEAVED, TODAY, parseContradictions(JSON.stringify({ pairs: [pair] }), candidates.length), 1);
    const result = applyTidy(INTERLEAVED, plan, TODAY);
    writeMemoryFile(BOT, result.text);
    syncMemoryIndex(BOT);
    console.log(JSON.stringify({ probe: "multiline-remainder", prompt, pair, plan: plan.superseded, text: result.text,
      continuationOwner: continuationOwner(result.text), promptProjection: memorySystemPrompt(BOT), documents: memoryFileDocuments(BOT) }));
    expect.soft(plan.superseded).toEqual([]);
    expect.soft(result.text).toBe(INTERLEAVED);
    expect.soft(continuationOwner(result.text)?.body).toBe("Legacy region is west and keeps tea");
    expect.soft(prompt).not.toContain("Legacy region is west");
    expect(prompt).not.toContain(OLD_CANARY);
  });

  it("maps interleaved candidates once and preserves default and minimum budgets", () => {
    const candidates = contradictionCandidates(INTERLEAVED, TODAY);
    expect(candidates.map(entry => entry.body)).toEqual(["Balance is -10 and likes chess", "Balance is 10", "Legacy region is east", "Fillercontrol", "Extracontrol"]);
    const prompt = contradictionPrompt(candidates);
    expect(prompt).toContain("[0] (2026-09-02) Balance is -10 and likes chess");
    expect(prompt).toContain("[1] (2026-09-04) Balance is 10");
    const pairs = parseContradictions('{"pairs":[{"a":0,"b":1,"keep":"b","remainder":"Likes chess"},{"a":3,"b":4,"keep":"a"}]}', candidates.length);
    const plan = planTidy(INTERLEAVED, TODAY, pairs);
    expect(plan.superseded.map(({ loser, winner }) => [loser.raw, winner.raw])).toEqual([[SINGLE_OLD, SINGLE_NEW]]);
    expect(plan.deferred).toBe(1);
    const result = applyTidy(INTERLEAVED, plan, TODAY).text;
    expect(result).toContain(MULTILINE);
    expect(result).toContain("~~Balance is -10 and likes chess~~");
    expect(result).toContain(`- ${TODAY} · from tidy-up · Likes chess\n- 2026-09-03 · Other multiline note\n  Othercontinuationcontrol`);
    expect(planTidy(INTERLEAVED, TODAY, pairs, 2).superseded).toHaveLength(2);
    const tenLive = INTERLEAVED + [8, 9, 10].map(day => `- 2026-09-${String(day).padStart(2, "0")} · Multiline budget ${day}\n  retained\n`).join("");
    expect(contradictionCandidates(tenLive, TODAY)).toHaveLength(5);
    expect(planTidy(tenLive, TODAY, pairs).superseded).toHaveLength(2);
    const small = [MULTILINE, SINGLE_OLD, "- 2026-09-03 · Other note\n  retained", SINGLE_NEW].join("\n");
    expect(planTidy(small, TODAY, pairs)).toMatchObject({ superseded: [], deferred: 1 });
    const minimum = planTidy(small, TODAY, pairs, 1);
    expect(minimum.superseded.map(({ loser }) => loser.raw)).toEqual([SINGLE_OLD]);
    expect(applyTidy(small, minimum, TODAY).text).toContain(MULTILINE);
  });

  it.each(["MEMORY.md", "memory/correction.md"])("persists supported corrections in %s through two production tidy calls", async path => {
    if (path === "MEMORY.md") writeMemoryFile(BOT, INTERLEAVED);
    else {
      writeMemoryFile(BOT, "# Memory\nCorecontrol\n");
      writeMemoryTopic(BOT, "correction.md", INTERLEAVED);
    }
    const bot = { id: BOT, name: "Synthetic correction" };
    const prompts: string[] = [];
    const upkeep = createMemoryUpkeep({
      bots: () => [bot], bot: () => bot,
      engine: () => ({ generateText: async prompt => {
        if (!prompt.includes(TIDY_MARKER)) return '{"moves":[]}';
        prompts.push(prompt);
        const pairs = prompts.length > 1 ? [] : [prompt.includes("Legacy region is west")
          ? candidatePair(prompt, "Legacy region is west and keeps tea", "Legacy region is east", "Keeps tea")
          : candidatePair(prompt, "Balance is -10 and likes chess", "Balance is 10", "Likes chess")];
        const source = path === "MEMORY.md" ? readMemoryFile(BOT).text : readMemoryTopic(BOT, "correction.md")!;
        console.log(JSON.stringify({ probe: "production-helper", path, round: prompts.length, prompt, pairs,
          generatedPlan: planTidy(source, TODAY, pairs, path === "MEMORY.md" ? 0 : 1) }));
        return JSON.stringify({ pairs });
      } }),
      busy: () => false, addToAboutMe: () => 0, sourceLabel: () => "fixture", quietMs: () => 60_000, tidyHour: () => 3, now: () => NOW,
    });
    try {
      expect(await upkeep.tidy(BOT)).toMatchObject({ expired: 0, duplicates: 0, superseded: 1, contradictionsChecked: true });
      const active = () => path === "MEMORY.md" ? readMemoryFile(BOT).text : readMemoryTopic(BOT, "correction.md")!;
      const first = active();
      syncMemoryIndex(BOT);
      const document = memoryFileDocuments(BOT).find(doc => doc.path === path)!;
      const promptProjection = path === "MEMORY.md" ? memorySystemPrompt(BOT) : memoryVisibleText(first, TODAY).text;
      console.log(JSON.stringify({ probe: "production-persisted", path, first, continuationOwner: continuationOwner(first), promptProjection, document }));
      expect.soft(first).toContain(MULTILINE);
      expect.soft(first).toContain(`- 2026-09-02 · ~~Balance is -10 and likes chess~~ · superseded ${TODAY}\n- ${TODAY} · from tidy-up · Likes chess`);
      expect.soft(first).toContain(SINGLE_NEW);
      expect.soft(continuationOwner(first)?.body).toBe("Legacy region is west and keeps tea");
      for (const projection of [promptProjection, document.text]) {
        expect.soft(projection).not.toContain("Balance is -10");
        expect.soft(projection).toContain(OLD_CANARY);
        expect.soft(projection).toContain("Balance is 10");
        expect.soft(projection).toContain("Likes chess");
      }
      expect(await upkeep.tidy(BOT)).toMatchObject({ expired: 0, duplicates: 0, superseded: 0 });
      expect(active()).toBe(first);
      syncMemoryIndex(BOT);
      expect(memoryFileDocuments(BOT).find(doc => doc.path === path)?.text).toBe(document.text);
      console.log(JSON.stringify({ probe: "production-second-tidy", path, text: active(),
        promptProjection: path === "MEMORY.md" ? memorySystemPrompt(BOT) : memoryVisibleText(active(), TODAY).text,
        document: memoryFileDocuments(BOT).find(doc => doc.path === path), candidates: contradictionCandidates(active(), TODAY) }));
      expect(prompts).toHaveLength(2);
      expect.soft(prompts[0]).toContain("[0] (2026-09-02) Balance is -10 and likes chess");
      expect.soft(prompts[0]).toContain("[1] (2026-09-04) Balance is 10");
      expect.soft(prompts[1]).not.toContain("Balance is -10");
      expect(prompts[1]).not.toContain(OLD_CANARY);
    } finally { upkeep.stop(); await upkeep.idle(); }
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
