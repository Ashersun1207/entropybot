import type { MemoryEmbeddingHostConfig } from "../memory-embedding-config.ts";
import { testMemoryEmbeddingConnection } from "../memory-embedding-client.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createMemoryEmbeddingRoutes(config: () => MemoryEmbeddingHostConfig): RouteHandler {
  let busy = false;
  let nextTestAt = 0;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method !== "POST" || path !== "/api/memory/embedding/test") return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only the workspace owner or an administrator can test this connection." });
    const body: unknown = await readBody(req, 1024);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) {
      return json(res, 400, { error: "Send an empty object to test the saved embedding connection." });
    }
    if (busy || Date.now() < nextTestAt) return json(res, 429, { error: "Wait before testing the embedding connection again." });
    const cfg = config();
    if (!cfg.memoryEmbedding?.key?.trim()) return json(res, 409, { error: "Configure the embedding connection first." });
    busy = true;
    nextTestAt = Date.now() + 2_000;
    try {
      const dimensions = await testMemoryEmbeddingConnection(cfg);
      return json(res, 200, { ok: true, dimensions });
    } catch {
      return json(res, 502, { error: "Could not verify the embedding connection. Check the saved endpoint, model and credential." });
    } finally { busy = false; }
  };
}
