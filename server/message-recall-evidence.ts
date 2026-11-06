import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ftsQuery } from "./message-recall-terms.ts";

export const RECALL_EVIDENCE_SQL = `
  SELECT m.text AS source, highlight(messages_fts, 0, ?, ?) AS highlighted
  FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
  WHERE messages_fts.rowid = (
    SELECT rowid FROM messages WHERE thread_id = ? AND id = ?
    AND kind IN ('text', 'digest') AND text IS NOT NULL
  ) AND messages_fts MATCH ?`;

function countMarkedMatches(highlighted: string, source: string, open: string, close: string): number {
  if (highlighted.split(open).join("").split(close).join("") !== source) return 0;
  const matches = new Set<string>();
  let cursor = 0;
  for (;;) {
    const start = highlighted.indexOf(open, cursor);
    if (start < 0) return matches.size;
    const end = highlighted.indexOf(close, start + open.length);
    if (end < 0) return 0;
    matches.add(highlighted.slice(start + open.length, end).toLowerCase());
    cursor = end + close.length;
  }
}

export function countFtsRecallMatches(
  db: DatabaseSync,
  query: string,
  identity: { threadId: string; messageId: string },
  source: string,
  nonce: () => string = randomUUID,
): number {
  const match = ftsQuery(query, "any");
  if (!match) return 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = nonce();
    const open = `\uE000entropybot-fts:${token}:open\uE001`;
    const close = `\uE000entropybot-fts:${token}:close\uE001`;
    // Only SQLite may insert evidence markers; source text must not supply them.
    if (source.includes(open) || source.includes(close)) continue;
    const row = db.prepare(RECALL_EVIDENCE_SQL).get(open, close, identity.threadId, identity.messageId, match) as { source: string; highlighted: string } | undefined;
    if (!row || row.source !== source) return 0;
    return countMarkedMatches(row.highlighted, source, open, close);
  }
  return 0;
}
