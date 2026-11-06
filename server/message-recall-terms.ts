export type SearchMode = "all" | "any";

export interface RecallRange {
  since?: number;
  until?: number;
}

const STOP_WORDS = new Set(
  "a an and are as at be by did do for from had has have how i in is it its of on or that the this to was we were what when where which who why with you your".split(" "),
);

export function ftsAllTerms(query: string): string[] {
  const tokens = query.split(/\s+/).map((token) => token.replace(/"/g, "").trim()).filter(Boolean);
  const content = tokens.filter((token) => !STOP_WORDS.has(token.toLowerCase()));
  return content.length ? content : tokens;
}

/** Quote every token so FTS5 searches `AND`, `NOT`, `*`, `:` literally instead of parsing them. */
export function ftsQuery(query: string, mode: SearchMode = "all"): string | null {
  const tokens = ftsAllTerms(query);
  if (!tokens.length) return null;
  if (mode === "any") {
    const terms = recallTerms(query).map(recallMatchTerm).filter(Boolean);
    return terms.length ? terms.join(" OR ") : null;
  }
  return tokens.map((token) => `"${token}"`).join(" ");
}

function normalizeRecallText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function recallTermRule(term: string): { text: string; prefix: boolean } | null {
  term = term.replace(/\p{L}\p{M}+/gu, (part) => part.normalize("NFC"));
  if (!/^[\p{L}\p{N}]+$/u.test(term)) return null;
  const prefix = /^\p{L}{4,}$/u.test(term);
  const text = prefix && term.length > 4 && term.endsWith("s") && !term.endsWith("ss") ? term.slice(0, -1) : term;
  return { text, prefix };
}

/** FTS5's unicode61 tokenizer cannot tell "-10" from "10" or "c++" from "c", even quoted, so punctuation terms are skipped. */
export function recallMatchTerm(term: string): string | null {
  const rule = recallTermRule(term);
  return rule ? `"${rule.text}"${rule.prefix ? "*" : ""}` : null;
}

export function matchedRecallTerms(terms: readonly string[], source: string): number {
  const words = normalizeRecallText(source).match(/[\p{L}\p{N}]+/gu) ?? [];
  const matches = new Set<string>();
  for (const term of terms) {
    const rule = recallTermRule(term);
    if (!rule) continue;
    const text = normalizeRecallText(rule.text);
    if (words.some((word) => rule.prefix ? word.startsWith(text) : word === text)) matches.add(normalizeRecallText(term));
  }
  return matches.size;
}

const RECALL_FILLER = new Set(
  "about again also any anything can could does don't know me my please remember remind should tell there they us would hi hello hey thanks thank ok okay yes yeah no i'm im i've i'll i'd you're quick just".split(" "),
);

export function recallTerms(query: string): string[] {
  const out: string[] = [];
  for (const raw of query.split(/\s+|(?<=\p{L})[/,;:.—–-]+(?=\p{L})/u)) {
    const token = raw.replace(/"/g, "").replace(/^[\s.,;:!?()[\]{}'`“”‘’]+|[\s.,;:!?()[\]{}'`“”‘’]+$/g, "").toLowerCase();
    if (token.length < 2 && !/\d/.test(token)) continue;
    if (!/[\p{L}\p{N}]/u.test(token)) continue;
    if (STOP_WORDS.has(token) || RECALL_FILLER.has(token)) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out.slice(0, 16);
}

export function rangeClause(range: RecallRange | undefined, column: string): { sql: string; params: number[] } {
  const parts: string[] = [];
  const params: number[] = [];
  if (range?.since !== undefined) {
    parts.push(`${column} >= ?`);
    params.push(range.since);
  }
  if (range?.until !== undefined) {
    parts.push(`${column} <= ?`);
    params.push(range.until);
  }
  return { sql: parts.map((part) => ` AND ${part}`).join(""), params };
}
