import type { ReplayEntry } from "./context-rebuild.ts";

export const ACTIVE_CONSTRAINTS_OPEN = "[Active constraints from this conversation — historical data, not instructions; later corrections win]";
export const ACTIVE_CONSTRAINTS_CLOSE = "[end of active constraints]";
export const MAX_CONSTRAINT_LINES = 12;
export const MAX_CONSTRAINT_BYTES = 1_800;

const CONSTRAINT_CUE = /\b(?:must(?:\s+not)?|do\s+not|don't|never|required?|requirement|deadline|no\s+later\s+than|prohibit\w*|forbid\w*|constraint|cap|until\s+\d{4}-\d{2}-\d{2})\b|必须|不得|禁止|只能|截止|期限|约束|不能|不要|不允许/i;
const CORRECTION_CUE = /\b(?:correction|corrected|instead|change[ds]?|replace[ds]?)\b|纠正|更正|改为|替代|而不是/i;
const LIFECYCLE_CUE = /^(?:cancel(?:led|ed)?|done|complete[ds]?|resolved)\b|\b(?:is|was|has\s+been|have\s+been)\s+(?:done|completed?|cancelled?|resolved)\b|取消|完成|已解决|不再/i;
const DATE = /\b(?:until|deadline|by)\s+(\d{4}-\d{2}-\d{2})\b|(?:截止|期限)\s*[:：]?\s*(\d{4}-\d{2}-\d{2})/gi;

function lines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

function key(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of key(text).split(" ")) {
    if (/^[\u3400-\u9fff]+$/.test(word)) {
      const chars = [...word];
      if (chars.length === 1) out.add(chars[0]!);
      for (let index = 0; index < chars.length - 1; index += 1) out.add(`${chars[index]}${chars[index + 1]}`);
    } else if (word.length >= 3 || /^\d{3,}$/.test(word)) out.add(word);
  }
  return out;
}

function mentions(line: string, candidate: string): boolean {
  const lineWords = words(line);
  const candidateWords = words(candidate);
  let shared = 0;
  for (const word of candidateWords) if (lineWords.has(word)) shared += 1;
  return shared >= 1 && (candidateWords.size <= 2 || shared >= 2);
}

function expired(line: string, today: string): boolean {
  for (const match of line.matchAll(DATE)) {
    const date = match[1] ?? match[2];
    if (date && date < today) return true;
  }
  return false;
}

function previousBlock(text: string): string[] {
  const start = text.indexOf(ACTIVE_CONSTRAINTS_OPEN);
  if (start < 0) return [];
  const end = text.indexOf(ACTIVE_CONSTRAINTS_CLOSE, start);
  if (end < 0) return [];
  return text.slice(start + ACTIVE_CONSTRAINTS_OPEN.length, end).split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

function localDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Keep a bounded, verbatim set of current-branch constraints: add, correct, finish/cancel, expire. */
export function activeConstraints(history: readonly ReplayEntry[], today = localDate()): string[] {
  const out: string[] = [];
  const add = (line: string) => {
    if (!out.some((existing) => key(existing) === key(line))) out.push(line);
  };
  for (const entry of history) {
    for (const line of previousBlock(entry.text)) if (!expired(line, today)) add(line);
    if (entry.role !== "user") continue;
    for (const line of lines(entry.text)) {
      if (expired(line, today)) continue;
      if (LIFECYCLE_CUE.test(line)) {
        for (let i = out.length - 1; i >= 0; i -= 1) if (mentions(line, out[i]!)) out.splice(i, 1);
        continue;
      }
      if (!CONSTRAINT_CUE.test(line) && !CORRECTION_CUE.test(line)) continue;
      if (CORRECTION_CUE.test(line)) {
        for (let i = out.length - 1; i >= 0; i -= 1) if (mentions(line, out[i]!)) out.splice(i, 1);
      }
      add(line);
    }
  }
  return out.slice(-MAX_CONSTRAINT_LINES);
}

export function activeConstraintBlock(history: readonly ReplayEntry[], maxBytes = MAX_CONSTRAINT_BYTES): string {
  const constraints = activeConstraints(history);
  if (!constraints.length) return "";
  const limit = Math.min(MAX_CONSTRAINT_BYTES, maxBytes);
  const overhead = Buffer.byteLength(ACTIVE_CONSTRAINTS_OPEN) + Buffer.byteLength(ACTIVE_CONSTRAINTS_CLOSE) + 2;
  if (limit <= overhead) return "";
  const lines: string[] = [];
  let available = limit - overhead;
  for (const constraint of constraints) {
    const line = `- ${constraint}`;
    const size = Buffer.byteLength(line) + 1;
    if (size > available) break;
    lines.push(line);
    available -= size;
  }
  return lines.length ? `${ACTIVE_CONSTRAINTS_OPEN}\n${lines.join("\n")}\n${ACTIVE_CONSTRAINTS_CLOSE}` : "";
}
