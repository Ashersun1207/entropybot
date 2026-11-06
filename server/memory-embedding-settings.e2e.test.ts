import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

async function requestBody(req: IncomingMessage): Promise<string> {
  let value = "";
  for await (const chunk of req) value += String(chunk);
  return value;
}

describe("isolated memory embedding settings", () => {
  it("persists safe settings, hot-reloads external credentials, gates clients and tests only synthetic text", async () => {
    const calls: Array<{ url: string | undefined; authorization: string | undefined; body: unknown }> = [];
    const provider = createServer(async (req, res) => {
      const body = JSON.parse(await requestBody(req)) as { dimensions: number };
      calls.push({ url: req.url, authorization: req.headers.authorization, body });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ index: 0, embedding: Array.from({ length: body.dimensions }, (_, i) => i === 0 ? 1 : 0) }] }));
    });
    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
    const fixture = await launchVerificationServer();
    const endpoint = `http://127.0.0.1:${(provider.address() as { port: number }).port}/embeddings`;
    const api = async (method: string, path: string, body?: unknown, headers = {}) => {
      const response = await fetch(`${fixture.info.url}${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    const persisted = () => JSON.parse(readFileSync(join(fixture.info.dataDir, "config.json"), "utf8"));
    try {
      await expect(runControlOmb(["doctor", "--url", fixture.info.url])).resolves.toMatchObject({ ok: true });
      expect((await api("GET", "/api/config")).body.memoryEmbedding).toMatchObject({ enabled: false, configured: false, storage: "none" });
      expect((await api("POST", "/api/memory/embedding/test", {})).status).toBe(409);
      expect((await api("PATCH", "/api/config", { memoryEmbedding: { key: "fixture-unsafe" } })).status).toBe(400);
      const saved = await api("PUT", "/api/config?secretStorage=external", { memoryEmbedding: { enabled: true, key: "fixture-memory-one", url: endpoint, model: "fixture-model", dimensions: 64, timeoutMs: 1000 } });
      expect(saved.status).toBe(200);
      expect(saved.body.memoryEmbedding).toMatchObject({ configured: true, url: endpoint, model: "fixture-model", dimensions: 64 });
      expect(JSON.stringify(saved.body)).not.toContain("fixture-memory-one");
      expect(persisted().memoryEmbedding.key).toBe("");
      expect((await api("PATCH", "/api/config", { memoryEmbedding: { enabled: false, timeoutMs: 800 } })).status).toBe(200);
      expect((await api("GET", "/api/config")).body.memoryEmbedding).toMatchObject({ configured: true, enabled: false, timeoutMs: 800, model: "fixture-model" });
      expect((await api("PUT", "/api/config?secretStorage=external", { memoryEmbedding: { key: "fixture-memory-two" } })).status).toBe(200);
      const pair = await api("POST", "/api/auth/pairing", { scopes: ["client"] });
      const remote = { "x-forwarded-for": "198.51.100.18", "x-forwarded-proto": "https" };
      const paired = await api("POST", "/api/auth/pair", { code: pair.body.code, label: "Memory fixture" }, remote);
      const client = { ...remote, authorization: `Bearer ${paired.body.token}` };
      expect((await api("POST", "/api/memory/embedding/test", {}, client)).status).toBe(403);
      expect((await api("PATCH", "/api/config", { memoryEmbedding: { enabled: true } }, client)).status).toBe(403);
      expect((await api("POST", "/api/memory/embedding/test", { url: "http://169.254.169.254" })).status).toBe(400);
      const tested = await api("POST", "/api/memory/embedding/test", {});
      expect(tested).toEqual({ status: 200, body: { ok: true, dimensions: 64 } });
      expect(calls).toEqual([{ url: "/embeddings", authorization: "Bearer fixture-memory-two", body: { model: "fixture-model", input: ["Entropybot synthetic embedding connection test."], dimensions: 64, encoding_format: "float" } }]);
      expect((await api("POST", "/api/memory/embedding/test", {})).status).toBe(429);
      expect(persisted().memoryEmbedding).toMatchObject({ key: "", url: endpoint, enabled: false });
      expect((await api("PATCH", "/api/config?secretStorage=external", { memoryEmbedding: { key: "" } })).status).toBe(200);
      expect((await api("GET", "/api/config")).body.memoryEmbedding).toMatchObject({ configured: false, storage: "none" });
      expect(readFileSync(join(fixture.info.dataDir, "config.json"), "utf8")).not.toContain("fixture-memory-two");
      expect(readFileSync(fixture.info.logPath, "utf8")).not.toContain("fixture-memory-two");
      console.info(JSON.stringify(fixture.info));
    } finally {
      await fixture.close();
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
    }
  }, hostTimeout(60_000));

  it("rejects foreign origins and bounds the test request body", async () => {
    const fixture = await launchVerificationServer();
    const call = async (body: string, headers = {}) => fetch(`${fixture.info.url}/api/memory/embedding/test`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body, signal: AbortSignal.timeout(10_000) });
    try {
      expect((await call("{}", { origin: "https://hostile.example" })).status).toBe(403);
      expect((await call("{}")).status).toBe(409);
      expect((await call(JSON.stringify({ padding: "x".repeat(1500) }))).status).toBe(413);
      console.info(JSON.stringify(fixture.info));
    } finally { await fixture.close(); }
  }, hostTimeout(60_000));
});
