import type { DatabaseSync } from "node:sqlite";
import type { RecallHit, RecallRange, SearchMode } from "./message-db.ts";
import { peerProvenanceAuthor } from "./peer-provenance.ts";
import { CHINESE_RECALL_TABLE } from "./message-recall-index.ts";

const HAN = /\p{Script=Han}/u;
const FILLER = /请问|请查|帮我|上次|之前|以前|我们|你们|他们|什么|怎么|如何|是否|一下|那个|这个|哪里|哪个|多少|能否|可以|关于|记得|记住|聊过|说过|有关|以及|和|现在|后来|当时|已经|需要|好的|谢谢|明白|收到|你好|您好|的|了|吗|呢|啊|吧|是|我|你/u;
export const CHINESE_RECALL_QUERY_GRAMS = 16;
const CANDIDATES = 48;

export function chineseRecallQuery(query: string): { phrases: string[]; grams: string[]; anchors: string[]; minimum: number; short: boolean } | null {
  if (!HAN.test(query)) return null;
  const runs = [...new Set((query.slice(0, 500).match(/\p{Script=Han}+/gu) ?? []).flatMap((run) => run.split(FILLER)))].filter((run) => new Set(run).size >= 2);
  const chinese = runs.filter((run) => [...run].length >= 3);
  const latin = query.slice(0, 500).toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [];
  const phrases = (chinese.length ? chinese : runs.some((run) => [...run].length >= 2) && latin.length ? [...runs, ...latin] : []).slice(0, 16);
  const grams = [...new Set(phrases.flatMap((phrase) => {
    const chars = [...phrase];
    return chars.slice(0, -2).map((_, i) => chars.slice(i, i + 3).join(""));
  }))].slice(0, CHINESE_RECALL_QUERY_GRAMS);
  if (!grams.length) return null;
  const anchors = [...new Set(phrases.flatMap((phrase) => {
    const chars = [...phrase];
    const size = Math.min(4, chars.length);
    return chars.slice(0, 1 - size).map((_, i) => chars.slice(i, i + size).join(""));
  }))].filter((anchor) => grams.includes([...anchor].slice(0, 3).join(""))).slice(0, 16);
  return { phrases, grams, anchors, minimum: Math.max(1, Math.ceil(grams.length / 2)), short: [...query.trim()].length <= 4 };
}

export function chineseRecallMatches(query: string, text: string): boolean {
  const plan = chineseRecallQuery(query);
  if (!plan) return false;
  text = text.toLowerCase();
  const exact = plan.phrases.some((phrase) => text.includes(phrase));
  return (!plan.short || exact) && plan.anchors.some((anchor) => text.includes(anchor))
    && plan.grams.filter((gram) => text.includes(gram)).length >= plan.minimum;
}

const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;

export function chineseRecallSql(query: string, threadIds: readonly string[], limit: number, range?: RecallRange, mode: SearchMode = "all", allTerms = query.trim().split(/\s+/)): { sql: string; params: Array<string | number> } | null {
  const plan = chineseRecallQuery(query);
  if (!plan || !threadIds.length || !Number.isSafeInteger(limit) || limit <= 0) return null;
  if ((range?.since !== undefined && !Number.isFinite(range.since)) || (range?.until !== undefined && !Number.isFinite(range.until))) return null;
  const threads = [...new Set(threadIds)];
  const score = plan.grams.map(() => "(instr(lower(m.text), ?) > 0)").join(" + ");
  const exact = plan.phrases.map(() => "(instr(lower(m.text), ?) > 0)").join(" + ");
  const params: Array<string | number> = [...plan.grams, ...plan.phrases];
  const match = `text : (${plan.grams.map(quote).join(" OR ")}) AND scope : (${threads.map((id) => quote(`thread:${id}`)).join(" OR ")})`;
  params.push(match, ...threads);
  const filters: string[] = [];
  if (range?.since !== undefined) { filters.push("m.at >= ?"); params.push(range.since); }
  if (range?.until !== undefined) { filters.push("m.at <= ?"); params.push(range.until); }
  if (mode === "all") {
    for (const term of allTerms.flatMap((value) => value.split(/(?<=\p{Script=Han})(?=[a-z])|(?<=[a-z0-9])(?=\p{Script=Han})/iu)).filter(Boolean)) {
      filters.push("instr(lower(m.text), lower(?)) > 0");
      params.push(term.replace(/"/g, ""));
    }
  }
  filters.push(`(${plan.anchors.map(() => "instr(lower(m.text), ?) > 0").join(" OR ")})`);
  params.push(...plan.anchors, plan.minimum, Math.min(limit, CANDIDATES));
  return {
    sql: `SELECT m.thread_id, m.id, m.at, m.role, m.kind, m.text,
      json_extract(m.json, '$.from.name') AS from_name, json_extract(m.json, '$.peerAsk.name') AS peer_name,
      (${score}) AS overlap, (${exact}) AS exact
      FROM ${CHINESE_RECALL_TABLE} JOIN messages m ON m.rowid = ${CHINESE_RECALL_TABLE}.rowid
      WHERE ${CHINESE_RECALL_TABLE} MATCH ? AND m.thread_id IN (${threads.map(() => "?").join(",")})
      AND m.kind IN ('text', 'digest') ${filters.map((filter) => `AND ${filter}`).join(" ")}
      AND overlap >= ? ${plan.short ? "AND exact > 0" : ""}
      ORDER BY (m.kind = 'digest'), exact DESC, overlap DESC, m.at DESC, m.thread_id, m.id LIMIT ?`,
    params,
  };
}

function snippet(text: string, query: string): string {
  const plan = chineseRecallQuery(query)!;
  const lower = text.toLowerCase();
  const anchor = [...plan.phrases].sort((a, b) => b.length - a.length).find((phrase) => lower.includes(phrase)) ?? plan.anchors.find((anchor) => lower.includes(anchor))!;
  const start = Math.max(0, lower.indexOf(anchor) - 80);
  return `${start ? "…" : ""}${text.slice(start, start + 600).replace(/\s+/g, " ").trim()}${start + 600 < text.length ? "…" : ""}`;
}

export function recallChineseMessages(db: DatabaseSync, query: string, threadIds: readonly string[], limit: number, range?: RecallRange, mode: SearchMode = "all", allTerms?: string[]): RecallHit[] {
  const spec = chineseRecallSql(query, threadIds, limit, range, mode, allTerms);
  if (!spec) return [];
  const rows = db.prepare(spec.sql).all(...spec.params) as Array<{ thread_id: string; id: string; at: number; role: string; kind: string; text: string; from_name: string | null; peer_name: string | null }>;
  return rows.map((row) => {
    const peer = row.peer_name ?? peerProvenanceAuthor(row.text.slice(0, 160));
    return { threadId: row.thread_id, messageId: row.id, at: row.at, role: row.role,
      ...(row.kind === "digest" ? { kind: "digest" as const } : {}), snippet: snippet(row.text, query),
      ...(row.from_name ? { from: row.from_name } : {}), ...(peer ? { peer } : {}),
    };
  });
}

export function hasHan(text: string): boolean { return HAN.test(text); }
