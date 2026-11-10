import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, type VerificationServer } from "../scripts/control-omb.ts";
import { browserProfileDirectory, browserSessionId } from "./browser-engine.ts";
import { connectCdp, type Cdp } from "./browser-sites.ts";
import { prepareNavigationStop } from "./browser-navigation-cancel.ts";

it.runIf(process.env.OMB_STOP_BROWSER_E2E === "1").each([false, true])("stops the owned tab with duplicate URLs in one profile, redirect=%s, and prevents a scheduled later action", async redirect => {
  const binary = process.env.OMB_STOP_BROWSER_BINARY!;
  const chrome = process.env.OMB_STOP_BROWSER_CHROME!;
  expect(existsSync(binary)).toBe(true);expect(existsSync(chrome)).toBe(true);
  let fixture: VerificationServer | undefined, cdp: Cdp | undefined;
  let primaryClosed = false, serverClosed = false;
  let resourceReceipt: Record<string, unknown> | undefined;
  const held: ServerResponse[] = [], reads: string[] = [];
  const closed = { fixture: false, pages: false, provider: false, directoryRemoved: false };
  const pages = createServer((req, res) => {
    reads.push(req.url!);res.setHeader("content-type", "text/html");
    if (redirect && req.url === "/slow") { res.writeHead(302, { location: "/slow-body" });res.end();return; }
    if (req.url === "/slow" || req.url === "/slow-body") {
      res.on("close", () => { primaryClosed = true; });res.flushHeaders();held.push(res);return;
    }
    res.end(`<html><body>${req.url === "/seed" ? "untouched control" : "next task page"}</body></html>`);
  });
  let pagePort = 0;
  const requests: Array<{ user: string; scheduled: string[]; receipt?: unknown; tools: string[]; lastRole: string }> = [];
  let seedStage = 0;
  let seedTabs: Array<{ targetId: string; active: boolean }> = [];
  const findTabs = (value: unknown): void => {
    if (typeof value === "string") { try { findTabs(JSON.parse(value)); } catch { /* A tool's ordinary text is not JSON. */ } }
    else if (Array.isArray(value)) {
      if (value.length === 2 && value.every(tab => typeof tab?.targetId === "string" && typeof tab?.active === "boolean")) seedTabs = value;
      else value.forEach(findTabs);
    } else if (value && typeof value === "object") Object.values(value).forEach(findTabs);
  };
  const provider = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");res.end(JSON.stringify({ data: [{ id: "fixture-tools", context_length: 131072 }] }));return;
    }
    let raw = "";for await (const chunk of req) raw += chunk;
    let body: any;
    try { body = JSON.parse(raw); } catch { res.statusCode = 400;res.end(JSON.stringify({ error: { message: "invalid fixture request" } }));return; }
    const lastUser = [...(body.messages ?? [])].reverse().find((m: { role: string }) => m.role === "user");
    const text = String(lastUser?.content ?? "");
    const latestIsTool = body.messages?.at(-1)?.role === "tool";
    const tool = (name: string) => body.tools?.find((t: { function: { name: string } }) => t.function.name.endsWith(name))?.function.name;
    const target = text.trim().endsWith("SLOW NAV") ? "slow" : text.trim().endsWith("SEED") ? "seed" : "ok";
    const seedPlan = [
      { name: "agent_browser_open", args: { url: `http://127.0.0.1:${pagePort}/seed` } },
      { name: "agent_browser_tab_new", args: { url: `http://127.0.0.1:${pagePort}/seed` } },
      { name: "agent_browser_tab_switch", args: { tab: "t1" } },
      { name: "agent_browser_tab_list", args: {} },
    ];
    if (target === "seed" && latestIsTool) findTabs(body.messages.at(-1).content);
    const step = target === "seed" ? seedPlan[seedStage++] : undefined;
    const scheduled = step ? [step.name] : target !== "seed" && tool("agent_browser_open") && !latestIsTool ? target === "slow" ? ["slow", "after-stop"] : [target] : [];
    requests.push({ user: text, scheduled, receipt: latestIsTool ? body.messages.at(-1).content : undefined, tools: (body.tools ?? []).map((t: any) => t.function.name), lastRole: body.messages?.at(-1)?.role });
    const delta = scheduled.length ? { role: "assistant", tool_calls: scheduled.map((path, index) => ({ index, id: `call_${requests.length}_${index}`, type: "function", function: { name: tool(step?.name ?? "agent_browser_open"), arguments: JSON.stringify(step?.args ?? { url: `http://127.0.0.1:${pagePort}/${path}` }) } })) }
      : { role: "assistant", content: text.includes("FOLLOWUP") ? "56" : "ready" };
    res.setHeader("content-type", "text/event-stream");
    res.end(`data: ${JSON.stringify({ id: "fixture", model: "fixture-tools", choices: [{ index: 0, delta, finish_reason: scheduled.length ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\ndata: [DONE]\n\n`);
  });
  let report: Record<string, unknown> = {}, testError: unknown, cleanupError: unknown;
  try {
    await new Promise<void>(resolve => pages.listen(0, "127.0.0.1", resolve));pagePort = (pages.address() as { port: number }).port;
    await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));const port = (provider.address() as { port: number }).port;
    fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, undefined, [], undefined, undefined, dataDir => {
      const path = join(dataDir, "config.json"), config = JSON.parse(readFileSync(path, "utf8"));
      config.instances = { synthetic: { driver: "openai-compat", config: { url: `http://127.0.0.1:${port}/v1`, apiKeyEnv: "SYNTHETIC_KEY", model: "fixture-tools", tools: true }, environment: { SYNTHETIC_KEY: "fixture-only" } } };
      config.browserEngine = { egress: { allow: [`127.0.0.1:${pagePort}`] } };
      writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
    });
    await fixture.restart(undefined, { env: { OMB_AGENT_BROWSER_PATH: binary, AGENT_BROWSER_EXECUTABLE_PATH: chrome } });
    fixture.child.on("message", message => {
      if (message && typeof message === "object" && "type" in message && message.type === "verification:stopped") resourceReceipt = message as Record<string, unknown>;
    });
    fixture.child.once("close", () => { serverClosed = true; });
    const url = fixture.info.url;
    const api = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(url + path, { method, headers: { origin: url, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
      const value = await response.json();expect(response.ok, JSON.stringify(value)).toBe(true);return value as any;
    };
    const primary = (await api("GET", "/api/bots")).bots[0];
    await api("PATCH", `/api/bots/${primary.id}`, { chiefOfStaff: false, helperModel: false, computer: "browser", modelSelection: { instanceId: "synthetic", model: "fixture-tools" }, toolScope: { allow: ["mcp:browser:*"] } });
    const originalThread = primary.threadId ?? primary.activeTaskId;
    const messages = async (id: string) => (await api("GET", `/api/threads/${id}/messages?limit=100`)).messages;
    await api("POST", `/api/bots/${primary.id}/messages`, { threadId: originalThread, text: "SEED" });
    await expect.poll(async () => (await messages(originalThread)).some((m: any) => m.kind === "text" && m.text === "ready"), { timeout: 20000 }).toBe(true);
    expect(seedTabs, JSON.stringify(requests)).toHaveLength(2);
    const original = seedTabs.find(tab => tab.active)!, control = seedTabs.find(tab => !tab.active)!;
    const profile = browserProfileDirectory(browserSessionId(primary.id, "", fixture.info.dataDir), fixture.info.dataDir);
    const [devToolsPort, devToolsPath] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").trim().split("\n");
    cdp = await connectCdp(`ws://127.0.0.1:${devToolsPort}${devToolsPath}`, 1500);
    const tabs = await cdp.send("Target.getTargets");
    expect(tabs.targetInfos).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: original.targetId, url: `http://127.0.0.1:${pagePort}/seed` }),
      expect.objectContaining({ targetId: control.targetId, url: `http://127.0.0.1:${pagePort}/seed` }),
    ]));
    const attached = await cdp.send("Target.attachToTarget", { targetId: control.targetId, flatten: true });
    const controlState = () => cdp!.send("Runtime.evaluate", { expression: "JSON.stringify({url:location.href,text:document.body.innerText})", returnByValue: true }, attached.sessionId as string);
    const before = await controlState();
    const slowThread = (await api("POST", `/api/bots/${primary.id}/tasks`, { title: "Stop navigation" })).task.threadId;
    await api("POST", `/api/bots/${primary.id}/messages`, { threadId: slowThread, text: "SLOW NAV" });
    await expect.poll(() => reads.includes(redirect ? "/slow-body" : "/slow"), { timeout: 20000 }).toBe(true);
    expect(requests.some(request => request.scheduled.join(",") === "slow,after-stop")).toBe(true);
    const rows = await messages(slowThread), turnId = [...rows].reverse().find((m: any) => m.role === "bot" && m.turnId)?.turnId;
    expect(typeof turnId).toBe("string");
    const started = Date.now();await api("POST", `/api/bots/${primary.id}/interrupt`, { threadId: slowThread, turnId });
    await expect.poll(() => primaryClosed, { timeout: 2500 }).toBe(true);
    report = { redirect, originalTarget: original.targetId, controlTarget: control.targetId, duplicateTabs: seedTabs, navigationClosedMs: Date.now() - started };
    expect(await controlState()).toEqual(before);
    const next = (await api("POST", `/api/bots/${primary.id}/tasks`, { title: "After stop" })).task.threadId;
    await api("POST", `/api/bots/${primary.id}/messages`, { threadId: next, text: "FOLLOWUP" });
    await expect.poll(async () => (await messages(next)).some((m: any) => m.role === "bot" && m.kind === "text" && m.text === "56"), { timeout: 25000 }).toBe(true);
    report = { ...report, followupMessages: await messages(next) };
    expect(reads).toContain("/ok");expect(reads.filter(path => path === "/slow")).toHaveLength(1);
    expect(reads).not.toContain("/after-stop");
    expect((await messages(slowThread)).filter((m: any) => m.role === "bot" && m.kind === "text")).toEqual([]);
    expect(await controlState()).toEqual(before);
    const finalTabs = await cdp.send("Target.getTargets");
    expect(finalTabs.targetInfos).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: original.targetId, url: `http://127.0.0.1:${pagePort}/ok` }),
      expect.objectContaining({ targetId: control.targetId, url: `http://127.0.0.1:${pagePort}/seed` }),
    ]));
    if (redirect) {
      const owned = await cdp.send("Target.attachToTarget", { targetId: original.targetId, flatten: true });
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${pagePort}/seed-moved` }, owned.sessionId as string);
      await expect.poll(async () => (await cdp!.send("Target.getTargets")).targetInfos).toEqual(expect.arrayContaining([
        expect.objectContaining({ targetId: original.targetId, url: `http://127.0.0.1:${pagePort}/seed-moved` }),
        expect.objectContaining({ targetId: control.targetId, url: `http://127.0.0.1:${pagePort}/seed` }),
      ]));
      const pinned = await prepareNavigationStop(`ws://127.0.0.1:${devToolsPort}${devToolsPath}`, original.targetId, () => true);
      expect(pinned).not.toBeNull();
      try { await expect(pinned!.stop()).resolves.toBe(true); } finally { pinned?.close(); }
      await expect.poll(async () => (await cdp!.send("Runtime.evaluate", { expression: "location.href === 'about:blank' && document.readyState === 'complete'", returnByValue: true }, owned.sessionId as string)).result).toMatchObject({ value: true });
      expect(await controlState()).toEqual(before);
    }
    const disposable = await cdp.send("Target.createTarget", { url: "about:blank", background: true });
    const vanished = await prepareNavigationStop(`ws://127.0.0.1:${devToolsPort}${devToolsPath}`, disposable.targetId as string, () => true);
    expect(vanished).not.toBeNull();
    await cdp.send("Target.closeTarget", { targetId: disposable.targetId });
    await expect.poll(async () => (await cdp!.send("Target.getTargets")).targetInfos).not.toEqual(expect.arrayContaining([expect.objectContaining({ targetId: disposable.targetId })]));
    try { await expect(vanished!.stop()).resolves.toBe(false); } finally { vanished?.close(); }
    await expect(prepareNavigationStop(`ws://127.0.0.1:${devToolsPort}${devToolsPath}`, disposable.targetId as string, () => true)).resolves.toBeNull();
    expect(await controlState()).toEqual(before);
    report = { ...report, finalTabs: finalTabs.targetInfos, oldReplyAbsent: true, laneRecovery: true, controlUnaffected: true, targetGoneRefused: true };
  } catch (error) { testError = error; }
  finally {
    cdp?.close();for (const res of held) if (!res.destroyed) res.destroy();
    try { if (fixture) { await fixture.close();closed.fixture = true;closed.directoryRemoved = !existsSync(fixture.info.dataDir); } } catch (error) { cleanupError = error; }
    pages.closeAllConnections();await new Promise<void>(resolve => pages.close(() => resolve()));closed.pages = true;
    provider.closeAllConnections();await new Promise<void>(resolve => provider.close(() => resolve()));closed.provider = true;
    if (fixture) writeFileSync(`${fixture.info.logPath}.navigation-stop.json`, JSON.stringify({ ...report, primaryClosed, reads, requests, closed, resourceReceipt, serverClosed, serverExitCode: fixture?.child.exitCode, serverSignal: fixture?.child.signalCode, testError: testError ? String(testError) : null, cleanupError: cleanupError ? String(cleanupError) : null }, null, 2));
    if (cleanupError && testError) console.error(cleanupError);
  }
  if (testError) throw testError;
  if (cleanupError) throw cleanupError;
  expect(resourceReceipt).toMatchObject({ type: "verification:stopped", status: "stopped", serverPid: fixture!.info.pid });
  expect(resourceReceipt!.registered).toBeGreaterThan(0);
  expect(resourceReceipt!.confirmed).toBe(resourceReceipt!.registered);
  expect(serverClosed).toBe(true);
  expect(fixture!.child.exitCode).toBe(0);
}, 90000);
