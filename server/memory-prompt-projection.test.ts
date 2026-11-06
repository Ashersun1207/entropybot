import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { closeMessageDb } from "./message-db.ts";
import { ORGANIZE_MARKER } from "./memory-organize.ts";
import { createMemoryUpkeep, type UpkeepBot } from "./memory-upkeep.ts";
import { ensureWorkspace, loadMemory, memorySystemPrompt, readMemoryFile, updateMemory, workspaceDir, WORKSPACES_DIR } from "./workspace.ts";

const BOT = "memory-prompt-projection";
const OLD = "The account balance is -10";
const EXPIRED = "The trial expires on Friday";
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
}

describe("memory prompt projection", () => {
  it("leaves superseded and expired entries out of the real prompt while the file keeps them", () => {
    seed();
    const prompt = memorySystemPrompt(BOT, { managedWrites: true, fileTools: true });
    expect(prompt).toContain("The account balance is 10");
    expect(prompt).toContain("The account balance is 20");
    expect(prompt).not.toContain("~~The account balance is -10~~");
    expect(prompt).not.toContain(EXPIRED);
    const memory = loadMemory(BOT, { now: NOW });
    expect(memory?.text).toContain("The account balance is 10");
    expect(memory?.text).not.toContain("~~The account balance is -10~~");
    expect(memory?.text).not.toContain(EXPIRED);
    // The UI/file remains the audit and recovery surface.
    expect(readMemoryFile(BOT).text).toContain("~~The account balance is -10~~");
    expect(readMemoryFile(BOT).text).toContain(EXPIRED);
    expect(readFileSync(join(workspaceDir(BOT), "MEMORY.md"), "utf8")).toContain("~~The account balance is -10~~");
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
  });
});
