import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR } from "./config.ts";
import { closeMessageDb, memoryFileDocuments, memoryVectorRows } from "./message-db.ts";
import { ensureMemoryVectors, memoryVectorIdentity, semanticMemoryHits } from "./memory-embeddings.ts";
import type { MemoryEmbeddingSettings } from "./memory-embedding-client.ts";
import { ensureWorkspace, syncMemoryIndex, writeMemoryTopic } from "./workspace.ts";

const settings: MemoryEmbeddingSettings = { url: "http://127.0.0.1:12345/embeddings", key: "fixture-key", model: "fixture-model", dimensions: 64, timeoutMs: 500 };
const vectorResponse = (dimensions: number, count = 1) => Response.json({ data: Array.from({ length: count }, (_, index) => ({ index, embedding: Array.from({ length: dimensions }, (_, i) => i === 0 ? 1 : 0) })) });
beforeEach(() => { closeMessageDb(); rmSync(DATA_DIR, { recursive: true, force: true }); });
afterEach(() => vi.unstubAllGlobals());

describe("embedding index identity", () => {
  it("rebuilds for a changed endpoint, model or dimension without mixing namespaces", async () => {
    const bot = "fixture-index";
    ensureWorkspace(bot);
    writeMemoryTopic(bot, "coffee.md", "- 合成记忆：喜欢燕麦拿铁\n");
    syncMemoryIndex(bot);
    const fetcher = vi.fn(async (_url: string, request: RequestInit) => {
      const body = JSON.parse(String(request.body));
      return vectorResponse(body.dimensions, body.input.length);
    });
    vi.stubGlobal("fetch", fetcher);
    const variants = [settings, { ...settings, url: "http://127.0.0.1:12346/embeddings" }, { ...settings, dimensions: 128 }, { ...settings, model: "fixture-model-two" }];
    expect(new Set(variants.map(memoryVectorIdentity)).size).toBe(4);
    for (const value of variants) {
      await ensureMemoryVectors(bot, value);
      expect(memoryVectorRows(bot, memoryVectorIdentity(value))).toHaveLength(memoryFileDocuments(bot).length);
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
    await ensureMemoryVectors(bot, { ...settings, key: "fixture-rotated" });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(memoryVectorRows(bot, settings.model)).toHaveLength(0);
  });

  it("does not write a stale snapshot when the source changes during a provider request", async () => {
    const bot = "fixture-stale";
    ensureWorkspace(bot);
    writeMemoryTopic(bot, "coffee.md", "- 合成旧记忆\n");
    syncMemoryIndex(bot);
    let release!: (response: Response) => void;
    const requested = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", requested);
    const pending = ensureMemoryVectors(bot, settings);
    await vi.waitFor(() => expect(requested).toHaveBeenCalledTimes(1));
    writeMemoryTopic(bot, "coffee.md", "- 合成新记忆，替换旧记忆\n");
    syncMemoryIndex(bot);
    release(vectorResponse(64, memoryFileDocuments(bot).length));
    await pending;
    expect(memoryVectorRows(bot, memoryVectorIdentity(settings)).find((row) => row.path === "memory/coffee.md")).toBeUndefined();
    vi.stubGlobal("fetch", async (_url: string, request: RequestInit) => vectorResponse(64, JSON.parse(String(request.body)).input.length));
    const hits = await semanticMemoryHits(bot, "合成新记忆", settings);
    expect(hits[0]?.snippet).toContain("合成新记忆");
  });
});
