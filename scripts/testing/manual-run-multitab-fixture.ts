import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request, type ServerResponse } from "node:http";
import { join } from "node:path";
import { expect } from "vitest";
import { launchVerificationServer } from "../control-omb.ts";
import { CdpConnection, CdpSession } from "../../server/browser/cdp/connection.ts";
import { webSocketTransport } from "../../server/browser/cdp/transport.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { fixtureApi, mountPreview } from "./preview-fixture.ts";

export const ledgerKey = "entropybot.manual-routine-intents.v1";
export async function multitabFixture(name: string, mode = "happy") {
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: mode });
  const api = fixtureApi(fixture.info.url);
  const report: Record<string, unknown> = { name, fixture: fixture.info };
  const posts: { key: string; context: string; runId: string; routineId: string; status: number }[] = [];
  const barriers = new Map<string, ServerResponse>();
  let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
  let chrome: ChildProcess | undefined, connection: CdpConnection | undefined;
  let proxy: ReturnType<typeof createServer> | undefined;
  let holdFirst = false, releaseFirst = false;
  const close = async () => {
    connection?.close();
    let browserClosed = false;
    try { await waitForExit(chrome, { signal: "SIGTERM" }); browserClosed = true; }
    finally {
      releaseFirst = true; for (const response of barriers.values()) if (!response.writableEnded) response.end("closing");
      if (proxy) await new Promise<void>((resolve) => proxy!.close(() => resolve()));
      await preview?.close();
      if (process.env.OMB_MULTITAB_EVIDENCE_DIR) copyFileSync(fixture.info.logPath, join(process.env.OMB_MULTITAB_EVIDENCE_DIR, `${name}.server.log`));
      if (browserClosed) await fixture.close(); else await waitForExit(fixture.child, { signal: "SIGTERM" });
      report.posts = posts; report.cleanup = { browserClosed, directoryRemoved: !existsSync(fixture.info.dataDir) };
      if (process.env.OMB_MULTITAB_EVIDENCE_DIR) writeFileSync(join(process.env.OMB_MULTITAB_EVIDENCE_DIR, `${name}.json`), JSON.stringify(report, null, 2));
    }
  };
  try {
    const { bots } = await api("GET", "/api/bots");
    await api("PATCH", `/api/bots/${bots[0].id}`, { chiefOfStaff: false });
    await api("PATCH", "/api/config", { language: "en" });
    const routines: { id: string }[] = [];
    for (let i = 0; i < 2; i++) routines.push((await api("POST", "/api/routines", {
      name: `Synthetic multitab ${i}`, prompt: "Return synthetic fixture text.", botId: bots[0].id, enabled: false,
      schedule: { type: "cron", expression: "0 0 1 1 *", timeZone: "UTC" },
    })).routine);
    preview = await mountPreview(fixture, { entry: "/scripts/testing/routine-run-reload-preview.tsx", route: "/__multitab.html", title: "Synthetic multitab", logLevel: "error", extraRoutes: [
      { path: "/api/auth/session", handler: async (_req, res) => {
        const response = await fetch(fixture.info.url + "/api/auth/session");
        res.setHeader("content-type", "application/json"); res.end(await response.text());
      } },
      { path: "/__barrier", handler: (req, res) => {
        const tab = new URL(req.url!, "http://fixture").searchParams.get("tab")!;
        barriers.set(tab, res);
        const timer = setTimeout(() => { if (!res.writableEnded) { res.statusCode = 504; res.end("bounded barrier expired"); } }, 8_000);
        res.on("close", () => clearTimeout(timer));
        if (barriers.size === 2) barriers.get("A")!.end("release A");
      } },
      { path: /^\/api\/routines\/[^/]+\/run-protected$/, method: "POST", handler: async (req, res) => {
        const response = await fetch(fixture.info.url + req.url, { method: "POST", signal: AbortSignal.timeout(15_000), headers: {
          origin: fixture.info.url, "Idempotency-Key": String(req.headers["idempotency-key"]), "X-Entropybot-Manual-Context": String(req.headers["x-entropybot-manual-context"]),
        } });
        const text = await response.text(); const body = JSON.parse(text);
        const ordinal = posts.length;
        posts.push({ key: String(req.headers["idempotency-key"]), context: String(req.headers["x-entropybot-manual-context"]), runId: body.run?.id, routineId: body.run?.routineId, status: response.status });
        if (barriers.size === 2 && !barriers.get("B")!.writableEnded) barriers.get("B")!.end("release B after actual admission");
        if (holdFirst && ordinal === 0) await expect.poll(() => releaseFirst, { timeout: 20_000 }).toBe(true);
        res.statusCode = response.status; res.setHeader("content-type", "application/json"); res.end(text);
      } },
      { path: /^\/api\/routines\/[^/]+\/run$/, method: "POST", handler: (_req, res) => { report.legacyPosts = Number(report.legacyPosts ?? 0) + 1; res.statusCode = 500; res.end("legacy refused"); } },
    ] });
    const profile = join(fixture.info.dataDir, "multitab-chrome"); mkdirSync(profile);
    chrome = spawn(process.env.OMB_RELOAD_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
      "--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
      "--password-store=basic", "--use-mock-keychain", "--no-proxy-server", "--host-resolver-rules=MAP multitab.fixture.invalid 127.0.0.1",
      "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
    ], { env: { PATH: process.env.PATH, HOME: fixture.info.dataDir, USERPROFILE: fixture.info.dataDir }, stdio: "ignore" });
    await expect.poll(() => existsSync(join(profile, "DevToolsActivePort")), { timeout: 20_000 }).toBe(true);
    const [port, endpoint] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").trim().split("\n");
    connection = new CdpConnection(await webSocketTransport(`ws://127.0.0.1:${port}${endpoint}`));
    report.browser = await connection.root.send("Browser.getVersion");
    const open = async (routineId = routines[0].id, insecure = false) => {
      let base = preview!.previewUrl;
      if (insecure) {
        const destination = new URL(base);
        proxy = createServer((req, res) => {
          const forwarded = request({ hostname: destination.hostname, port: destination.port, path: req.url, method: req.method, headers: { ...req.headers, host: destination.host, origin: destination.origin } }, (response) => {
            res.writeHead(response.statusCode!, response.headers); response.pipe(res);
          });
          forwarded.on("error", () => { res.statusCode = 502; res.end(); }); req.pipe(forwarded);
        });
        await new Promise<void>((resolve) => proxy!.listen(0, "127.0.0.1", resolve));
        base = `http://multitab.fixture.invalid:${(proxy.address() as { port: number }).port}/__multitab.html`;
      }
      const url = `${base}?routine=${routineId}`;
      const { targetId } = await connection!.root.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await connection!.root.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
      const page = new CdpSession(connection!, sessionId, "page");
      const evaluate = async (expression: string): Promise<any> => {
        const result = await page.send<{ result: { value: unknown }; exceptionDetails?: unknown }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, { pageWorld: true });
        if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
      };
      const has = (text: string) => evaluate(`!![...document.querySelectorAll('aside[aria-label="Routine details"] button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`);
      const click = (text: string) => evaluate(`(()=>{const b=[...document.querySelectorAll('aside[aria-label="Routine details"] button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing enabled '+${JSON.stringify(text)});b.click();return true})()`);
      const ready = async () => {
        await expect.poll(() => evaluate(`location.href===${JSON.stringify(url)}&&document.readyState==='complete'`), { timeout: 30_000 }).toBe(true);
        await expect.poll(async () => await has("Run now") || await has("Retry"), { timeout: 30_000 }).toBe(true);
      };
      await page.send("Page.enable"); await page.send("Page.navigate", { url }); await ready();
      return { page, evaluate, has, click, ready, reload: async () => { await evaluate("window.oldDocument=true;true"); await page.send("Page.reload"); await expect.poll(() => evaluate("window.oldDocument===undefined")).toBe(true); await ready(); }, close: () => connection!.root.send("Target.closeTarget", { targetId }) };
    };
    return { api, routines, posts, report, open, close, hold: () => { holdFirst = true; }, release: () => { releaseFirst = true; }, runs: async () => (await api("GET", "/api/routines")).runs as { id: string; routineId: string; status: string }[] };
  } catch (error) { await close(); throw error; }
}

export async function armLedgerRace(page: { evaluate(expression: string): Promise<unknown> }, tab: string) {
  await page.evaluate(`(()=>{window.syntheticLedgerTransaction=false;const original=navigator.locks.request.bind(navigator.locks);navigator.locks.request=(name,options,callback)=>original(name,options,lock=>{window.syntheticLedgerTransaction=true;try{return callback(lock)}finally{window.syntheticLedgerTransaction=false}});const get=Storage.prototype.getItem;let reads=0;Storage.prototype.getItem=function(key){const value=get.call(this,key);if(key==='${ledgerKey}'&&++reads===3&&!window.syntheticLedgerTransaction){const xhr=new XMLHttpRequest();xhr.open('GET','/__barrier?tab=${tab}',false);xhr.send();if(xhr.status!==200)throw Error('barrier expired')}return value};return true})()`);
}
