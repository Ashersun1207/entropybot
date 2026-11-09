import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { createAboutMe } from "./about-me.ts";
import { DATA_DIR, loadConfig, saveConfig } from "./config.ts";
import { createCloudTeamHost } from "./host/cloud-team-host.ts";
import type { CloudTeam } from "./cloud-team.ts";
import { isForgotten, listLearnedFacts, removeLearned } from "./profile-learned.ts";
import { userProfileSystemPrompt } from "./system-prompt.ts";
import { botMemoryUpdate } from "./memory-forget.ts";
import { loadMemory, readMemoryFile, writeMemoryFile } from "./workspace.ts";

import { withoutMentionedLines } from "./about-me.ts";
import { passageMatcher } from "./memory-entries.ts";
import { ownersOwnAsk, withoutMentions } from "./memory-forget.ts";

const mentions = (passage: string) => passageMatcher(passage)!;

describe("passageMatcher", () => {
  it("matches whole words however the note was typed, and refuses a passage too short to name anything", () => {
    expect(mentions("IST")("The person is in India (IST)")).toBe(true);
    expect(mentions("IST")("The person sees a dentist on Fridays")).toBe(false);
    expect(mentions("short answers")("The person prefers SHORT   answers.")).toBe(true);
    expect(mentions("I'm vegetarian")("I’m vegetarian")).toBe(true);
    expect(passageMatcher("ab")).toBeNull();
    expect(passageMatcher(" - ")).toBeNull();
  });
});

describe("withoutMentions", () => {
  it("drops a dated entry by its fact, never by the chat it came from", () => {
    const notes = [
      '- 2026-10-27 · from chat "Remember: short answers" (noticed) · The person is in India (IST)',
      '- 2026-10-27 · from chat "Remember: short answers" (noticed) · The person prefers short answers',
      "- 2026-10-01 · ~~The person likes long answers~~ · superseded 2026-10-27",
    ].join("\n");
    expect(withoutMentions(notes, mentions("short answers"))).toEqual({
      text: '- 2026-10-27 · from chat "Remember: short answers" (noticed) · The person is in India (IST)\n- 2026-10-01 · ~~The person likes long answers~~ · superseded 2026-10-27',
      removed: ["The person prefers short answers"],
    });
    expect(withoutMentions(notes, mentions("long answers")).removed).toEqual(["The person likes long answers"]);
  });

  it("keeps a topic's frontmatter and headings, and drops a hand-written line that mentions it", () => {
    const topic = "---\ntitle: work\naliases: [IST, hours]\n---\n# Hours\n- Works in IST, 10 to 7\n- Ships on Thursdays\n";
    expect(withoutMentions(topic, mentions("IST"))).toEqual({
      text: "---\ntitle: work\naliases: [IST, hours]\n---\n# Hours\n- Ships on Thursdays\n",
      removed: ["Works in IST, 10 to 7"],
    });
  });
});

describe("withoutMentionedLines", () => {
  it("drops About me lines, learned or written, by their fact and never by the bot that learned them", () => {
    const aboutMe = "I live in Pune.\nI like short answers.\n- 2026-10-27 · learned by Short Answers Bot · The person is in India (IST)\n- 2026-10-27 · learned by Scout · The person prefers short answers";
    expect(withoutMentionedLines(aboutMe, mentions("short answers"))).toEqual({
      text: "I live in Pune.\n- 2026-10-27 · learned by Short Answers Bot · The person is in India (IST)",
      removed: ["I like short answers.", "The person prefers short answers"],
    });
  });
});

describe("ownersOwnAsk", () => {
  it("is true only when the person's own words started the turn", () => {
    expect(ownersOwnAsk([{ role: "user", kind: "text" }, { role: "bot", kind: "text" }])).toBe(true);
    expect(ownersOwnAsk([{ role: "user", kind: "text", sender: { name: "Asha" } }])).toBe(false);
    expect(ownersOwnAsk([{ role: "user", kind: "text", peerAsk: true }])).toBe(false);
    expect(ownersOwnAsk([{ role: "bot", kind: "text" }])).toBe(false);
  });
});

const OLD_COLOR = "Favorite color is cyan";
const NEW_COLOR = "Favorite color is deep blue";
const from = { botId: "correction-owner", botName: "Scout" };
const source = 'chat "Synthetic correction"';
const profileBytes = () => readFileSync(join(DATA_DIR, "profile-learned.json"), "utf8");
const configBytes = () => readFileSync(join(DATA_DIR, "config.json"), "utf8");
const desktopAbout = () => createAboutMe({
  read: () => loadConfig().profile?.aboutMe ?? "",
  write: (aboutMe) => { saveConfig({ profile: { ...loadConfig().profile, aboutMe } }); },
  changed: () => undefined, today: () => "2026-11-01",
});

describe("production memory correction and persisted About me", () => {
  beforeEach(() => {
    rmSync(join(DATA_DIR, "profile-learned.json"), { force: true });
    saveConfig({ profile: { name: "Synthetic owner", aboutMe: "I keep bees." } });
    writeMemoryFile(from.botId, "");
  });

  it.each(["supersede", "replace"])("%s corrects the current fact before later learning, preserving origin and unrelated bytes", (action) => {
    const aboutMe = desktopAbout();
    const fakeProvider = { generate: () => [OLD_COLOR, "Lives in Pune"] };
    expect(aboutMe.learn(from, fakeProvider.generate())).toBe(2);
    expect(botMemoryUpdate(from.botId, { action: "append", text: OLD_COLOR }, { source, aboutMe }).ok).toBe(true);
    const before = listLearnedFacts().find((fact) => fact.text === OLD_COLOR)!;
    expect(botMemoryUpdate(from.botId, { action, oldText: OLD_COLOR, text: NEW_COLOR }, { source, aboutMe }).ok).toBe(true);
    console.log(JSON.stringify({ action, phase: "corrected", memory: readMemoryFile(from.botId).text, config: configBytes(), learned: profileBytes() }));
    expect.soft(aboutMe.learn(from, [NEW_COLOR])).toBe(0);
    console.log(JSON.stringify({ action, phase: "after-later-learning", config: configBytes(), learned: profileBytes() }));
    const current = loadConfig().profile!;
    expect.soft(current.aboutMe).toBe("I keep bees.\n- 2026-11-01 · learned by Scout · Favorite color is deep blue\n- 2026-11-01 · learned by Scout · Lives in Pune");
    expect.soft(userProfileSystemPrompt(current)).not.toContain("cyan");
    expect.soft(configBytes()).not.toContain("cyan");
    expect.soft(profileBytes()).not.toContain("cyan");
    expect.soft(listLearnedFacts().find((fact) => fact.id === before.id)).toMatchObject({ ...before, text: NEW_COLOR, line: before.line.replace(OLD_COLOR, NEW_COLOR) });
    if (action === "supersede") {
      expect(readMemoryFile(from.botId).text).toContain(`~~${OLD_COLOR}~~ · superseded`);
      expect(loadMemory(from.botId)!.text).not.toContain("cyan");
    }
    expect(readMemoryFile(from.botId).text).toContain(NEW_COLOR);
    expect(isForgotten(OLD_COLOR)).toBe(false);
    expect(botMemoryUpdate(from.botId, { action, oldText: NEW_COLOR, text: "Favorite color is violet" }, { source, aboutMe }).ok).toBe(true);
    const frozen = { config: configBytes(), profile: profileBytes(), memory: readMemoryFile(from.botId).text };
    expect(botMemoryUpdate(from.botId, { action, oldText: "absent old fact", text: NEW_COLOR }, { source, aboutMe }).ok).toBe(false);
    expect({ config: configBytes(), profile: profileBytes(), memory: readMemoryFile(from.botId).text }).toEqual(frozen);
    expect(aboutMe.learn(from, ["Favorite color is violet"])).toBe(0);
    expect(userProfileSystemPrompt(loadConfig().profile)).not.toMatch(/cyan|deep blue/);
    const corrected = listLearnedFacts().find((fact) => fact.id === before.id)!;
    expect(removeLearned(corrected.id, loadConfig().profile!.aboutMe!, (aboutMe) => { saveConfig({ profile: { ...loadConfig().profile, aboutMe } }); })).not.toBeNull();
    expect(loadConfig().profile!.aboutMe).not.toContain("violet");
  });

  it("matches complete normalized facts from other bots, including duplicate lines, without matching provenance or compound facts", () => {
    const aboutMe = desktopAbout();
    aboutMe.learn({ botId: "other-bot", botName: OLD_COLOR }, [OLD_COLOR, "Lives in Pune"]);
    const current = loadConfig().profile!.aboutMe!;
    saveConfig({ profile: { aboutMe: `${current}\n- 2026-10-01 · learned by Another bot · Ｆavorite  color is CYAN\n${OLD_COLOR}; keeps two cats.\n${OLD_COLOR}fish` } });
    botMemoryUpdate(from.botId, { action: "append", text: OLD_COLOR }, { source, aboutMe });
    expect(botMemoryUpdate(from.botId, { action: "supersede", oldText: OLD_COLOR, text: NEW_COLOR }, { source, aboutMe }).ok).toBe(true);
    expect(loadConfig().profile!.aboutMe).toBe(`I keep bees.\n- 2026-11-01 · learned by ${OLD_COLOR} · ${NEW_COLOR}\n- 2026-11-01 · learned by ${OLD_COLOR} · Lives in Pune\n- 2026-10-01 · learned by Another bot · ${NEW_COLOR}\n${OLD_COLOR}; keeps two cats.\n${OLD_COLOR}fish`);
  });

  it("keeps notes-only authority, unmatched or partial facts, invalid and duplicate note matches", () => {
    const aboutMe = desktopAbout();
    aboutMe.learn(from, [OLD_COLOR, "Favorite color is cyan; keeps two cats."]);
    botMemoryUpdate(from.botId, { action: "append", text: OLD_COLOR }, { source, aboutMe });
    const before = { config: configBytes(), profile: profileBytes() };
    expect(botMemoryUpdate(from.botId, { action: "replace", oldText: OLD_COLOR, text: NEW_COLOR }, { source, aboutMe: null }).ok).toBe(true);
    expect({ config: configBytes(), profile: profileBytes() }).toEqual(before);
    for (const body of [
      { action: "supersede", oldText: "missing fact", text: NEW_COLOR },
      { action: "replace", oldText: NEW_COLOR, text: "" },
      { action: "replace", oldText: "deep blue", text: "violet" },
    ]) botMemoryUpdate(from.botId, body, { source, aboutMe });
    expect({ config: configBytes(), profile: profileBytes() }).toEqual(before);
    writeMemoryFile(from.botId, `${OLD_COLOR}\n${OLD_COLOR}\n`);
    expect(botMemoryUpdate(from.botId, { action: "replace", oldText: OLD_COLOR, text: NEW_COLOR }, { source, aboutMe }).ok).toBe(false);
    expect({ config: configBytes(), profile: profileBytes() }).toEqual(before);
  });

  it("keeps repeated replacement idempotent and does not insert multiline or oversized profile facts", () => {
    const aboutMe = desktopAbout();
    aboutMe.learn(from, [OLD_COLOR]);
    botMemoryUpdate(from.botId, { action: "append", text: OLD_COLOR }, { source, aboutMe });
    expect(botMemoryUpdate(from.botId, { action: "replace", oldText: OLD_COLOR, text: NEW_COLOR }, { source, aboutMe }).ok).toBe(true);
    const frozen = { config: configBytes(), profile: profileBytes() };
    expect(botMemoryUpdate(from.botId, { action: "replace", oldText: NEW_COLOR, text: NEW_COLOR }, { source, aboutMe }).ok).toBe(true);
    expect({ config: configBytes(), profile: profileBytes() }).toEqual(frozen);
    for (const text of ["Line one\nLine two", "x".repeat(301)]) {
      writeMemoryFile(from.botId, `- 2026-11-01 · ${NEW_COLOR}\n`);
      expect(botMemoryUpdate(from.botId, { action: "replace", oldText: NEW_COLOR, text }, { source, aboutMe }).ok).toBe(true);
      expect({ config: configBytes(), profile: profileBytes() }).toEqual(frozen);
    }
  });

  it("does not change learned-card bytes when the profile save fails", () => {
    const aboutMe = desktopAbout();
    aboutMe.learn(from, [OLD_COLOR, "Lives in Pune"]);
    const frozen = { config: configBytes(), profile: profileBytes() };
    const failing = createAboutMe({ read: () => loadConfig().profile!.aboutMe!, write: () => { throw new Error("synthetic profile save failure"); }, changed: () => undefined, today: () => "2026-11-01" });
    botMemoryUpdate(from.botId, { action: "append", text: OLD_COLOR }, { source, aboutMe });
    expect(() => botMemoryUpdate(from.botId, { action: "replace", oldText: OLD_COLOR, text: NEW_COLOR }, { source, aboutMe: failing })).toThrow("synthetic profile save failure");
    expect({ config: configBytes(), profile: profileBytes() }).toEqual(frozen);
    expect(readMemoryFile(from.botId).text).toContain(NEW_COLOR);
  });

  it("allows a replacement containing the old passage and leaves append/prefer/forget behavior intact", () => {
    const aboutMe = desktopAbout();
    aboutMe.learn(from, [OLD_COLOR]);
    botMemoryUpdate(from.botId, { action: "append", text: OLD_COLOR }, { source, aboutMe });
    const expanded = `${OLD_COLOR} and turquoise`;
    expect(botMemoryUpdate(from.botId, { action: "supersede", oldText: OLD_COLOR, text: expanded }, { source, aboutMe }).ok).toBe(true);
    expect(loadConfig().profile!.aboutMe).toContain(`learned by Scout · ${expanded}`);
    expect(isForgotten(expanded)).toBe(false);
    expect(botMemoryUpdate(from.botId, { action: "forget", oldText: "turquoise" }, { source, aboutMe })).toMatchObject({ ok: true, aboutMe: [expanded] });
    expect(isForgotten(expanded)).toBe(true);
    expect(aboutMe.learn(from, [expanded])).toBe(0);
    botMemoryUpdate(from.botId, { action: "prefer", text: expanded }, { source, aboutMe, prefer: { save: (text) => aboutMe.learn(from, [text]) } });
    expect(isForgotten(expanded)).toBe(false);
    expect(loadConfig().profile!.aboutMe).toContain(expanded);
    botMemoryUpdate(from.botId, { action: "forget", oldText: "turquoise" }, { source, aboutMe });
    botMemoryUpdate(from.botId, { action: "append", text: expanded }, { source, aboutMe });
    expect(isForgotten(expanded)).toBe(false);
  });

  it("uses the actual Team Cloud person plan and profile projection, preserving other people and shared/room audiences", () => {
    const ada = `p_${"a".repeat(22)}`, bob = `p_${"b".repeat(22)}`;
    const host = createCloudTeamHost({ team: { id: "fixture-team", name: "Fixture" } satisfies CloudTeam,
      dataDir: DATA_DIR, store: { groupByThread: (id) => id === "room" ? { id: "fixture" } : undefined },
      starters: new Map([["ada", ada], ["bob", bob]]), markers: new Set(),
    });
    const aboutMe = createAboutMe({ read: () => { throw new Error("must use person"); }, write: () => { throw new Error("must use person"); },
      changed: () => undefined, today: () => "2026-11-01", person: host.learnAbout });
    const layers = [host.layer(from.botId, "ada"), host.layer(from.botId, "bob"), host.layer(from.botId, "room"), host.layer(from.botId, "team")];
    for (const layer of layers) writeMemoryFile(layer, `- 2026-11-01 · ${OLD_COLOR}\n`);
    expect(aboutMe.learn({ ...from, botId: layers[0]! }, [OLD_COLOR, "Keeps bees"])).toBe(2);
    expect(aboutMe.learn({ ...from, botId: layers[1]! }, [OLD_COLOR])).toBe(1);
    const bobFile = join(DATA_DIR, "people", bob, "about.json");
    const bobBefore = readFileSync(bobFile, "utf8"), configBefore = configBytes();
    for (const layer of [layers[0]!, layers[2]!, layers[3]!]) {
      expect(botMemoryUpdate(layer, { action: "supersede", oldText: OLD_COLOR, text: NEW_COLOR }, { source, aboutMe }).ok).toBe(true);
    }
    const adaProfile = host.profileFor("ada", undefined);
    console.log(JSON.stringify({ phase: "team-corrected", ada: adaProfile, bob: host.profileFor("bob", undefined) }));
    expect(adaProfile?.aboutMe).toBe(`- 2026-11-01 · learned by Scout · ${NEW_COLOR}\n- 2026-11-01 · learned by Scout · Keeps bees`);
    expect(userProfileSystemPrompt(adaProfile)).not.toContain("cyan");
    expect(readFileSync(join(DATA_DIR, "people", ada, "about.json"), "utf8")).not.toContain("cyan");
    expect(readFileSync(bobFile, "utf8")).toBe(bobBefore);
    expect(configBytes()).toBe(configBefore);
    expect(host.profileFor("room", undefined)).toBeUndefined();
    expect(host.profileFor("team", undefined)).toBeUndefined();
    expect(isForgotten(OLD_COLOR)).toBe(false);
    expect(aboutMe.learn({ ...from, botId: layers[1]! }, [NEW_COLOR])).toBe(1);
  });
});
