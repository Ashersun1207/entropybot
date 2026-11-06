// Optional semantic recall over memory files. Off unless config.memoryEmbedding.enabled:
// enabling it sends memory text to the configured endpoint, so it stays an explicit choice.
import { createHash } from "node:crypto";
import type { AppConfig } from "./config.ts";
import {
  memoryBigrams,
  memoryFileDocuments,
  memorySnippet,
  memoryVectorRows,
  upsertMemoryVector,
  type MemoryHit,
} from "./message-db.ts";

import { embedTexts, memoryEmbeddingConnection, type MemoryEmbeddingSettings } from "./memory-embedding-client.ts";
export type { MemoryEmbeddingSettings } from "./memory-embedding-client.ts";
const BATCH = 10;
/** Bound the first turn's latency; anything beyond this is indexed in the background. */
const MAX_SYNC_FILES = 24;
/** Per-file cap: an oversized MEMORY.md should not send a megabyte in one request. */
const MAX_DOC_CHARS = 8_000;

export function memoryEmbeddingSettings(cfg: AppConfig): MemoryEmbeddingSettings | null {
  return cfg.memoryEmbedding?.enabled ? memoryEmbeddingConnection(cfg) : null;
}

/** The vector namespace includes the endpoint, model and dimensions; legacy model-only rows are never reused. */
export function memoryVectorIdentity(settings: MemoryEmbeddingSettings): string {
  return `embedding-v1:${createHash("sha256").update(JSON.stringify([settings.url, settings.model, settings.dimensions])).digest("hex")}`;
}

export function hashMemoryText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Reciprocal rank fusion: every list votes, so one retriever's weak tail cannot outrank another's head. */
export function mergeRanked(lists: readonly (readonly MemoryHit[])[], k = 60): MemoryHit[] {
  const scores = new Map<string, number>();
  const first = new Map<string, MemoryHit>();
  for (const list of lists) {
    list.forEach((hit, index) => {
      if (!first.has(hit.file)) first.set(hit.file, hit);
      scores.set(hit.file, (scores.get(hit.file) ?? 0) + 1 / (k + index + 1));
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([file]) => first.get(file)!)
    .filter(Boolean);
}

const indexing = new Set<string>();

/** Index stale files, bounded; the rest continues in the background so a turn is never held up by a large memory. */
export async function ensureMemoryVectors(botId: string, settings: MemoryEmbeddingSettings): Promise<void> {
  const docs = memoryFileDocuments(botId);
  if (!docs.length) return;
  const identity = memoryVectorIdentity(settings);
  const stored = new Map(memoryVectorRows(botId, identity).map((row) => [row.path, row.hash]));
  const stale = docs.filter((doc) => stored.get(doc.path) !== hashMemoryText(doc.text));
  if (!stale.length) return;
  const key = `${botId}:${identity}`;
  if (indexing.has(key)) return;
  indexing.add(key);
  const indexSome = async (files: typeof stale) => {
    for (let i = 0; i < files.length; i += BATCH) {
      const chunk = files.slice(i, i + BATCH);
      const vectors = await embedTexts(chunk.map((doc) => doc.text.slice(0, MAX_DOC_CHARS)), settings);
      const current = new Map(memoryFileDocuments(botId).map((doc) => [doc.path, hashMemoryText(doc.text)]));
      chunk.forEach((doc, index) => {
        const vector = vectors[index];
        const hash = hashMemoryText(doc.text);
        if (vector && current.get(doc.path) === hash) upsertMemoryVector(botId, doc.path, identity, hash, vector);
      });
    }
  };
  try {
    await indexSome(stale.slice(0, MAX_SYNC_FILES));
    if (stale.length > MAX_SYNC_FILES) {
      void indexSome(stale.slice(MAX_SYNC_FILES)).catch(() => {}).finally(() => indexing.delete(key));
    } else indexing.delete(key);
  } catch (error) {
    indexing.delete(key);
    throw error;
  }
}

export async function semanticMemoryHits(
  botId: string,
  query: string,
  settings: MemoryEmbeddingSettings,
  limit = 12,
): Promise<MemoryHit[]> {
  await ensureMemoryVectors(botId, settings);
  const [queryVector] = await embedTexts([query.slice(0, 500)], settings);
  if (!queryVector?.length) return [];
  const docs = memoryFileDocuments(botId);
  if (!docs.length) return [];
  const texts = new Map(docs.map((doc) => [doc.path, doc.text]));
  const grams = new Set(memoryBigrams(query));
  const scored: Array<{ hit: MemoryHit; score: number }> = [];
  for (const row of memoryVectorRows(botId, memoryVectorIdentity(settings))) {
    const text = texts.get(row.path);
    if (!text || row.dim !== queryVector.length || row.hash !== hashMemoryText(text)) continue;
    // Copy: a BLOB's bytes are not guaranteed to be 4-byte aligned for a Float32 view.
    const vector = new Float32Array(row.vector.slice().buffer);
    scored.push({
      hit: { file: row.path, at: docs.find((doc) => doc.path === row.path)?.mtimeMs ?? Date.now(), snippet: memorySnippet(text, grams) },
      score: cosine(queryVector, vector),
    });
  }
  return scored
    .filter((row) => row.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.hit);
}
