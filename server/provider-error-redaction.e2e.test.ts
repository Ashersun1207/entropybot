import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";

it("persists safe upstream diagnostics through the isolated production server and reloads them", async () => {
  let status = 401;
  let stream = false;
  const provider = createServer(async (req, res) => {
    if (req.method !== "POST") { res.setHeader("content-type", "application/json"); res.end('{"data":[{"id":"fixture-model"}]}'); return; }
    for await (const _part of req) { /* drain synthetic request */ }
    expect(req.headers.authorization).toBe("Bearer q7!");
    const error = { message: status === 401 ? "invalid api key sk-LEAK and q7!" : "Rate limit reached for q7!; retry later", code: status === 401 ? "invalid_api_key" : "rate_limit_exceeded" };
    res.writeHead(stream ? 200 : status, { "content-type": stream ? "text/event-stream" : "application/json" });
    res.end(stream ? `data: ${JSON.stringify({ error })}\n\n` : JSON.stringify({ error }));
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("provider not bound");
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {
    fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, undefined, [], undefined, undefined, dataDir => {
      const path = join(dataDir, "config.json");
      const config = JSON.parse(readFileSync(path, "utf8"));
      config.instances = { synthetic: { driver: "openai-compat", displayName: "Synthetic", config: { url: `http://127.0.0.1:${address.port}/v1`, apiKeyEnv: "SYNTHETIC_KEY", model: "fixture-model", tools: false }, environment: { SYNTHETIC_KEY: "q7!" } } };
      writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
    });
    const url = fixture.info.url;
    const api = async (method: string, path: string, body?: unknown): Promise<any> => {
      const response = await fetch(url + path, { method, headers: { origin: url, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
      expect(response.ok).toBe(true);
      return response.json();
    };
    const threads: string[] = [];
    for (const mode of ["http-auth", "stream-auth", "rate-limit"]) {
      status = mode === "rate-limit" ? 429 : 401;
      stream = mode === "stream-auth";
      const { bot } = await api("POST", "/api/bots", { name: mode, chiefOfStaff: false, helperModel: false, computer: "off", modelSelection: { instanceId: "synthetic", model: "fixture-model" } });
      const thread = bot.threadId ?? bot.activeTaskId;
      threads.push(thread);
      await api("POST", `/api/bots/${bot.id}/messages`, { threadId: thread, text: "Synthetic error probe" });
      const rows = await vi.waitFor(async () => {
        const result = await api("GET", `/api/threads/${thread}/messages?limit=100`);
        const errors = result.messages.filter((row: any) => row.kind === "activity" && row.tool?.name?.startsWith("error:"));
        expect(errors.length).toBeGreaterThan(0);
        const state = await api("GET", "/api/bots?messages=0");
        expect(state.bots.find((item: any) => item.id === bot.id).busy).toBeFalsy();
        return errors;
      }, { timeout: 20_000, interval: 100 });
      expect(JSON.stringify(rows)).not.toContain("sk-LEAK");
      expect(JSON.stringify(rows)).not.toContain("q7!");
      expect(JSON.stringify(rows)).toContain(mode === "rate-limit" ? "retry later" : "Authentication or permission denied");
    }
    await fixture.restart();
    for (const thread of threads) {
      const rows = await api("GET", `/api/threads/${thread}/messages?limit=100`);
      expect(JSON.stringify(rows)).not.toContain("sk-LEAK");
      expect(JSON.stringify(rows)).not.toContain("q7!");
      expect(rows.messages.some((row: any) => row.tool?.name?.startsWith("error:"))).toBe(true);
    }
  } finally {
    try { await fixture?.close(); }
    finally { provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); }
  }
}, 90_000);
