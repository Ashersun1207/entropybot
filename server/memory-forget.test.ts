import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as atomic from "./atomic.ts";

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
const selected = (oldFact: string, text: string) => ({ oldAboutMeText: `- 2026-11-01 · learned by Scout · ${oldFact}`, aboutMeText: text });
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
    expect(botMemoryUpdate(from.botId, { action, oldText: OLD_COLOR, text: NEW_COLOR, oldAboutMeText: before.line, aboutMeText: NEW_COLOR }, { source, aboutMe }).ok).toBe(true);
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
    expect(botMemoryUpdate(from.botId, { action, oldText: NEW_COLOR, text: "Favorite color is violet", oldAboutMeText: before.line.replace(OLD_COLOR, NEW_COLOR), aboutMeText: "Favorite color is violet" }, { source, aboutMe }).ok).toBe(true);
    const frozen = { config: configBytes(), profile: profileBytes(), memory: readMemoryFile(from.botId).text };
    expect(botMemoryUpdate(from.botId, { action, oldText: "absent old fact", text: NEW_COLOR }, { source, aboutMe }).ok).toBe(false);
    expect({ config: configBytes(), profile: profileBytes(), memory: readMemoryFile(from.botId).text }).toEqual(frozen);
    expect(aboutMe.learn(from, ["Favorite color is violet"])).toBe(0);
    expect(userProfileSystemPrompt(loadConfig().profile)).not.toMatch(/cyan|deep blue/);
    const corrected = listLearnedFacts().find((fact) => fact.id === before.id)!;
    expect(removeLearned(corrected.id, loadConfig().profile!.aboutMe!, (aboutMe) => { saveConfig({ profile: { ...loadConfig().profile, aboutMe } }); })).not.toBeNull();
    expect(loadConfig().profile!.aboutMe).not.toContain("violet");
  });

  it.each([false, true])("original Chinese note and English profile: explicit selector=%s", (explicit) => {
    const oldNote = "最喜欢的颜色是青色（cyan）。";
    const correctedNote = "最喜欢的颜色是深蓝色（deep blue），青色已作废。";
    const oldProfileFact = "The person's favorite color is cyan (青色).";
    const aboutMe = desktopAbout();
    expect(aboutMe.learn(from, [oldProfileFact, "Lives in Pune"])).toBe(2);
    expect(botMemoryUpdate(from.botId, { action: "append", text: oldNote }, { source, aboutMe }).ok).toBe(true);
    const result = botMemoryUpdate(from.botId, { action: "supersede", oldText: oldNote, text: correctedNote,
      ...(explicit ? { oldAboutMeText: `- 2026-11-01 · learned by Scout · ${oldProfileFact}`, aboutMeText: correctedNote } : {}) }, { source, aboutMe });
    expect(result).toMatchObject({ ok: true, aboutMeCorrection: explicit ? { status: "saved" } : { status: "not_checked", reason: "selector_missing" } });
    expect(readMemoryFile(from.botId).text).toContain(`~~${oldNote}~~ · superseded`);
    expect(loadMemory(from.botId)!.text).toContain(correctedNote);
    expect(loadMemory(from.botId)!.text).not.toContain(oldNote);
    const immediately = loadConfig().profile!;
    console.log(JSON.stringify({ phase: "original-strings-immediately-after-correction", oldNote, correctedNote, oldProfileFact, result,
      memory: readMemoryFile(from.botId).text, activeMemory: loadMemory(from.botId)!.text,
      config: configBytes(), learned: profileBytes(), profilePrompt: userProfileSystemPrompt(immediately) }));
    expect(immediately.aboutMe!.includes(oldProfileFact)).toBe(!explicit);
    expect(userProfileSystemPrompt(immediately).includes(oldProfileFact)).toBe(!explicit);
    const learnedLater = aboutMe.learn(from, [correctedNote]);
    const later = loadConfig().profile!;
    console.log(JSON.stringify({ phase: "original-strings-after-later-learning", learnedLater,
      config: configBytes(), learned: profileBytes(), profilePrompt: userProfileSystemPrompt(later) }));
    expect(later.aboutMe).toContain(correctedNote);
    expect(later.aboutMe).toContain("I keep bees.");
    expect(later.aboutMe).toContain("Lives in Pune");
    expect(learnedLater).toBe(explicit ? 0 : 1);
    expect(later.aboutMe!.includes(oldProfileFact)).toBe(!explicit);
    expect(userProfileSystemPrompt(later).includes(oldProfileFact)).toBe(!explicit);
    expect(profileBytes().includes(oldProfileFact)).toBe(!explicit);
  });

  it("corrects only the selected exact line from another bot, preserving other provenance and compound facts", () => {
    const aboutMe = desktopAbout();
    aboutMe.learn({ botId: "other-bot", botName: OLD_COLOR }, [OLD_COLOR, "Lives in Pune"]);
    const current = loadConfig().profile!.aboutMe!;
    saveConfig({ profile: { aboutMe: `${current}\n- 2026-10-01 · learned by Another bot · Ｆavorite  color is CYAN\n${OLD_COLOR}; keeps two cats.\n${OLD_COLOR}fish` } });
    botMemoryUpdate(from.botId, { action: "append", text: OLD_COLOR }, { source, aboutMe });
    expect(botMemoryUpdate(from.botId, { action: "supersede", oldText: OLD_COLOR, text: NEW_COLOR, oldAboutMeText: `- 2026-11-01 · learned by ${OLD_COLOR} · ${OLD_COLOR}`, aboutMeText: NEW_COLOR }, { source, aboutMe }).ok).toBe(true);
    expect(loadConfig().profile!.aboutMe).toBe(`I keep bees.\n- 2026-11-01 · learned by ${OLD_COLOR} · ${NEW_COLOR}\n- 2026-11-01 · learned by ${OLD_COLOR} · Lives in Pune\n- 2026-10-01 · learned by Another bot · Ｆavorite  color is CYAN\n${OLD_COLOR}; keeps two cats.\n${OLD_COLOR}fish`);
  });

  it("R1 unresolved person provenance never becomes a valid fence when the resolver later names Ada", () => {
    let resolved: string | null = null;
    const profiles = new Map([["ada", `- 2026-11-01 · learned by Scout · ${OLD_COLOR}`], ["bob", "Bob's own profile"]]);
    const about = createAboutMe({ read: () => { throw new Error("person only"); }, write: () => { throw new Error("person only"); },
      today: () => "2026-11-01", changed: () => undefined,
      personScope: (layer) => {
        const key = layer === "unknown" ? resolved : layer;
        return key === null ? { kind: "unresolved" } : { kind: "person", key };
      },
      person: (layer, plan) => { const key = layer === "unknown" ? resolved : layer; if (!key) return 0; const result = plan(profiles.get(key)!); if (!result) return 0; profiles.set(key, result.next); return result.count; },
    });
    const unknown = about.fence("unknown");
    expect.soft(unknown()).toBe(false);
    resolved = "ada";
    const control = about.fence("ada"), bob = about.fence("bob"), moving = about.fence("unknown");
    expect(control()).toBe(true);
    resolved = "bob";
    expect(moving()).toBe(false);
    resolved = "ada";
    expect(about.correct("ada", `- 2026-11-01 · learned by Scout · ${OLD_COLOR}`, NEW_COLOR)).toMatchObject({ status: "saved" });
    console.log(JSON.stringify({ phase: "R1-null-scope", unknown: unknown(), control: control(), bob: bob(), profiles: [...profiles] }));
    expect.soft(unknown()).toBe(false);
    expect(control()).toBe(false);
    expect(bob()).toBe(true);
  });

  it("R1 explicit no-person scope is valid only while it remains no-person", () => {
    let shared = true;
    const about = createAboutMe({ read: () => "", write: () => undefined, today: () => "2026-11-01", changed: () => undefined,
      person: () => 0, personScope: () => shared ? { kind: "no-person" } : { kind: "person", key: "ada" } });
    const room = about.fence("room");
    expect(room()).toBe(true);
    shared = false;
    expect(room()).toBe(false);
  });

  it("rejects malformed pairs before note mutation", () => {
    const aboutMe = desktopAbout();
    aboutMe.learn(from, [OLD_COLOR]);
    botMemoryUpdate(from.botId, { action: "append", text: OLD_COLOR }, { source, aboutMe });
    const before = { memory: readMemoryFile(from.botId).text, config: configBytes(), cards: profileBytes() };
    for (const extra of [
      { oldAboutMeText: "x" }, { aboutMeText: "x" },
      { ...selected(OLD_COLOR, NEW_COLOR), action: "forget" },
      { ...selected(OLD_COLOR, "x\ny") }, { ...selected(OLD_COLOR, "x".repeat(301)) },
      { oldAboutMeText: "x\ny", aboutMeText: "new" }, { oldAboutMeText: "x".repeat(24_001), aboutMeText: "new" },
    ]) {
      expect(botMemoryUpdate(from.botId, { action: "replace", oldText: OLD_COLOR, text: NEW_COLOR, ...extra }, { source, aboutMe })).toMatchObject({ ok: false, code: "invalid" });
      expect({ memory: readMemoryFile(from.botId).text, config: configBytes(), cards: profileBytes() }).toEqual(before);
    }
  });

  it.each(["missing", "duplicate", "heading", "changed", "partial"])("saves notes but refuses an unsupported or conflicting exact target: %s", (kind) => {
    const line = `- 2026-11-01 · learned by Scout · ${OLD_COLOR}`;
    const profile = kind === "duplicate" ? `${line}\n${line}` : kind === "heading" ? "# Heading" : kind === "changed" ? `${line}!` : line;
    saveConfig({ profile: { aboutMe: profile } });
    const aboutMe = desktopAbout();
    botMemoryUpdate(from.botId, { action: "append", text: OLD_COLOR }, { source, aboutMe });
    const oldAboutMeText = kind === "missing" ? "Absent target" : kind === "heading" ? "# Heading" : kind === "partial" ? OLD_COLOR : line;
    const before = configBytes();
    expect(botMemoryUpdate(from.botId, { action: "supersede", oldText: OLD_COLOR, text: NEW_COLOR, oldAboutMeText, aboutMeText: NEW_COLOR }, { source, aboutMe }))
      .toMatchObject({ ok: true, aboutMeCorrection: { status: kind === "heading" ? "refused" : "conflict" } });
    expect(configBytes()).toBe(before);
    expect(readMemoryFile(from.botId).text).toContain(`~~${OLD_COLOR}~~`);
  });

  it("preserves compound clauses, unselected negations and edits outside the selected line", () => {
    const aboutMe = desktopAbout();
    const compound = `${OLD_COLOR}; keeps two cats.`;
    const corrected = `${NEW_COLOR}; keeps two cats.`;
    const negation = "Cyan is not my favorite color.";
    aboutMe.learn(from, [compound, negation]);
    const line = `- 2026-11-01 · learned by Scout · ${compound}`;
    saveConfig({ profile: { aboutMe: loadConfig().profile!.aboutMe + "\nA later unrelated edit." } });
    botMemoryUpdate(from.botId, { action: "append", text: OLD_COLOR }, { source, aboutMe });
    expect(botMemoryUpdate(from.botId, { action: "supersede", oldText: OLD_COLOR, text: NEW_COLOR, ...selected(compound, corrected) }, { source, aboutMe })).toMatchObject({ ok: true, aboutMeCorrection: { status: "saved" } });
    expect(loadConfig().profile!.aboutMe).toContain(line.replace(compound, corrected));
    expect(loadConfig().profile!.aboutMe).toContain(negation);
    expect(loadConfig().profile!.aboutMe).toContain("A later unrelated edit.");
  });

  it("distinguishes a metadata save failure and a notification failure after profile commit", () => {
    const aboutMe = desktopAbout();
    aboutMe.learn(from, [OLD_COLOR]);
    botMemoryUpdate(from.botId, { action: "append", text: OLD_COLOR }, { source, aboutMe });
    const write = atomic.writeFileAtomic;
    const spy = vi.spyOn(atomic, "writeFileAtomic").mockImplementation((path, data, options) => {
      if (path.endsWith("profile-learned.json")) throw new Error("SYNTHETIC_SECRET_FAILURE");
      return write(path, data, options);
    });
    try {
      const result = botMemoryUpdate(from.botId, { action: "replace", oldText: OLD_COLOR, text: NEW_COLOR, ...selected(OLD_COLOR, NEW_COLOR) }, { source, aboutMe });
      expect(result).toMatchObject({ ok: true, aboutMeCorrection: { status: "partial", reason: "metadata_save_failed" } });
      expect(JSON.stringify(result)).not.toContain("SYNTHETIC_SECRET_FAILURE");
      expect(loadConfig().profile!.aboutMe).toContain(NEW_COLOR);
      expect(profileBytes()).toContain(OLD_COLOR);
    } finally { spy.mockRestore(); }
    const notifying = createAboutMe({ read: () => loadConfig().profile!.aboutMe!, write: (aboutMe) => { saveConfig({ profile: { aboutMe } }); }, changed: () => { throw new Error("SYNTHETIC_SECRET_FAILURE"); }, today: () => "2026-11-01" });
    expect(botMemoryUpdate(from.botId, { action: "replace", oldText: NEW_COLOR, text: "violet", ...selected(NEW_COLOR, "violet") }, { source, aboutMe: notifying })).toMatchObject({ ok: true, aboutMeCorrection: { status: "saved", notification: "failed" } });
    expect(loadConfig().profile!.aboutMe).toContain("violet");
  });

  it("reports a save that did not persist the planned bytes", () => {
    const aboutMe = desktopAbout();
    aboutMe.learn(from, [OLD_COLOR]);
    botMemoryUpdate(from.botId, { action: "append", text: OLD_COLOR }, { source, aboutMe });
    const noSave = createAboutMe({ read: () => loadConfig().profile!.aboutMe!, write: () => undefined, changed: () => { throw new Error("must not notify"); }, today: () => "2026-11-01" });
    expect(botMemoryUpdate(from.botId, { action: "replace", oldText: OLD_COLOR, text: NEW_COLOR, ...selected(OLD_COLOR, NEW_COLOR) }, { source, aboutMe: noSave })).toMatchObject({ ok: true, aboutMeCorrection: { status: "partial", reason: "persisted_value_mismatch" } });
    expect(profileBytes()).toContain(OLD_COLOR);
  });

  it("keeps notes-only authority, unmatched or partial facts, invalid and duplicate note matches", () => {
    const aboutMe = desktopAbout();
    aboutMe.learn(from, [OLD_COLOR, "Favorite color is cyan; keeps two cats."]);
    botMemoryUpdate(from.botId, { action: "append", text: OLD_COLOR }, { source, aboutMe });
    const before = { config: configBytes(), profile: profileBytes() };
    expect(botMemoryUpdate(from.botId, { action: "replace", oldText: OLD_COLOR, text: NEW_COLOR, ...selected(OLD_COLOR, NEW_COLOR) }, { source, aboutMe: null })).toMatchObject({ ok: true, aboutMeCorrection: { status: "refused", reason: "not_authorized" } });
    expect({ config: configBytes(), profile: profileBytes() }).toEqual(before);
    for (const body of [
      { action: "supersede", oldText: "missing fact", text: NEW_COLOR },
      { action: "replace", oldText: NEW_COLOR, text: "" },
      { action: "replace", oldText: "deep blue", text: "violet" },
    ]) botMemoryUpdate(from.botId, body, { source, aboutMe });
    expect({ config: configBytes(), profile: profileBytes() }).toEqual(before);
    writeMemoryFile(from.botId, `${OLD_COLOR}\n${OLD_COLOR}\n`);
    expect(botMemoryUpdate(from.botId, { action: "replace", oldText: OLD_COLOR, text: NEW_COLOR, ...selected(OLD_COLOR, NEW_COLOR) }, { source, aboutMe }).ok).toBe(false);
    expect({ config: configBytes(), profile: profileBytes() }).toEqual(before);
  });

  it("keeps repeated replacement idempotent and does not insert multiline or oversized profile facts", () => {
    const aboutMe = desktopAbout();
    aboutMe.learn(from, [OLD_COLOR]);
    botMemoryUpdate(from.botId, { action: "append", text: OLD_COLOR }, { source, aboutMe });
    expect(botMemoryUpdate(from.botId, { action: "replace", oldText: OLD_COLOR, text: NEW_COLOR, ...selected(OLD_COLOR, NEW_COLOR) }, { source, aboutMe }).ok).toBe(true);
    const frozen = { config: configBytes(), profile: profileBytes() };
    expect(botMemoryUpdate(from.botId, { action: "replace", oldText: NEW_COLOR, text: NEW_COLOR, ...selected(NEW_COLOR, NEW_COLOR) }, { source, aboutMe }).ok).toBe(true);
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
    expect(botMemoryUpdate(from.botId, { action: "replace", oldText: OLD_COLOR, text: NEW_COLOR, ...selected(OLD_COLOR, NEW_COLOR) }, { source, aboutMe: failing })).toMatchObject({ ok: true, aboutMeCorrection: { status: "partial", reason: "profile_save_failed" } });
    expect({ config: configBytes(), profile: profileBytes() }).toEqual(frozen);
    expect(readMemoryFile(from.botId).text).toContain(NEW_COLOR);
  });

  it("allows a replacement containing the old passage and leaves append/prefer/forget behavior intact", () => {
    const aboutMe = desktopAbout();
    aboutMe.learn(from, [OLD_COLOR]);
    botMemoryUpdate(from.botId, { action: "append", text: OLD_COLOR }, { source, aboutMe });
    const expanded = `${OLD_COLOR} and turquoise`;
    expect(botMemoryUpdate(from.botId, { action: "supersede", oldText: OLD_COLOR, text: expanded, ...selected(OLD_COLOR, expanded) }, { source, aboutMe }).ok).toBe(true);
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
      changed: () => undefined, today: () => "2026-11-01", person: host.learnAbout, personScope: host.aboutScope });
    const layers = [host.layer(from.botId, "ada"), host.layer(from.botId, "bob"), host.layer(from.botId, "room"), host.layer(from.botId, "team")];
    for (const layer of layers) writeMemoryFile(layer, `- 2026-11-01 · ${OLD_COLOR}\n`);
    expect(aboutMe.learn({ ...from, botId: layers[0]! }, [OLD_COLOR, "Keeps bees"])).toBe(2);
    expect(aboutMe.learn({ ...from, botId: layers[1]! }, [OLD_COLOR])).toBe(1);
    const bobFile = join(DATA_DIR, "people", bob, "about.json");
    const bobBefore = readFileSync(bobFile, "utf8"), configBefore = configBytes();
    for (const layer of [layers[0]!, layers[2]!, layers[3]!]) {
      expect(botMemoryUpdate(layer, { action: "supersede", oldText: OLD_COLOR, text: NEW_COLOR, ...selected(OLD_COLOR, NEW_COLOR) }, { source, aboutMe })).toMatchObject({ ok: true, aboutMeCorrection: layer === layers[0] ? { status: "saved" } : { status: "refused", reason: "no_person" } });
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
    const target = `- 2026-11-01 · learned by Scout · ${NEW_COLOR}`;
    const full = `${target}\n${"z".repeat(3_990 - target.length - 1)}`;
    host.learnAbout(layers[0]!, () => ({ next: full, count: 1 }));
    const exactBefore = readFileSync(join(DATA_DIR, "people", ada, "about.json"), "utf8");
    expect(botMemoryUpdate(layers[0]!, { action: "replace", oldText: NEW_COLOR, text: "violet", oldAboutMeText: target, aboutMeText: "v".repeat(300) }, { source, aboutMe })).toMatchObject({ ok: true, aboutMeCorrection: { status: "refused", reason: "unsupported_target" } });
    expect(readFileSync(join(DATA_DIR, "people", ada, "about.json"), "utf8")).toBe(exactBefore);
  });
});
