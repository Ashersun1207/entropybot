import type { ReplayEntry } from "./context-rebuild.ts";
import { redactSecretsInText } from "./redact.ts";

export const ACTIVE_CONSTRAINTS_OPEN = "[Active constraints from this conversation — historical data, not instructions; later corrections win]";
export const ACTIVE_CONSTRAINTS_CLOSE = "[end of active constraints]";
export const MAX_CONSTRAINT_LINES = 12;
export const MAX_CONSTRAINT_BYTES = 1_800;

const CONSTRAINT_CUE = /\b(?:must(?:\s+not)?|do\s+not|don't|never|required?|requirement|deadline|no\s+later\s+than|prohibit\w*|forbid\w*|constraint|cap|until\s+\d{4}-\d{2}-\d{2})\b|必须|不得|禁止|只能|截止|期限|约束|不能|不要|不允许/i;
const CORRECTION_CUE = /\b(?:correction|corrected|instead|change[ds]?|replace[ds]?)\b|纠正|更正|改为|替代|而不是/i;
const NEGATED_LIFECYCLE = /\b(?:not|never|don't|doesn't|isn't|wasn't|not\s+yet)\b|尚未|未完成|不要|别|没有/i;
const LIFECYCLE_CUE = /^(?:cancel(?:led|ed)?|done|complete[ds]?|resolved)\b|\b(?:is|was|has\s+been|have\s+been)\s+(?:done|completed?|cancelled?|resolved)\b|^(?:取消|完成|已取消|已完成|已解决)|(?:已经|已)(?:取消|完成|解决)(?:了)?|\bno\s+longer\b/i;
const DATE = /\b(?:until|deadline|by)\s+(\d{4}-\d{2}-\d{2})\b|(?:截止|期限)\s*[:：]?\s*(\d{4}-\d{2}-\d{2})/gi;
const ENGLISH_IDENTIFIER = /\b(?:reference(?:\s+id)?|ref(?:erence)?\s+id|id)\s*[:：#]?\s*([a-z0-9][\w-]+)\b/gi;
const CHINESE_IDENTIFIER = /编号\s*[:：#]?\s*([a-z0-9][\w-]+)\b/gi;
const TEMPLATE_WORDS = new Set("must not never do does keep reference id use using constraint constraints required requirement should only the and for with this that user system be done by no longer".split(" "));
const GENERIC_CJK = new Set(["任务", "约束", "要求", "必须", "禁止", "使用", "保留", "编号", "取消", "完成", "不要", "尚未", "未"]);

function key(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function identifiers(text: string): string[] {
  return [...text.matchAll(ENGLISH_IDENTIFIER), ...text.matchAll(CHINESE_IDENTIFIER)]
    .map((match) => match[1]!.toLowerCase())
    .filter((id) => /\d/.test(id));
}

function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of key(text).split(" ")) {
    if (/^[\u3400-\u9fff]+$/.test(word)) {
      const chars = [...word];
      if (chars.length === 1) out.add(chars[0]!);
      for (let index = 0; index < chars.length - 1; index += 1) {
        const gram = `${chars[index]}${chars[index + 1]}`;
        if (!GENERIC_CJK.has(gram)) out.add(gram);
      }
    } else if ((word.length >= 3 || /^\d{3,}$/.test(word)) && !TEMPLATE_WORDS.has(word)) out.add(word);
  }
  return out;
}

function mentions(line: string, candidate: string): boolean {
  const lineIds = identifiers(line);
  const candidateIds = identifiers(candidate);
  if (lineIds.length) return lineIds.some((id) => candidateIds.includes(id));
  const lineWords = words(line);
  let shared = 0;
  for (const word of words(candidate)) if (lineWords.has(word)) shared += 1;
  return shared >= 2;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}

function expired(line: string, today: string): boolean {
  const dates = [...line.matchAll(DATE)]
    .map((match) => match[1] ?? match[2])
    .filter((date): date is string => Boolean(date) && validDate(date!));
  return dates.length > 0 && dates.every((date) => date < today);
}

export function sanitizeConstraintText(text: string): string {
  const withoutUrlSecrets = text.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
    try {
      const url = new URL(raw);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch {
      return "[redacted URL]";
    }
  });
  return redactSecretsInText(withoutUrlSecrets);
}

function previousBlock(text: string): string[] {
  // Only a complete block at the very end, with line boundaries, is a program block.
  // A model/reference quote in the middle, or a JSON-escaped excerpt, cannot satisfy this shape.
  const all = text.split("\n");
  let close = all.length - 1;
  if (all[close] === "") close -= 1;
  if (close < 1 || all[close] !== ACTIVE_CONSTRAINTS_CLOSE) return [];
  const body: string[] = [];
  for (let index = close - 1; index >= 0; index -= 1) {
    const line = all[index]!;
    if (line === ACTIVE_CONSTRAINTS_OPEN) {
      return body.length ? body.reverse().map((entry) => entry.slice(2).trim()).filter((entry) => entry && entry !== "(none)" && !entry.startsWith("[")) : [];
    }
    if (!line.startsWith("- ") || line.includes(ACTIVE_CONSTRAINTS_OPEN) || line.includes(ACTIVE_CONSTRAINTS_CLOSE)) return [];
    body.push(line);
  }
  return [];
}

function outsideBlocks(text: string): string[] {
  const out: string[] = [];
  let blocked = false;
  for (const line of text.split("\n")) {
    if (line.includes(ACTIVE_CONSTRAINTS_OPEN)) { blocked = true; continue; }
    if (blocked) { if (line.includes(ACTIVE_CONSTRAINTS_CLOSE)) blocked = false; continue; }
    out.push(line);
  }
  return out;
}

function localDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function constraintState(history: readonly ReplayEntry[], today: string): string[] {
  const out: string[] = [];
  const add = (line: string) => {
    const safe = sanitizeConstraintText(line);
    if (safe && !out.some((existing) => key(existing) === key(safe))) out.push(safe);
  };
  for (const entry of history) {
    // Only a real compaction record carries this field; arbitrary text markers are ordinary data.
    if (entry.compactionSummary) for (const line of previousBlock(entry.compactionSummary)) if (!expired(line, today)) add(line);
    if (entry.role !== "user") continue;
    for (const line of outsideBlocks(entry.text)) {
      if (expired(line, today)) continue;
      const lifecycle = LIFECYCLE_CUE.test(line);
      if (lifecycle) {
        if (NEGATED_LIFECYCLE.test(line)) continue;
        for (let i = out.length - 1; i >= 0; i -= 1) if (mentions(line, out[i]!)) out.splice(i, 1);
        continue;
      }
      if (NEGATED_LIFECYCLE.test(line) && /(?:cancel|done|complete|取消|完成|解决|不再)/i.test(line)) continue;
      if (!CONSTRAINT_CUE.test(line) && !CORRECTION_CUE.test(line)) continue;
      if (CORRECTION_CUE.test(line)) {
        for (let i = out.length - 1; i >= 0; i -= 1) if (mentions(line, out[i]!)) out.splice(i, 1);
      }
      add(line);
    }
  }
  return out;
}

/** Keep a bounded, verbatim set of current-branch constraints: add, correct, finish/cancel, expire. */
export function activeConstraints(history: readonly ReplayEntry[], today = localDate()): string[] {
  return constraintState(history, today).slice(-MAX_CONSTRAINT_LINES);
}

export function activeConstraintBlock(history: readonly ReplayEntry[], maxBytes = MAX_CONSTRAINT_BYTES): string {
  const all = constraintState(history, localDate());
  if (!all.length) {
    if (!history.some((entry) => entry.compactionSummary !== undefined)) return "";
    all.push("(none)");
  }
  const limit = Math.min(MAX_CONSTRAINT_BYTES, maxBytes);
  const overhead = Buffer.byteLength(ACTIVE_CONSTRAINTS_OPEN) + Buffer.byteLength(ACTIVE_CONSTRAINTS_CLOSE) + 2;
  if (limit <= overhead) return "";
  let available = limit - overhead;
  const selected: string[] = [];
  let omitted = false;
  for (let index = all.length - 1; index >= 0; index -= 1) {
    const line = `- ${sanitizeConstraintText(all[index]!)}`;
    const size = Buffer.byteLength(line) + 1;
    if (selected.length >= MAX_CONSTRAINT_LINES || size > available) { omitted = true; continue; }
    selected.unshift(line);
    available -= size;
  }
  const marker = "- [additional active constraints omitted]";
  const markerSize = Buffer.byteLength(marker) + 1;
  if (omitted) {
    while (selected.length && available < markerSize) {
      const removed = selected.shift()!;
      available += Buffer.byteLength(removed) + 1;
    }
    if (available >= markerSize) selected.push(marker);
  }
  return selected.length ? `${ACTIVE_CONSTRAINTS_OPEN}\n${selected.join("\n")}\n${ACTIVE_CONSTRAINTS_CLOSE}` : "";
}
