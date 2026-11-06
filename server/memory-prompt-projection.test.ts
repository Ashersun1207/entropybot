import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { closeMessageDb } from "./message-db.ts";
import { ORGANIZE_MARKER } from "./memory-organize.ts";
import { createMemoryUpkeep, type UpkeepBot } from "./memory-upkeep.ts";
import { ensureWorkspace, loadMemory, memorySystemPrompt, readMemoryFile, updateMemory, workspaceDir, writeMemoryFile, WORKSPACES_DIR } from "./workspace.ts";

const BOT = "memory-prompt-projection";
const OLD = "The account balance is -10";
const EXPIRED = "The trial expires on Friday";
const EXPIRED_CONT = "expired continuation must not leak";
const EXPIRED_CODE = "expired fenced code must not leak";
const NOW = new Date(2026, 10, 7, 12);
const bot: UpkeepBot = { id: BOT, name: "Projection" };

beforeEach(() => {
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  rmSync(WORKSPACES_DIR, { recursive: true, force: true });
});

function seed(): void {
  ensureWorkspace(BOT);
  expect(updateMemory(BOT, { action: "append", text: OLD }, { now: NOW, source: 'chat "Fixture"' }).ok).toBe(true);
  expect(updateMemory(BOT, { action: "append", text: EXPIRED, until: "2020-01-01" }, { now: NOW, source: 'chat "Fixture"' }).ok).toBe(true);
  expect(updateMemory(BOT, { action: "supersede", oldText: "The account balance is -10", text: "The account balance is 10" }, { now: NOW, source: 'chat "Fixture"' }).ok).toBe(true);
  expect(updateMemory(BOT, { action: "append", text: "The account balance is 20" }, { now: NOW, source: 'chat "Fixture"' }).ok).toBe(true);
  const current = readMemoryFile(BOT).text;
  writeMemoryFile(BOT, `${current}- 2026-11-01 · from chat "Fixture" · Expired block · until 2020-01-01\n  ${EXPIRED_CONT}\n\`\`\`\n${EXPIRED_CODE}\n\`\`\`\n`);
}

describe("memory prompt projection", () => {
  it("leaves superseded and expired entries out of the real prompt while the file keeps them", () => {
    seed();
    const prompt = memorySystemPrompt(BOT, { managedWrites: true, fileTools: true });
    expect(prompt).toContain("The account balance is 10");
    expect(prompt).toContain("The account balance is 20");
    expect(prompt).not.toContain("~~The account balance is -10~~");
    expect(prompt).not.toContain(EXPIRED);
    expect(prompt).not.toContain(EXPIRED_CONT);
    expect(prompt).not.toContain(EXPIRED_CODE);
    const memory = loadMemory(BOT, { now: NOW });
    expect(memory?.text).toContain("The account balance is 10");
    expect(memory?.text).not.toContain("~~The account balance is -10~~");
    expect(memory?.text).not.toContain(EXPIRED);
    expect(memory?.text).not.toContain(EXPIRED_CONT);
    expect(memory?.text).not.toContain(EXPIRED_CODE);
    // The UI/file remains the audit and recovery surface, byte for byte.
    const raw = readMemoryFile(BOT).text;
    expect(raw).toContain("~~The account balance is -10~~");
    expect(raw).toContain(EXPIRED);
    expect(raw).toContain(EXPIRED_CONT);
    expect(raw).toContain(EXPIRED_CODE);
    expect(readFileSync(join(workspaceDir(BOT), "MEMORY.md"), "utf8")).toBe(raw);
  });

  it("filters before the line budget so hidden entries cannot push out a live fact", () => {
    const hidden = Array.from({ length: 260 }, (_, index) => `- 2020-01-01 · from chat "Fixture" · Expired ${index} · until 2020-01-02`).join("\n");
    writeMemoryFile(BOT, `${hidden}\n- 2026-11-07 · from chat "Fixture" · ACTIVE_AFTER_HIDDEN\n`);
    const memory = loadMemory(BOT, { now: NOW });
    expect(memory?.text).toContain("ACTIVE_AFTER_HIDDEN");
    expect(memory?.text).not.toContain("Expired 0");
    expect(memory?.truncated).toBe(false);
    expect(memory?.lines).toBe(261);
    expect(memory?.expired).toBe(260);
    expect(memorySystemPrompt(BOT, { managedWrites: true })).toContain("ACTIVE_AFTER_HIDDEN");
  });

  it("keeps hand-written text and same-day or future until entries", () => {
    writeMemoryFile(BOT, [
      "# Memory",
      "hand-written ~~old~~ superseded-looking note",
      '- 2026-11-07 · from chat "Fixture" · TODAY_FACT · until 2026-11-07',
      '- 2026-11-07 · from chat "Fixture" · FUTURE_FACT · until 2099-01-01',
    ].join("\n"));
    const memory = loadMemory(BOT, { now: NOW });
    expect(memory?.text).toContain("hand-written ~~old~~ superseded-looking note");
    expect(memory?.text).toContain("TODAY_FACT");
    expect(memory?.text).toContain("FUTURE_FACT");
    expect(memory?.expired).toBe(0);
  });

  it("keeps an empty projection empty instead of falling back to the raw file", () => {
    writeMemoryFile(BOT, [
      "- 2020-01-01 · from chat \"Fixture\" · ONLY_EXPIRED · until 2020-01-02",
      "- 2026-11-01 · from chat \"Fixture\" · ~~ONLY_SUPERSEDED~~ · superseded 2026-11-02",
    ].join("\n"));
    const memory = loadMemory(BOT, { now: NOW });
    expect(memory?.text).toBe("");
    const prompt = memorySystemPrompt(BOT, { managedWrites: true });
    expect(prompt).not.toContain("ONLY_EXPIRED");
    expect(prompt).not.toContain("ONLY_SUPERSEDED");
    expect(readMemoryFile(BOT).text).toContain("ONLY_EXPIRED");
  });

  it("does not feed superseded or expired notebook lines to the capture model", async () => {
    seed();
    const prompts: string[] = [];
    const upkeep = createMemoryUpkeep({
      bots: () => [bot],
      bot: () => bot,
      engine: () => ({
        generateText: async (prompt) => {
          prompts.push(prompt);
          return prompt.includes(ORGANIZE_MARKER) ? '{"moves":[]}' : "[]";
        },
      }),
      busy: () => false,
      addToAboutMe: () => 0,
      sourceLabel: () => 'chat "Fixture"',
      quietMs: () => 60_000,
      tidyHour: () => 3,
      now: () => NOW,
    });
    try {
      await upkeep.capture({ botId: BOT, threadId: "fixture-thread", turns: [{ person: "I prefer short replies", bot: "Got it." }] });
    } finally {
      upkeep.stop();
    }
    const capture = prompts.find((prompt) => !prompt.includes(ORGANIZE_MARKER))!;
    expect(capture).toContain("The account balance is 10");
    expect(capture).toContain("The account balance is 20");
    expect(capture).not.toContain("~~The account balance is -10~~");
    expect(capture).not.toContain(EXPIRED);
    expect(capture).not.toContain(EXPIRED_CONT);
    expect(capture).not.toContain(EXPIRED_CODE);
  });
});
