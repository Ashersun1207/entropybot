import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { countFtsRecallMatches, RECALL_EVIDENCE_SQL } from "./message-recall-evidence.ts";
import { ftsQuery } from "./message-recall-terms.ts";
import { legacyRecallDatabase, putSyntheticMessage } from "./testing/chinese-history-fixture.ts";

let db: ReturnType<typeof legacyRecallDatabase>;
const identity = { threadId: "fixture-owned", messageId: "same-id" };
const query = "café résumé quarterly office budget";
const put = (text: string, thread = identity.threadId) => putSyntheticMessage(db, thread, { id: identity.messageId, at: 1793966400000, role: "user", kind: "text", text });
beforeEach(() => { db = legacyRecallDatabase(":memory:"); });
afterEach(() => db.close());

it("uses real SQLite highlights and deduplicates repeated source words rather than query aliases", () => {
  const source = "Café Café CAFÉ appointment. [wrong] [unrelated]";
  put(source);
  expect(countFtsRecallMatches(db, "café cafés quarterly office budget", identity, source)).toBe(1);
});

it.each([
  { request: "café cafés quarterly office budget", source: "Café appointment." },
  { request: "ộtestword dentist quarterly office budget", source: "otestword dentist appointment." },
])("counts exactly one native SQLite match for $request", ({ request, source }) => {
  put(source);
  expect(countFtsRecallMatches(db, request, identity, source)).toBe(1);
});

it("chooses markers absent from source and does not count user-provided markers or brackets", () => {
  const source = "Café résumé. \uE000entropybot-fts:collision:open\uE001user text\uE000entropybot-fts:collision:close\uE001 [wrong] [unrelated]";
  put(source);
  const nonce = vi.fn().mockReturnValueOnce("collision").mockReturnValue("unique");
  expect(countFtsRecallMatches(db, query, identity, source, nonce)).toBe(2);
  expect(nonce).toHaveBeenCalledTimes(2);
  const colliding = vi.fn(() => "collision");
  expect(countFtsRecallMatches(db, query, identity, source, colliding)).toBe(0);
  expect(colliding).toHaveBeenCalledTimes(4);
});

it("binds the thread/message identity and rejects changed, deleted and non-recall source rows", () => {
  const source = "Café appointment.";
  put(source);
  put("Café résumé private.", "fixture-private");
  expect(countFtsRecallMatches(db, query, identity, source)).toBe(1);
  expect(countFtsRecallMatches(db, "quarterly office budget reform staff", identity, source)).toBe(0);
  expect(countFtsRecallMatches(db, query, { ...identity, threadId: "fixture-private" }, source)).toBe(0);
  db.prepare("UPDATE messages SET text = 'Café résumé changed.' WHERE thread_id = ? AND id = ?").run(identity.threadId, identity.messageId);
  expect(countFtsRecallMatches(db, query, identity, source)).toBe(0);
  db.prepare("UPDATE messages SET kind = 'activity', text = ? WHERE thread_id = ? AND id = ?").run(source, identity.threadId, identity.messageId);
  expect(countFtsRecallMatches(db, query, identity, source)).toBe(0);
  db.prepare("DELETE FROM messages WHERE thread_id = ? AND id = ?").run(identity.threadId, identity.messageId);
  expect(countFtsRecallMatches(db, query, identity, source)).toBe(0);
});

it("uses a bound primary-key lookup and rowid-constrained native MATCH", () => {
  put("Café résumé appointment.");
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${RECALL_EVIDENCE_SQL}`).all("open", "close", identity.threadId, identity.messageId, ftsQuery(query, "any")!);
  const details = JSON.stringify(plan);
  expect(details).toContain("thread_id=? AND id=?");
  expect(details).toContain("rowid=?");
  expect(details).toMatch(/VIRTUAL TABLE INDEX[^"\n]*=/);
  expect(details).not.toMatch(/SCAN messages(?: |")/);
});
