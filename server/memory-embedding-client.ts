import { memoryEmbeddingStatus, type MemoryEmbeddingHostConfig } from "./memory-embedding-config.ts";

export interface MemoryEmbeddingSettings {
  url: string;
  model: string;
  key: string;
  dimensions: number;
  timeoutMs: number;
}

export function memoryEmbeddingConnection(cfg: MemoryEmbeddingHostConfig): MemoryEmbeddingSettings | null {
  const status = memoryEmbeddingStatus(cfg);
  if (!status.configured || !status.url) return null;
  return { url: status.url, model: status.model, key: cfg.memoryEmbedding!.key!.trim(), dimensions: status.dimensions, timeoutMs: status.timeoutMs };
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function responseJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("Embedding response exceeded the limit");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Embedding response was empty");
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Embedding response exceeded the limit");
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

function vectorsFrom(value: unknown, count: number, dimensions: number): Float32Array[] {
  if (!value || typeof value !== "object" || !("data" in value) || !Array.isArray(value.data) || value.data.length !== count) {
    throw new Error("Invalid embedding response");
  }
  const vectors: Float32Array[] = [];
  for (const row of value.data) {
    if (!row || !Number.isSafeInteger(row.index) || row.index < 0 || row.index >= count || vectors[row.index]
      || !Array.isArray(row.embedding) || row.embedding.length !== dimensions
      || !row.embedding.every((number: unknown) => typeof number === "number" && Number.isFinite(number))) {
      throw new Error("Invalid embedding response");
    }
    const vector = Float32Array.from(row.embedding);
    if (!vector.every(Number.isFinite) || !vector.some((number) => number !== 0)) throw new Error("Invalid embedding vector");
    vectors[row.index] = vector;
  }
  return vectors;
}

export async function embedTexts(texts: readonly string[], settings: MemoryEmbeddingSettings): Promise<Float32Array[]> {
  // Endpoint validation applies again at the credential boundary; redirects must never forward this bearer.
  const checked = memoryEmbeddingConnection({ memoryEmbedding: { ...settings, enabled: true } });
  if (!checked) throw new Error("Embedding connection is not configured");
  try {
    const response = await fetch(checked.url, {
      method: "POST",
      headers: { authorization: `Bearer ${checked.key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: checked.model, input: texts, dimensions: checked.dimensions, encoding_format: "float" }),
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(checked.timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Embedding provider refused the request");
    }
    return vectorsFrom(await responseJson(response), texts.length, checked.dimensions);
  } catch {
    throw new Error("Could not verify the embedding response. Check the saved endpoint, model and credential.");
  }
}

export async function testMemoryEmbeddingConnection(cfg: MemoryEmbeddingHostConfig): Promise<number> {
  const settings = memoryEmbeddingConnection(cfg);
  if (!settings) throw new Error("Configure the embedding connection first.");
  const [vector] = await embedTexts(["Entropybot synthetic embedding connection test."], settings);
  return vector!.length;
}
