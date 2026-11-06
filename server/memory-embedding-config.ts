import { z } from "zod";
import { normalizeProviderEndpointUrl } from "../shared/image-generation.ts";

export const MEMORY_EMBEDDING_DEFAULTS = {
  url: "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
  model: "text-embedding-v4",
  dimensions: 1024,
  timeoutMs: 4_000,
};

const endpoint = z.string().transform((value, ctx) => {
  try { return normalizeProviderEndpointUrl(value); }
  catch {
    ctx.addIssue({ code: "custom", message: "Use an HTTPS embedding endpoint, or HTTP for a local provider, without credentials, query parameters or fragments" });
    return z.NEVER;
  }
});

const memoryEmbeddingSchema = z.object({
  /** Off unless enabled: memory text leaves this machine for the configured endpoint. */
  enabled: z.boolean().optional(),
  url: endpoint.optional(),
  model: z.string().trim().min(1).max(200).optional(),
  key: z.string().trim().max(4096).optional(),
  dimensions: z.number().int().min(64).max(4096).optional(),
  timeoutMs: z.number().int().min(200).max(15000).optional(),
}).strict();

export type MemoryEmbeddingConfig = z.infer<typeof memoryEmbeddingSchema>;

export type MemoryEmbeddingStorage = "secure" | "plaintext" | "environment" | "unavailable" | "none";
const storageSources = new WeakMap<MemoryEmbeddingConfig, MemoryEmbeddingStorage>();

export function memoryEmbeddingEnv(value: MemoryEmbeddingConfig = {}): MemoryEmbeddingConfig {
  const ownKey = process.env.OMB_MEMORY_EMBEDDING_KEY;
  const key = ownKey ?? value.key ?? process.env.DASHSCOPE_API_KEY;
  const result = { ...value,
    ...(key !== undefined ? { key } : {}),
    ...(process.env.OMB_MEMORY_EMBEDDING_URL !== undefined ? { url: process.env.OMB_MEMORY_EMBEDDING_URL } : {}),
    ...(process.env.OMB_MEMORY_EMBEDDING_MODEL !== undefined ? { model: process.env.OMB_MEMORY_EMBEDDING_MODEL } : {}),
  };
  const storage: MemoryEmbeddingStorage = process.env.OMB_CREDENTIAL_STORE === "unavailable" ? "unavailable"
    : value.key?.trim() ? "plaintext"
      : !key?.trim() ? "none"
        : ownKey !== undefined && process.env.OMB_MEMORY_EMBEDDING_STORAGE === "secure" ? "secure" : "environment";
  storageSources.set(result, storage);
  return result;
}

export function memoryEmbeddingStatus(cfg: MemoryEmbeddingHostConfig) {
  const value = cfg.memoryEmbedding;
  let url = "";
  try { url = normalizeProviderEndpointUrl(value?.url ?? MEMORY_EMBEDDING_DEFAULTS.url); } catch {}
  return {
    enabled: value?.enabled === true,
    configured: Boolean(value?.key?.trim()),
    storage: value ? storageSources.get(value) ?? (value.key?.trim() ? "plaintext" : "none") : "none",
    url,
    model: value?.model ?? MEMORY_EMBEDDING_DEFAULTS.model,
    dimensions: value?.dimensions ?? MEMORY_EMBEDDING_DEFAULTS.dimensions,
    timeoutMs: value?.timeoutMs ?? MEMORY_EMBEDDING_DEFAULTS.timeoutMs,
  };
}

export const memoryEmbeddingShape = { memoryEmbedding: memoryEmbeddingSchema.optional() };
export interface MemoryEmbeddingHostConfig {
  /** Enabled semantic recall sends memory text to the configured endpoint. */
  memoryEmbedding?: MemoryEmbeddingConfig;
}
