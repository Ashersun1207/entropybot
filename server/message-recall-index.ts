import type { DatabaseSync } from "node:sqlite";

export const CHINESE_RECALL_TABLE = "messages_cjk_fts";
const VERSION = 1;

export function ensureChineseRecallIndex(db: DatabaseSync, rebuild = false): void {
  const existed = db.prepare("SELECT 1 FROM sqlite_master WHERE name = ? AND type = 'table'").get(CHINESE_RECALL_TABLE);
  db.exec("SAVEPOINT chinese_recall_index");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS message_recall_indexes (name TEXT PRIMARY KEY, version INTEGER NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS ${CHINESE_RECALL_TABLE} USING fts5(text, scope, content='', tokenize='trigram');
    `);
    const completed = db.prepare("SELECT version FROM message_recall_indexes WHERE name = ?").get(CHINESE_RECALL_TABLE) as { version: number } | undefined;
    const triggers = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name IN ('messages_cjk_ai', 'messages_cjk_ad', 'messages_cjk_au')").get() as { n: number };
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_cjk_ai AFTER INSERT ON messages BEGIN
        INSERT INTO ${CHINESE_RECALL_TABLE}(rowid, text, scope) VALUES (new.rowid, coalesce(new.text, ''), 'thread:' || new.thread_id);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_cjk_ad AFTER DELETE ON messages BEGIN
        INSERT INTO ${CHINESE_RECALL_TABLE}(${CHINESE_RECALL_TABLE}, rowid, text, scope) VALUES ('delete', old.rowid, coalesce(old.text, ''), 'thread:' || old.thread_id);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_cjk_au AFTER UPDATE ON messages BEGIN
        INSERT INTO ${CHINESE_RECALL_TABLE}(${CHINESE_RECALL_TABLE}, rowid, text, scope) VALUES ('delete', old.rowid, coalesce(old.text, ''), 'thread:' || old.thread_id);
        INSERT INTO ${CHINESE_RECALL_TABLE}(rowid, text, scope) VALUES (new.rowid, coalesce(new.text, ''), 'thread:' || new.thread_id);
      END;
    `);
    if (rebuild || !existed || completed?.version !== VERSION || triggers.n !== 3) {
      db.exec(`INSERT INTO ${CHINESE_RECALL_TABLE}(${CHINESE_RECALL_TABLE}) VALUES ('delete-all')`);
      db.exec(`INSERT INTO ${CHINESE_RECALL_TABLE}(rowid, text, scope) SELECT rowid, coalesce(text, ''), 'thread:' || thread_id FROM messages`);
      db.prepare("INSERT INTO message_recall_indexes(name, version) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET version = excluded.version").run(CHINESE_RECALL_TABLE, VERSION);
    }
    db.exec("RELEASE chinese_recall_index");
  } catch (error) {
    db.exec("ROLLBACK TO chinese_recall_index");
    db.exec("RELEASE chinese_recall_index");
    throw error;
  }
}
