import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, expect, it, vi } from "vitest";
import { DATA_DIR } from "./config.ts";
import { closeMessageDb, recallMessages } from "./message-db.ts";
import { CHINESE_RECALL_TABLE, ensureChineseRecallIndex } from "./message-recall-index.ts";
import { recallChineseMessages } from "./message-recall-chinese.ts";
import { legacyRecallDatabase, putSyntheticMessage } from "./testing/chinese-history-fixture.ts";

beforeEach(() => { closeMessageDb(); rmSync(DATA_DIR, { recursive: true, force: true }); mkdirSync(DATA_DIR, { recursive: true }); });
const row = { id: "legacy", text: "我们通过远程桌面管理自己的服务器。LEGACY", at: 100, role: "user" as const, kind: "text" as const };

it("backfills an existing baseline database completely and reopens idempotently", () => {
  const file = join(DATA_DIR, "messages.db");
  const legacy = legacyRecallDatabase(file);
  putSyntheticMessage(legacy, "own", row);
  putSyntheticMessage(legacy, "private", { ...row, id: "private", text: "远程桌面 PRIVATE" });
  legacy.close();
  for (let i = 0; i < 3; i++) {
    expect(recallMessages("远程桌面", ["own"]).map((hit) => hit.messageId)).toEqual(["legacy"]);
    closeMessageDb();
    const inspect = new DatabaseSync(file);
    expect(inspect.prepare("SELECT version FROM message_recall_indexes WHERE name = ?").get(CHINESE_RECALL_TABLE)).toMatchObject({ version: 1 });
    expect(inspect.prepare(`SELECT count(*) AS n FROM ${CHINESE_RECALL_TABLE}`).get()).toMatchObject({ n: 2 });
    inspect.close();
  }
});

it("rolls back an incomplete first backfill and retries without duplicates", () => {
  const db = legacyRecallDatabase(join(DATA_DIR, "messages.db"));
  putSyntheticMessage(db, "own", row);
  const exec = db.exec.bind(db);
  const failure = vi.spyOn(db, "exec").mockImplementation((sql) => {
    if (sql.startsWith(`INSERT INTO ${CHINESE_RECALL_TABLE}(rowid`)) throw new Error("fixture backfill failed");
    return exec(sql);
  });
  try {
    expect(() => ensureChineseRecallIndex(db)).toThrow("fixture backfill failed");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(CHINESE_RECALL_TABLE)).toBeUndefined();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'message_recall_indexes'").get()).toBeUndefined();
    failure.mockRestore();
    ensureChineseRecallIndex(db);
    ensureChineseRecallIndex(db, true);
    ensureChineseRecallIndex(db, true);
    expect(recallChineseMessages(db, "远程桌面", ["own"], 12).map((hit) => hit.messageId)).toEqual(["legacy"]);
    expect(db.prepare(`SELECT count(*) AS n FROM ${CHINESE_RECALL_TABLE}`).get()).toMatchObject({ n: 1 });
  } finally { failure.mockRestore(); db.close(); }
});

it("keeps the committed index when a rebuild fails and supports writes from another SQLite connection", () => {
  const file = join(DATA_DIR, "messages.db");
  const db = legacyRecallDatabase(file);
  putSyntheticMessage(db, "own", row);
  ensureChineseRecallIndex(db);
  const exec = db.exec.bind(db);
  const failure = vi.spyOn(db, "exec").mockImplementation((sql) => {
    if (sql.startsWith(`INSERT INTO ${CHINESE_RECALL_TABLE}(rowid`)) throw new Error("fixture rebuild failed");
    return exec(sql);
  });
  try {
    expect(() => ensureChineseRecallIndex(db, true)).toThrow("fixture rebuild failed");
    failure.mockRestore();
    expect(recallChineseMessages(db, "远程桌面", ["own"], 12)).toHaveLength(1);
    const other = new DatabaseSync(file);
    try {
      putSyntheticMessage(other, "own", { ...row, id: "external", text: "远程桌面 EXTERNAL" });
      other.prepare("UPDATE messages SET json = json_set(json, '$.parentId', 'legacy') WHERE id = 'external'").run();
      expect(recallChineseMessages(db, "远程桌面", ["own"], 12)).toHaveLength(2);
      other.prepare("DELETE FROM messages WHERE id = 'external'").run();
      expect(recallChineseMessages(db, "远程桌面", ["own"], 12)).toHaveLength(1);
    } finally { other.close(); }
  } finally { failure.mockRestore(); db.close(); }
});
