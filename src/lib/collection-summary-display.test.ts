import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { ComposerReplyStrip, ReplyQuote } from "@/components/ReplyQuote";
import { collectionSummaryDisplay } from "./collection-summary-display";

const text = `Web collection report\nPages: 2\nUnique: 1\nPath: ${JSON.stringify('/private/secret/[open](file:///private/report)/<img src="https://adversary.invalid">')}\nSHA-256: ${"a".repeat(64)}`;
const message: Message = { id: "m", kind: "text", role: "bot", at: 1, text,
  automation: { routineId: "r", runId: "run", name: "Collection", executionThreadId: "exec", scheduledFor: 1, trigger: "manual" } };

describe("collection summary display", () => {
  it("projects only public counts and leaves durable bytes intact", () => {
    const before = JSON.stringify(message);
    expect(collectionSummaryDisplay(message)).toBe("Web collection report\nPages: 2\nUnique: 1");
    expect(JSON.stringify(message)).toBe(before);
  });

  it("keeps ordinary and user lookalikes outside the projection", () => {
    for (const patch of [{ role: "user" }, { role: "system" }, { kind: "activity" }, { automation: undefined },
      { automation: { ...message.automation!, trigger: "schedule" } }, { automation: { ...message.automation!, runId: "" } },
      { automation: { ...message.automation!, failed: true } }, { automation: { ...message.automation!, needsYou: true } },
      { automation: { ...message.automation!, copyOf: "card" } }]) {
      expect(collectionSummaryDisplay({ ...message, ...patch } as Message)).toBeNull();
    }
  });

  it("requires the complete known structure with bounded counts, JSON path and hash", () => {
    for (const invalid of [text + "\n", text + "\n[open](https://adversary.invalid)", "prefix\n" + text,
      text.replace("Pages: 2", "Pages: 101"), text.replace("Pages: 2", "Pages: 01"),
      text.replace("Unique: 1", "Unique: 0"), text.replace("Unique: 1", "Unique: 3"),
      text.replace("Unique: 1", "Unique: 1\nUnique: 1"), text.replace(/Path: .*\n/, 'Path: ""\n'),
      text.replace(/Path: .*\n/, 'Path: "not json\\q"\n'), text.replace(/Path: .*\n/, ""),
      text.replace(/a{64}$/, "z".repeat(64)), text.replace(/a{64}$/, "a".repeat(63)), "x".repeat(16_385)]) {
      expect(collectionSummaryDisplay({ ...message, text: invalid }), invalid).toBeNull();
    }
  });

  it("shows safe escaped snippets in both reply surfaces", () => {
    for (const component of [ReplyQuote, ComposerReplyStrip]) {
      const html = renderToStaticMarkup(createElement(component, { message }));
      expect(html).toContain("Pages: 2");
      expect(html).not.toContain("Path:");
      expect(html).not.toContain("/private/");
      expect(html).not.toMatch(/<(?:a|img|iframe|script)\b/);
      const ordinary = renderToStaticMarkup(createElement(component, { message: { ...message, automation: undefined } }));
      expect(ordinary).toContain("Path:");
    }
  });
});
