import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";
import type { ToolScope } from "../shared/tool-scope.ts";

interface Bot { id: string; threadId: string; name: string; computer?: string; toolScope?: ToolScope }
interface ChatRequest { model: string; tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content: unknown }> }

it.runIf(process.env.OMB_CREATE_SCOPE_BROWSER_BINARY && process.env.OMB_CREATE_SCOPE_BROWSER_CHROME)("enforces the nested creation contract on the first provider request and after same-data restart", async () => {
  const binaryPath = process.env.OMB_CREATE_SCOPE_BROWSER_BINARY!;
  const executablePath = process.env.OMB_CREATE_SCOPE_BROWSER_CHROME!;
  expect(existsSync(binaryPath)).toBe(true);
  expect(existsSync(executablePath)).toBe(true);
  const requests: ChatRequest[] = [], exchanges: unknown[] = [], snapshots: unknown[] = [], receipts: unknown[] = [];
  const closed = { fixture: false, provider: false, directoryRemoved: false, childClose: false };
  let fixture: VerificationServer | undefined;
  const provider = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "fixture-tools", context_length: 131072 }] }));return;
    }
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") { res.writeHead(404);res.end("{}");return; }
    let raw = "";for await (const part of req) raw += part;
    const body = JSON.parse(raw) as ChatRequest;
    requests.push(body);
    res.setHeader("content-type", "text/event-stream");
    res.end(`data: ${JSON.stringify({ id: "fixture", model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "scope fixture complete" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\ndata: [DONE]\n\n`);
  });
  try {
    await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
    const port = (provider.address() as { port: number }).port;
    fixture = await launchVerificationServer({}, undefined, undefined, { binaryPath, executablePath }, undefined, undefined, [], undefined, undefined, dataDir => {
      const path = join(dataDir, "config.json"), config = JSON.parse(readFileSync(path, "utf8"));
      config.instances = { synthetic: { driver: "openai-compat", config: { url: `http://127.0.0.1:${port}/v1`, apiKeyEnv: "SYNTHETIC_KEY", model: "fixture-tools", tools: true }, environment: { SYNTHETIC_KEY: "fixture-only" } } };
      writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
    });
    const attach = () => {
      fixture!.child.on("message", message => {
        if (message && typeof message === "object" && "type" in message && message.type === "verification:stopped") receipts.push(message);
      });
      fixture!.child.once("close", () => { closed.childClose = true; });
    };
    attach();
    const api = async (method: string, path: string, body?: unknown, status = 200, headers: Record<string, string> = {}) => {
      const response = await fetch(fixture!.info.url + path, { method, headers: { origin: fixture!.info.url, "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
      const value = await response.json() as any;
      exchanges.push({ method, path, body, status: response.status, response: path.startsWith("/api/auth/") ? "synthetic pairing response omitted" : value });
      expect(response.status, JSON.stringify(value)).toBe(status);return value;
    };
    const list = async (): Promise<Bot[]> => (await api("GET", "/api/bots?messages=0")).bots;
    const rawBots = () => readFileSync(join(fixture!.info.dataDir, "bots.json"), "utf8");
    const settings = { computer: "browser", chiefOfStaff: false, helperModel: false };
    const create = async (name: string, scope?: ToolScope) => (await api("POST", "/api/bots", { name, useDefaults: false, modelSelection: { instanceId: "synthetic", model: "fixture-tools" }, settings: { ...settings, ...(scope ? { toolScope: scope } : {}) } }, 201)).bot as Bot;
    const send = async (bot: Bot, browser: boolean) => {
      const before = requests.length;
      await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: `Synthetic scope qualification ${bot.name}` }, 202);
      await expect.poll(async () => (await api("GET", `/api/threads/${bot.threadId}/messages?limit=100`)).messages.some((m: { kind: string; text?: string }) => m.kind === "text" && m.text === "scope fixture complete"), { timeout: 20_000 }).toBe(true);
      const actual = requests.slice(before);
      expect(actual).toHaveLength(1);
      const names = (actual[0].tools ?? []).map(tool => tool.function.name);
      expect(names.some(name => name.endsWith("agent_browser_open")), JSON.stringify(names)).toBe(browser);
      if (!browser) expect(names.filter(name => name.includes("agent_browser_"))).toEqual([]);
      snapshots.push({ name: bot.name, tools: names, saved: (await list()).find(row => row.id === bot.id), rawBots: JSON.parse(rawBots()) });
    };
    const allow = await create("Healthy allow control");
    await send(allow, true);
    const denyScope = { deny: ["mcp:browser:*"] };
    const deny = await create("Deny from birth", denyScope);
    expect(deny.toolScope).toEqual(denyScope);
    expect(deny.computer).toBe("browser");
    await send(deny, false);
    const restartFirst = await create("First turn after restart", denyScope);
    expect(restartFirst.toolScope).toEqual(denyScope);
    expect(JSON.parse(rawBots()).find((row: Bot) => row.id === restartFirst.id).toolScope).toEqual(denyScope);
    const beforeInvalid = rawBots(), ids = (await list()).map(bot => bot.id);
    for (const toolScope of [false, [], { allow: "all" }, { deny: ["mcp:*:read"] }, { unknown: true }]) {
      await api("POST", "/api/bots", { name: "Invalid scope", settings: { computer: "browser", toolScope } }, 400);
      expect(rawBots()).toBe(beforeInvalid);
      expect((await list()).map(bot => bot.id)).toEqual(ids);
    }
    const top = (await api("POST", "/api/bots", { name: "Unsupported top-level scope", useDefaults: false, modelSelection: { instanceId: "synthetic", model: "fixture-tools" }, toolScope: denyScope, computer: "off", settings }, 201)).bot as Bot;
    expect(top).not.toHaveProperty("toolScope");
    expect(top.computer).toBe("browser");
    await send(top, true);
    await api("PATCH", "/api/config", { newBotDefaults: { profile: { toolScope: denyScope } } });
    const inherited = (await api("POST", "/api/bots", { name: "Inherited scope", toolScope: { allow: [] } }, 201)).bot;
    expect(inherited.toolScope).toEqual(denyScope);
    const explicit = (await api("POST", "/api/bots", { name: "Nested wins", settings: { toolScope: { allow: [] } }, toolScope: null }, 201)).bot;
    expect(explicit.toolScope).toEqual({ allow: [] });
    expect((await api("POST", "/api/bots", { name: "Opt out", useDefaults: false }, 201)).bot).not.toHaveProperty("toolScope");
    expect((await api("POST", "/api/bots", { name: "Explicit reset", settings: { toolScope: null } }, 201)).bot).not.toHaveProperty("toolScope");
    await api("PATCH", `/api/bots/${explicit.id}`, { toolScope: denyScope });
    expect((await list()).find(bot => bot.id === explicit.id)?.toolScope).toEqual(denyScope);
    await api("PATCH", "/api/config", { newBotDefaults: { profile: {} } });
    const pairing = await api("POST", "/api/auth/pairing", { scopes: ["client"] });
    const session = await api("POST", "/api/auth/pair", { code: pairing.code, label: "Synthetic scope client" });
    const authHeaders: Record<string, string>[] = [{ authorization: `Bearer ${session.token}` }, { "x-entropybot-companion": "1" }];
    for (const headers of authHeaders) {
      for (const body of [{ settings: { toolScope: { allow: [] } } }, { settings: { toolScope: null } }, { settings: { computer: "browser" } }, { settings: { toolScope: denyScope }, toolScope: null }]) {
        const before = rawBots();
        await api("POST", "/api/bots", { name: "Forbidden permissions", ...body }, 403, headers);
        expect(rawBots()).toBe(before);
      }
    }
    await api("POST", "/api/bots", { name: "Companion top-level", toolScope: denyScope }, 403, { "x-entropybot-companion": "1" });
    const beforeClientTop = rawBots();
    await api("POST", "/api/bots", { name: "Client unsupported top-level", toolScope: denyScope, computer: "browser" }, 403, { authorization: `Bearer ${session.token}` });
    expect(rawBots()).toBe(beforeClientTop);
    await fixture.restart();
    closed.childClose = false;attach();
    for (const bot of [deny, restartFirst]) expect((await list()).find(row => row.id === bot.id)?.toolScope).toEqual(denyScope);
    await send(restartFirst, false);
    const restartedAllow = await create("Healthy allow after restart");
    await send(restartedAllow, true);
  } finally {
    try {
      if (fixture) { await fixture.close();closed.fixture = true;closed.directoryRemoved = !existsSync(fixture.info.dataDir); }
    } finally {
      provider.closeAllConnections();
      await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));closed.provider = true;
      if (process.env.OMB_CREATE_SCOPE_EVIDENCE) writeFileSync(process.env.OMB_CREATE_SCOPE_EVIDENCE, JSON.stringify({ fixture: fixture?.info, exchanges, requests, snapshots, receipts, closed }, null, 2));
    }
  }
  expect(closed).toEqual({ fixture: true, provider: true, directoryRemoved: true, childClose: true });
  expect(receipts).toHaveLength(2);
  for (const receipt of receipts) {
    expect(receipt).toMatchObject({ type: "verification:stopped", status: "stopped" });
    const resources = receipt as { registered: number; confirmed: number };
    expect(resources.registered).toBeGreaterThan(0);
    expect(resources.confirmed).toBe(resources.registered);
  }
}, 120_000);
