import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, verificationServerArgs, verificationServerEnvironment, type VerificationServer } from "../control-omb.ts";
import { CdpConnection, CdpSession } from "../../server/browser/cdp/connection.ts";
import { webSocketTransport } from "../../server/browser/cdp/transport.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { fixtureApi, mountPreview, type MountedPreview } from "./preview-fixture.ts";

const enabled = process.env.OMB_UI_E2E === "1";
const chromePath = process.env.OMB_RELOAD_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const storageKey = "entropybot.manual-routine-intents.v1";

it.runIf(enabled).each(["lost", "readback", "in-flight"] as const)("recovers %s through actual browser reload, server restart and routine details Retry", async (fault) => {
  expect(existsSync(chromePath), "Use an existing Chrome; this fixture never installs a browser").toBe(true);
  let fixture: VerificationServer | undefined, preview: MountedPreview | undefined;
  let chrome: ChildProcess | undefined, restarted: ChildProcess | undefined, connection: CdpConnection | undefined;
  const posts: { key: string; context: string; runId: string }[] = [];
  let legacyPosts = 0, passed = false;
  const closed = { browser: false, restarted: false, fixture: false, directoryRemoved: false };
  try {
    fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "happy" });
    const { url, dataDir, logPath } = fixture.info;
    console.log(JSON.stringify({ fault, url, dataDir, logPath }));
    const api = fixtureApi(url);
    const { bots } = await api("GET", "/api/bots");
    await api("PATCH", `/api/bots/${bots[0].id}`, { chiefOfStaff: false });
    await api("PATCH", "/api/config", { language: "en" });
    const { routine } = await api("POST", "/api/routines", { name: "Synthetic reload", prompt: "Return synthetic fixture text.", botId: bots[0].id,
      enabled: false, schedule: { type: "cron", expression: "0 0 1 1 *", timeZone: "UTC" } });
    let switchedToken: string | undefined;
    preview = await mountPreview(fixture, {
      entry: "/scripts/testing/routine-run-reload-preview.tsx", route: "/__reload.html", title: "Synthetic manual recovery", logLevel: "error",
      extraRoutes: [{ path: "/api/auth/session", handler: async (_req, res) => {
        const response = await fetch(url + "/api/auth/session", { headers: switchedToken ? { authorization: `Bearer ${switchedToken}` } : {} });
        res.setHeader("content-type", "application/json"); res.end(await response.text());
      } }, { path: `/api/routines/${routine.id}/run-protected`, method: "POST", handler: async (req, res) => {
        const key = String(req.headers["idempotency-key"]), context = String(req.headers["x-entropybot-manual-context"]);
        const response = await fetch(url + req.url, { method: "POST", headers: { origin: url, "Idempotency-Key": key, "X-Entropybot-Manual-Context": context, ...(switchedToken ? { authorization: `Bearer ${switchedToken}` } : {}) }, signal: AbortSignal.timeout(15_000) });
        const body = await response.text();
        posts.push({ key, context, runId: JSON.parse(body).run?.id });
        res.statusCode = response.status; res.setHeader("content-type", "application/json"); res.end(body);
      } }, { path: `/api/routines/${routine.id}/run`, method: "POST", handler: (_req, res) => {
        legacyPosts++; res.statusCode = 500; res.end("Synthetic legacy fallback refused");
      } }],
    });
    const profile = join(dataDir, "reload-chrome"); mkdirSync(profile);
    chrome = spawn(chromePath, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
      "--password-store=basic", "--use-mock-keychain", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], {
      env: { PATH: process.env.PATH, HOME: dataDir, USERPROFILE: dataDir }, stdio: "ignore",
    });
    const portFile = join(profile, "DevToolsActivePort");
    await expect.poll(() => existsSync(portFile), { timeout: 20_000 }).toBe(true);
    const [port, endpoint] = readFileSync(portFile, "utf8").trim().split("\n");
    connection = new CdpConnection(await webSocketTransport(`ws://127.0.0.1:${port}${endpoint}`));
    const target = await connection.root.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const attached = await connection.root.send<{ sessionId: string }>("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const page = new CdpSession(connection, attached.sessionId, "page");
    const evaluate = async (expression: string) => {
      const result = await page.send<{ result: { value: any }; exceptionDetails?: unknown }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, { pageWorld: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const click = (text: string) => evaluate(`(() => { const b = [...document.querySelectorAll('aside button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) throw Error('Missing enabled control: ' + ${JSON.stringify(text)}); b.click(); return true; })()`);
    const has = (text: string) => evaluate(`!![...document.querySelectorAll('aside button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled)`);
    const marker = () => evaluate(`JSON.parse(localStorage.getItem('${storageKey}')).entries[0]`);
    const runs = async () => (await api("GET", "/api/routines")).runs.filter((run: { routineId: string }) => run.routineId === routine.id);
    await page.send("Page.enable"); await page.send("Page.navigate", { url: preview.previewUrl });
    await expect.poll(() => has("Run now"), { timeout: 45_000 }).toBe(true);
    await evaluate(`window.syntheticLoad = true; localStorage.setItem('omb-analytics-opt-out', '1');
      window.originalFetch = window.fetch; window.fetch = async (...args) => {
        const response = await window.originalFetch(...args);
        if (String(args[0]).endsWith('/run-protected')) {
          if (${JSON.stringify(fault)} === 'lost') throw Error('Synthetic accepted response lost');
          if (${JSON.stringify(fault)} === 'in-flight') await new Promise(resolve => window.releaseResponse = resolve);
        }
        return response;
      };
      if (${JSON.stringify(fault)} === 'readback') {
        const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
        let fail = false, failed = false;
        Storage.prototype.setItem = function(k,v) { set.call(this,k,v); if(k === '${storageKey}' && !failed && JSON.parse(v).entries.some(e=>e.phase==='confirmed')) fail=true; };
        Storage.prototype.getItem = function(k) { if(k==='${storageKey}' && fail) { fail=false; failed=true; window.readbackFault=true; throw Error('Synthetic readback denied'); } return get.call(this,k); };
      } true`);
    await click("Run now");
    await expect.poll(() => posts.length, { timeout: 20_000 }).toBe(1);
    if (fault !== "in-flight") await expect.poll(() => has("Retry")).toBe(true);
    else await expect.poll(() => evaluate("typeof window.releaseResponse === 'function'")).toBe(true);
    if (fault === "readback") { expect(await evaluate("window.readbackFault")).toBe(true); expect((await marker()).phase).toBe("confirmed"); }
    const original = await marker();
    await expect.poll(async () => (await runs())[0]?.status, { timeout: 25_000 }).toBe("completed");
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const env = verificationServerEnvironment({ FAKE_CLAUDE_MODE: "happy" }, dataDir, Number(new URL(url).port));
    const log = openSync(logPath, "a", 0o600);
    try { restarted = spawn(process.execPath, verificationServerArgs(env), { cwd: process.cwd(), env, stdio: ["ignore", log, log] }); }
    finally { closeSync(log); }
    await expect.poll(async () => { try { return (await fetch(url + "/api/health")).ok; } catch { return false; } }, { timeout: 20_000 }).toBe(true);
    await page.send("Page.reload");
    await expect.poll(() => evaluate("window.syntheticLoad === undefined && document.readyState === 'complete'"), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => has("Retry"), { timeout: 30_000 }).toBe(true);
    expect(await evaluate("window.syntheticLoad === undefined")).toBe(true);
    expect(posts).toHaveLength(1); expect(await marker()).toEqual(original);
    expect(await evaluate("document.querySelector('[role=alert]')?.textContent")).toContain("previous request may already have run");
    await evaluate("window.confirm = () => false; true"); await click("Start another run…"); expect(posts).toHaveLength(1);
    const opened = await api("POST", "/api/auth/pairing", { label: "Synthetic changed caller", scopes: ["client"] });
    switchedToken = (await api("POST", "/api/auth/pair", { code: opened.code })).token;
    await click("Retry");
    await expect.poll(() => evaluate("document.body.textContent.includes('The account or workspace changed. The previous request has been kept.')")).toBe(true);
    await expect.poll(() => has("Retry")).toBe(true);
    expect(posts).toHaveLength(1); expect(await marker()).toEqual(original);
    switchedToken = undefined;
    await click("Retry"); await expect.poll(() => posts.length).toBe(2);
    await expect.poll(() => has("Run now")).toBe(true);
    expect(posts[1]).toEqual(posts[0]); expect(await runs()).toHaveLength(1);
    await click("Run now"); await expect.poll(() => posts.length).toBe(3);
    await expect.poll(() => has("Run now")).toBe(true);
    expect(posts[2].key).not.toBe(posts[0].key); expect(posts[2].context).toBe(posts[0].context);
    expect(posts[2].runId).not.toBe(posts[0].runId); expect(await runs()).toHaveLength(2);
    await expect.poll(async () => (await runs()).find((run: { id: string }) => run.id === posts[2].runId)?.status, { timeout: 25_000 }).toBe("completed");
    expect(legacyPosts).toBe(0); expect(posts).toHaveLength(3); passed = true;
  } finally {
    connection?.close();
    try { await waitForExit(chrome, { signal: "SIGTERM" }); closed.browser = true; }
    finally {
      try { await preview?.close(); }
      finally {
        try { await waitForExit(restarted, { signal: "SIGTERM" }); closed.restarted = true; }
        finally {
          try {
            if (closed.browser && closed.restarted) { await fixture?.close(); closed.fixture = true; }
            else await waitForExit(fixture?.child, { signal: "SIGTERM" });
          } finally {
            if (fixture) {
              closed.directoryRemoved = !existsSync(fixture.info.dataDir);
              const report = process.env.OMB_RELOAD_EVIDENCE_DIR
                ? join(process.env.OMB_RELOAD_EVIDENCE_DIR, `manual-reload-${fault}.json`) : `${fixture.info.logPath}.manual-reload.json`;
              writeFileSync(report, JSON.stringify({ fault, passed, posts, legacyPosts, closed, fixture: fixture.info }, null, 2));
              if (closed.fixture) expect(closed.directoryRemoved).toBe(true);
            }
          }
        }
      }
    }
  }
}, 150_000);
