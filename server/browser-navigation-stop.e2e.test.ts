import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";

it.runIf(process.env.OMB_STOP_BROWSER_E2E === "1")("stops only the interrupted browser navigation and keeps another profile and the next task usable", async () => {
  const binary = process.env.OMB_STOP_BROWSER_BINARY!;
  const chrome = process.env.OMB_STOP_BROWSER_CHROME!;
  expect(existsSync(binary)).toBe(true);
  expect(existsSync(chrome)).toBe(true);
  let fixture: VerificationServer | undefined;
  let primaryClosed = false, controlClosed = false;
  const held: ServerResponse[] = [];
  const reads: string[] = [];
  const closed = { fixture: false, pages: false, provider: false, directoryRemoved: false };
  const pages = createServer((req, res) => {
    reads.push(req.url!);
    res.setHeader("content-type", "text/html");
    if (req.url === "/slow" || req.url === "/control") {
      const primary = req.url === "/slow";
      res.on("close", () => { if (primary) primaryClosed = true; else controlClosed = true; });
      res.flushHeaders();held.push(res);return;
    }
    res.end("<html><body>new task page</body></html>");
  });
  let pagePort = 0;
  const requests: Array<{ user: string; tool?: string }> = [];
  const provider = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "fixture-tools", context_length: 131072 }] }));return;
    }
    let raw = "";for await (const chunk of req) raw += chunk;
    let body: any;
    try { body = JSON.parse(raw); } catch { res.statusCode = 400;res.end(JSON.stringify({ error: { message: "empty or non-JSON body" } }));return; }
    if (!body || typeof body !== "object") { res.statusCode = 400;res.end(JSON.stringify({ error: { message: "invalid body" } }));return; }
    const lastUser = [...(body.messages ?? [])].reverse().find((m: { role: string }) => m.role === "user");
    const text = String(lastUser?.content ?? "");
    const latestIsTool = body.messages?.at(-1)?.role === "tool";
    const tool = body.tools?.find((t: { function: { name: string } }) => t.function.name.endsWith("agent_browser_open"))?.function.name;
    requests.push({ user: text, tool });
    const target = text.includes("CONTROL NAV") ? "control" : text.includes("SLOW NAV") ? "slow" : "ok";
    const choose = Boolean(tool && !latestIsTool);
    res.setHeader("content-type", "text/event-stream");
    const delta = choose ? { role: "assistant", tool_calls: [{ index: 0, id: `call_${requests.length}`, type: "function", function: { name: tool, arguments: JSON.stringify({ url: `http://127.0.0.1:${pagePort}/${target}` }) } }] }
      : { role: "assistant", content: text.includes("FOLLOWUP") ? "56" : "finished" };
    res.end(`data: ${JSON.stringify({ id: "fixture", model: "fixture-tools", choices: [{ index: 0, delta, finish_reason: choose ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\ndata: [DONE]\n\n`);
  });
  let report: Record<string, unknown> = {};
  let testError: unknown;
  let followupDiagnostics: Record<string, unknown> = {};
  try {
    await new Promise<void>(resolve => pages.listen(0, "127.0.0.1", resolve));
    pagePort = (pages.address() as { port: number }).port;
    await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
    const port = (provider.address() as { port: number }).port;
    fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, undefined, [], undefined, undefined, dataDir => {
      const path = join(dataDir, "config.json");const config = JSON.parse(readFileSync(path, "utf8"));
      config.instances = { synthetic: { driver: "openai-compat", config: { url: `http://127.0.0.1:${port}/v1`, apiKeyEnv: "SYNTHETIC_KEY", model: "fixture-tools", tools: true }, environment: { SYNTHETIC_KEY: "fixture-only" } } };
      config.browserEngine = { egress: { allow: [`127.0.0.1:${pagePort}`] } };
      writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
    });
    await fixture.restart(undefined, { env: { OMB_AGENT_BROWSER_PATH: binary, AGENT_BROWSER_EXECUTABLE_PATH: chrome } });
    const url = fixture.info.url;
    const api = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(url + path, { method, headers: { origin: url, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
      const value = await response.json();expect(response.ok, JSON.stringify(value)).toBe(true);return value as any;
    };
    const primary = (await api("GET", "/api/bots")).bots[0];
    await api("PATCH", `/api/bots/${primary.id}`, { chiefOfStaff: false, helperModel: false, computer: "browser", modelSelection: { instanceId: "synthetic", model: "fixture-tools" }, toolScope: { allow: ["mcp:browser:*"] } });
    const control = (await api("POST", "/api/bots", { name: "Synthetic control", settings: { helperModel: false }, computer: "browser", modelSelection: { instanceId: "synthetic", model: "fixture-tools" }, toolScope: { allow: ["mcp:browser:*"] } })).bot;
    await api("PATCH", `/api/bots/${control.id}`, { chiefOfStaff: false, helperModel: false, computer: "browser", modelSelection: { instanceId: "synthetic", model: "fixture-tools" }, toolScope: { allow: ["mcp:browser:*"] } });
    const thread = (bot: any) => bot.threadId ?? bot.activeTaskId;
    await api("POST", `/api/bots/${control.id}/messages`, { threadId: thread(control), text: "CONTROL NAV" });
    await expect.poll(() => reads.includes("/control"), { timeout: 20000 }).toBe(true);
    await api("POST", `/api/bots/${primary.id}/messages`, { threadId: thread(primary), text: "SLOW NAV" });
    await expect.poll(() => reads.includes("/slow"), { timeout: 20000 }).toBe(true);
    const messages = async (id: string) => (await api("GET", `/api/threads/${id}/messages?limit=100`)).messages;
    const rows = await messages(thread(primary));
    const turnId = [...rows].reverse().find((m: any) => m.role === "bot" && m.turnId)?.turnId;
    const started = Date.now();
    await api("POST", `/api/bots/${primary.id}/interrupt`, { threadId: thread(primary), turnId });
    await expect.poll(() => primaryClosed, { timeout: 2500 }).toBe(true);
    report = { navigationClosedMs: Date.now() - started };
    expect(controlClosed).toBe(false);
    const next = (await api("POST", `/api/bots/${primary.id}/tasks`, { title: "After stop" })).task.threadId;
    const sendResp = await api("POST", `/api/bots/${primary.id}/messages`, { threadId: next, text: "FOLLOWUP" });
    // Lane recovery after an interrupted in-flight open is still open: record the next turn's bounded outcome as evidence,
    // but do not assert it succeeds. The delivered scope is that the interrupted navigation itself stops.
    let followupSettled = false;
    try {
      await expect.poll(async () => (await messages(next)).some((m: any) => m.role === "bot" && m.kind === "text" && m.text === "56"), { timeout: 25000 }).toBe(true);
      followupSettled = true;
    } catch { followupSettled = false; }
    followupDiagnostics = { sendResp, followupSettled, laneRecovery: followupSettled ? "recovered" : "open: next browser turn did not complete", followupMessages: await messages(next) };
    expect(followupSettled, JSON.stringify(followupDiagnostics.followupMessages)).toBe(true);
    expect(reads).not.toContain("/after-stop");
    expect((await messages(thread(primary))).filter((m: any) => m.role === "bot" && m.kind === "text")).toEqual([]);
    report = { ...report, oldReplyAbsent: true, laneRecovery: followupSettled ? "recovered" : "open", controlUnaffected: true, reads, requests };
  } catch (error) { testError = error; throw error; }
  finally {
    for (const res of held) if (!res.destroyed) res.destroy();
    let cleanupError: unknown;
    try { if (fixture) { await fixture.close();closed.fixture = true;closed.directoryRemoved = !existsSync(fixture.info.dataDir); } }
    catch (error) { cleanupError = error; }
    pages.closeAllConnections();await new Promise<void>(resolve => pages.close(() => resolve()));closed.pages = true;
    provider.closeAllConnections();await new Promise<void>(resolve => provider.close(() => resolve()));closed.provider = true;
    if (fixture) writeFileSync(`${fixture.info.logPath}.navigation-stop.json`, JSON.stringify({ ...report, primaryClosed, controlClosed, reads, requests, closed, followupDiagnostics, cleanupError: cleanupError ? String(cleanupError) : null }, null, 2));
    if (cleanupError) { if (testError) console.error(cleanupError); else throw cleanupError; }
  }
}, 90000);
