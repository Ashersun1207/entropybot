import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { embedTexts, testMemoryEmbeddingConnection, type MemoryEmbeddingSettings } from "./memory-embedding-client.ts";

const settings: MemoryEmbeddingSettings = { url: "https://embedding.example/v1/embeddings", key: "fixture-private-key", model: "fixture-model", dimensions: 64, timeoutMs: 200 };
const vector = () => Array.from({ length: 64 }, (_, index) => index === 0 ? 1 : 0);
afterEach(() => vi.unstubAllGlobals());

describe("embedding provider contract", () => {
  it("sends only the fixed synthetic text, including while semantic recall is disabled", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [{ index: 0, embedding: vector() }] }));
    vi.stubGlobal("fetch", fetcher);
    expect(await testMemoryEmbeddingConnection({ memoryEmbedding: { ...settings, enabled: false } })).toBe(64);
    const [url, request] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(settings.url);
    expect(request.redirect).toBe("error");
    expect(request.headers).toMatchObject({ authorization: "Bearer fixture-private-key" });
    expect(JSON.parse(String(request.body))).toEqual({ model: "fixture-model", input: ["Entropybot synthetic embedding connection test."], dimensions: 64, encoding_format: "float" });
  });

  it.each([
    {}, { data: [] }, { data: [{ embedding: vector() }] },
    { data: [{ index: 1, embedding: vector() }] },
    { data: [{ index: 0, embedding: [1, 2] }] },
    { data: [{ index: 0, embedding: Array(64).fill(0) }] },
    { data: [{ index: 0, embedding: Array(64).fill("1") }] },
    { data: [{ index: 0, embedding: Array(64).fill(1e100) }] },
    { data: [{ index: 0, embedding: Array(64).fill(1e-100) }] },
    { data: [{ index: 0, embedding: Array(64).fill(null) }] },
  ])("rejects malformed, mismatched or invalid vectors: %j", async (body) => {
    vi.stubGlobal("fetch", async () => Response.json(body));
    await expect(embedTexts(["synthetic"], settings)).rejects.toThrow("Could not verify");
  });

  it("rejects duplicate response indices instead of silently assigning another input's vector", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ data: [{ index: 0, embedding: vector() }, { index: 0, embedding: vector() }] }));
    await expect(embedTexts(["one", "two"], settings)).rejects.toThrow("Could not verify");
  });

  it("restores out-of-order batch vectors by their exact indices", async () => {
    const two = Array(64).fill(2);
    vi.stubGlobal("fetch", async () => Response.json({ data: [{ index: 1, embedding: two }, { index: 0, embedding: vector() }] }));
    const result = await embedTexts(["one", "two"], settings);
    expect(result[0]![0]).toBe(1);
    expect(result[1]![0]).toBe(2);
  });

  it("never exposes upstream error text or exception details", async () => {
    for (const fetcher of [async () => new Response("fixture-private-key upstream body", { status: 401 }), async () => { throw new Error("fixture-private-key request details"); }, async () => new Response("fixture-private-key invalid JSON")]) {
      vi.stubGlobal("fetch", fetcher);
      const error = await embedTexts(["synthetic"], settings).catch((error: unknown) => String(error));
      expect(error).not.toContain("fixture-private-key");
      expect(error).not.toContain("upstream body");
    }
  });

  it("rejects an oversized streamed body even without content-length", async () => {
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); controller.close(); } })));
    await expect(embedTexts(["synthetic"], settings)).rejects.toThrow("Could not verify");
  });

  it("refuses unsafe endpoints before issuing a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(embedTexts(["synthetic"], { ...settings, url: "https://fixture-user:fixture-private-key@embedding.example" })).rejects.toThrow("not configured");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses redirects and times out an actual isolated loopback provider", async () => {
    let destinationCalls = 0;
    const server = createServer((req, res) => {
      if (req.url === "/redirect") { res.writeHead(302, { location: "/destination" }); res.end(); }
      else if (req.url === "/destination") { destinationCalls++; res.end("not reached"); }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}`;
    try {
      await expect(embedTexts(["synthetic"], { ...settings, url: `${url}/redirect` })).rejects.toThrow("Could not verify");
      expect(destinationCalls).toBe(0);
      await expect(embedTexts(["synthetic"], { ...settings, url: `${url}/timeout` })).rejects.toThrow("Could not verify");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
