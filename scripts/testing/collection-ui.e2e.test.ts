import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, verificationServerArgs, verificationServerEnvironment, type VerificationServer } from "../control-omb.ts";
import { waitForExit } from "../../server/testing/cleanup.ts";
import { CdpConnection, CdpSession } from "../../server/browser/cdp/connection.ts";
import { webSocketTransport } from "../../server/browser/cdp/transport.ts";
import { fixtureApi, mountPreview, type MountedPreview } from "./preview-fixture.ts";

it.runIf(process.env.OMB_UI_E2E === "1")("creates and runs a manual collection from actual Automations navigation, preserving identity through reload", async () => {
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  expect(existsSync(chromePath), "Use existing Chrome only").toBe(true);
  let fixture: VerificationServer | undefined, preview: MountedPreview | undefined;
  let chrome: ChildProcess | undefined, server: ChildProcess | undefined, connection: CdpConnection | undefined;
  const reads: string[] = [], posts: Array<{ key: string; context: string; runId: string }> = [];
  let legacyPosts = 0, passed = false;
  let reportMode: "normal" | "denied" | "missing" | "oversized" = "normal";
  const reportRequests: Array<{ requested: string; forwarded: string; status: number; mode: string }> = [];
  const closed = { browser: false, server: false, pages: false, fixture: false, directoryRemoved: false };
  const pages = createServer((req, res) => { reads.push(req.url!); res.setHeader("content-type", "text/html"); res.end('<p>Literal adversarial &lt;img src="https://adversary.invalid/pixel"&gt; [open](file:///secret) &lt;script&gt;alert(1)&lt;/script&gt;</p>'); });
  try {
    await new Promise<void>(resolve => pages.listen(0, "127.0.0.1", resolve));
    const port = (pages.address() as { port: number }).port;
    fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "happy" });
    const { url, dataDir, logPath } = fixture.info;
    writeFileSync(join(dataDir, "collection-fixture.json"), JSON.stringify({ port }), { mode: 0o600 });
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const env = verificationServerEnvironment({ FAKE_CLAUDE_MODE: "happy" }, dataDir, Number(new URL(url).port));
    const log = openSync(logPath, "a", 0o600);
    try { server = spawn(process.execPath, ["--import", fileURLToPath(new URL("../../server/testing/collection-http-hooks.mjs", import.meta.url)), ...verificationServerArgs(env)], { cwd: process.cwd(), env, stdio: ["ignore", log, log] }); }
    finally { closeSync(log); }
    await expect.poll(async () => { try { return (await fetch(url + "/api/health")).ok; } catch { return false; } }, { timeout: 20_000 }).toBe(true);
    const api = fixtureApi(url);
    const { bots } = await api("GET", "/api/bots");
    await api("PATCH", `/api/bots/${bots[0].id}`, { chiefOfStaff: false });
    await api("PATCH", "/api/config", { language: "en" });
    preview = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__collection.html", title: "Synthetic collection", logLevel: "error",
      extraRoutes: [{ path: /^\/api\/routines\/[^/]+\/runs\/[^/]+\/collection-report$/, method: "GET", handler: async (req, res) => {
        const requested = req.url!, forwarded = reportMode === "missing" ? requested.replace(/\/runs\/[^/]+\//, "/runs/missing-fixture-run/") : requested;
        const response = await fetch(url + forwarded, { headers: { origin: reportMode === "denied" ? "https://unpaired.invalid" : url }, signal: AbortSignal.timeout(15_000) });
        reportRequests.push({requested,forwarded,status:response.status,mode:reportMode});
        res.statusCode=response.status; res.setHeader("content-type","application/json");
        if(reportMode==='oversized') res.setHeader('content-length','62000001');
        res.end(await response.text());
      } }, { path: /^\/api\/routines\/[^/]+\/run-protected$/, method: "POST", handler: async (req, res) => {
        const key = String(req.headers["idempotency-key"]), context = String(req.headers["x-entropybot-manual-context"]);
        const response = await fetch(url + req.url, { method: "POST", headers: { origin: url, "Idempotency-Key": key, "X-Entropybot-Manual-Context": context }, signal: AbortSignal.timeout(15_000) });
        const body = await response.text(); posts.push({ key, context, runId: JSON.parse(body).run?.id });
        res.statusCode = response.status; res.setHeader("content-type", "application/json"); res.end(body);
      } }, { path: /^\/api\/routines\/[^/]+\/run$/, method: "POST", handler: (_req, res) => { legacyPosts++; res.statusCode = 500; res.end("Forbidden legacy fallback"); } }],
    });
    const profile = join(dataDir, "collection-chrome"); mkdirSync(profile);
    chrome = spawn(chromePath, ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--password-store=basic", "--use-mock-keychain", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { env: { PATH: process.env.PATH, HOME: dataDir, USERPROFILE: dataDir }, stdio: "ignore" });
    const portFile = join(profile, "DevToolsActivePort"); await expect.poll(() => existsSync(portFile), { timeout: 20_000 }).toBe(true);
    const [debugPort, endpoint] = readFileSync(portFile, "utf8").trim().split("\n");
    connection = new CdpConnection(await webSocketTransport(`ws://127.0.0.1:${debugPort}${endpoint}`));
    const target = await connection.root.send<{targetId:string}>("Target.createTarget", { url: "about:blank" });
    const attached = await connection.root.send<{sessionId:string}>("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const page = new CdpSession(connection, attached.sessionId, "page");
    const evaluate = async (expression: string) => {
      const result = await page.send<{result:{value:any};exceptionDetails?:unknown}>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, { pageWorld: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value;
    };
    const click = (label: string, scope = "main") => evaluate(`(() => {const b=[...document.querySelectorAll(${JSON.stringify(scope + " button")})].find(b=>b.textContent.trim()===${JSON.stringify(label)}); if(!b || b.disabled) throw Error('Missing enabled button '+${JSON.stringify(label)}); b.click(); return true;})()`);
    const text = (selector = "main") => evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`) as Promise<string>;
    const fill = (selector: string, value: string) => evaluate(`(() => { const field=document.querySelector(${JSON.stringify(selector)}); const proto=field instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(field,${JSON.stringify(value)}); field.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    const openAutomations = async () => {
      await expect.poll(() => evaluate(`(() => {document.querySelector('button[aria-label="Open bot list"]')?.click(); const b=[...document.querySelectorAll('button,[role="menuitem"]')].find(b=>b.textContent.trim()==='Automations'); if(b) { b.click(); return true; } [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Tools')?.click(); return false;})()`), { timeout: 45_000 }).toBe(true);
      await expect.poll(() => text("main h1")).toBe("Automations");
    };
    const openCollection = async () => { await expect.poll(() => evaluate(`(() => {const row=[...document.querySelectorAll('[data-automation]')].find(r=>r.textContent.includes('Synthetic pages')); row?.querySelector('button')?.click(); return Boolean(row);})()`)).toBe(true); };
    await page.send("Page.enable"); await page.send("Emulation.setDeviceMetricsOverride", {width:1280,height:800,deviceScaleFactor:1,mobile:false});
    await page.send("Page.navigate", { url: preview.previewUrl }); await openAutomations();
    await click("New"); await click("Manual web collection", '[role="dialog"]');
    await expect.poll(() => text('[role="dialog"]')).toContain("Page URLs · one URL per line");
    expect(await evaluate(`document.querySelectorAll('[role="dialog"] input[type="time"],[role="dialog"] input[type="date"],[role="dialog"] input[type="checkbox"]').length`)).toBe(0);
    await fill('[role="dialog"] input', 'Synthetic pages');
    for (const invalid of ['not a URL', 'https://user:password@collection-fixture.invalid/page']) {
      await fill('[role="dialog"] textarea', invalid); await expect.poll(() => text('[role="dialog"]')).toContain('Check every line');
      expect(await evaluate(`!![...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='Save' && b.disabled)`)).toBe(true);
    }
    const source = `http://collection-fixture.invalid:${port}/page`;
    await fill('[role="dialog"] textarea', `${source}#one\n${source}#two`); await click('Save', '[role="dialog"]');
    await expect.poll(() => evaluate(`document.querySelector('[role="dialog"]')===null`)).toBe(true);
    expect((await api('GET','/api/routines')).runs).toHaveLength(0); expect(reads).toHaveLength(0);
    const saved = (await api('GET','/api/routines')).routines.find((r:any)=>r.name==='Synthetic pages');
    expect(saved).toMatchObject({enabled:false,runOn:'maus',target:'bot',collection:{kind:'web-collection',version:1,sources:[{url:source},{url:source}]}});
    await openCollection(); expect(await evaluate(`document.querySelector('aside[aria-label="Routine details"]').innerText.includes('Resume')`)).toBe(false);
    await click('Edit', 'aside[aria-label="Routine details"]');
    await expect.poll(() => evaluate(`document.querySelector('[role="dialog"] textarea')?.value`)).toBe(`${source}\n${source}`);
    await click('Save', '[role="dialog"]');
    await expect.poll(() => evaluate(`document.querySelector('[role="dialog"]')===null`)).toBe(true);
    expect((await api('GET','/api/routines')).routines.find((r:any)=>r.id===saved.id)).toMatchObject({collection:saved.collection,enabled:false,schedule:saved.schedule});
    await evaluate(`window.syntheticDocument=true; window.originalFetch=window.fetch; window.fetch=async(...args)=>{ const response=await window.originalFetch(...args); if(String(args[0]).endsWith('/run-protected')) throw Error('Synthetic accepted response lost'); return response; }; const b=[...document.querySelectorAll('aside[aria-label="Routine details"] button')].find(b=>b.textContent.trim()==='Run now'); b.click(); b.click(); true`);
    await expect.poll(() => posts.length).toBe(1);
    await expect.poll(() => text('aside[aria-label="Routine details"]'), {timeout:20_000}).toContain('Retry');
    await expect.poll(async () => (await api('GET','/api/routines')).runs[0]?.status, { timeout:25_000 }).toBe('completed');
    const first = (await api('GET','/api/routines')).runs[0];
    const artifactFiles = readdirSync(join(dataDir,'collection-reports')); expect(artifactFiles).toHaveLength(1);
    const artifact = readFileSync(join(dataDir,'collection-reports',artifactFiles[0]),'utf8'); expect(JSON.parse(artifact).sources).toHaveLength(1);
    await page.send('Page.reload'); await expect.poll(() => evaluate("window.syntheticDocument===undefined && document.readyState==='complete'"), {timeout:30_000}).toBe(true);
    await openAutomations(); await openCollection(); await expect.poll(() => text('aside[aria-label="Routine details"]')).toContain('Retry');
    expect(posts).toHaveLength(1); expect(await text('aside[aria-label="Routine details"]')).not.toContain(dataDir);
    await click('Retry','aside[aria-label="Routine details"]'); await expect.poll(() => posts.length).toBe(2); expect(posts[1]).toEqual(posts[0]);
    await expect.poll(() => text('aside[aria-label="Routine details"]')).toContain('Pages: 2 · Unique sources: 1'); expect(await text('aside[aria-label="Routine details"]')).toContain('View report');
    expect((await api('GET','/api/routines')).runs).toHaveLength(1); expect(reads).toEqual(['/page','/page']); expect(legacyPosts).toBe(0);
    const reportScope = 'aside[aria-label="Routine details"] section[aria-label="Collection report"]';
    expect(reportRequests).toHaveLength(0);
    reportMode='denied'; await click('View report', reportScope);
    await expect.poll(() => text(reportScope)).toContain('You do not have access to this report.');
    reportMode='missing'; await click('View report', reportScope);
    await expect.poll(() => text(reportScope)).toContain('This report is missing or no longer available.');
    reportMode='normal';
    const artifactPath=join(dataDir,'collection-reports',artifactFiles[0]);
    writeFileSync(artifactPath,artifact.replace('Literal','Changed'));
    await click('View report', reportScope); await expect.poll(() => text(reportScope)).toContain('This report could not be verified. Its contents are hidden.');
    expect(await evaluate(`document.querySelector(${JSON.stringify(reportScope)})?.querySelector('pre')===null`)).toBe(true);
    writeFileSync(artifactPath,artifact);
    reportMode='oversized'; await click('View report', reportScope);
    await expect.poll(() => reportRequests.length).toBe(4);
    await expect.poll(() => text(reportScope)).toContain('This report could not be verified. Its contents are hidden.');
    expect(await evaluate(`document.querySelector(${JSON.stringify(reportScope)})?.querySelector('pre')===null`)).toBe(true);
    reportMode='normal'; await click('View report', reportScope); await expect.poll(() => text(reportScope)).toContain('Source 1');
    expect(reportRequests.map(request=>request.status)).toEqual([403,404,409,200,200]);
    expect(reportRequests.map(request=>request.mode)).toEqual(['denied','missing','normal','oversized','normal']);
    expect(reportRequests.every(request=>request.requested===`/api/routines/${saved.id}/runs/${first.id}/collection-report`)).toBe(true);
    expect(await evaluate(`document.querySelector(${JSON.stringify(reportScope)})?.querySelectorAll('a,img,script,iframe').length`)).toBe(0);
    expect(await evaluate(`document.querySelector(${JSON.stringify(reportScope)})?.querySelector('details').open`)).toBe(false);
    await evaluate(`document.querySelector(${JSON.stringify(reportScope)})?.querySelector('summary').click(); true`);
    const displayed=await text(reportScope);
    expect(displayed).toContain(JSON.parse(artifact).sources[0].text); expect(displayed).not.toContain(dataDir);
    expect(await evaluate(`document.querySelector(${JSON.stringify(reportScope)})?.querySelector('pre').getBoundingClientRect().height>0`)).toBe(true);
    expect(reads).toEqual(['/page','/page']);
    expect(readFileSync(artifactPath,'utf8')).toBe(artifact);
    expect(existsSync(fixture.fixtureDumpPath), 'No fake provider launched').toBe(false);
    const messages=(await api('GET',`/api/threads/${first.resultsThreadId}/messages?limit=200`)).messages;
    const durable = messages.filter((m:any)=>m.automation?.runId===first.id);
    expect(durable).toHaveLength(1);
    expect(durable[0].text).toBe(first.output);
    expect(durable[0].text).toContain(`Path: ${JSON.stringify(artifactPath)}`);
    const screenshot=await page.send<{data:string}>('Page.captureScreenshot',{format:'png'});
    writeFileSync(`${fixture.info.logPath}.collection-ui.png`,Buffer.from(screenshot.data,'base64'));
    await click('Open results thread', 'aside[aria-label="Routine details"]');
    const chatSelector = `[data-mid="${durable[0].id}"]`;
    await expect.poll(() => text(chatSelector), {timeout:20_000}).toContain('Pages: 2');
    expect(await text(chatSelector)).toContain('Unique: 1');
    expect(await text(chatSelector)).not.toContain('Path:');
    expect(await text(chatSelector)).not.toContain(dataDir);
    expect(await evaluate(`document.querySelector(${JSON.stringify(chatSelector)})?.querySelectorAll('a,img,script,iframe').length`)).toBe(0);
    await evaluate(`document.querySelector('button[aria-label="Open bot list"]')?.click(); true`);
    const sidebarSelector = `[data-sidebar-bot-row="${first.botId}"]`;
    await expect.poll(() => text(sidebarSelector)).toContain('Pages: 2');
    expect(await text(sidebarSelector)).toContain('Unique: 1');
    expect(await text(sidebarSelector)).not.toContain('Path:');
    expect(await text(sidebarSelector)).not.toContain(dataDir);
    expect(await evaluate(`document.querySelector(${JSON.stringify(sidebarSelector)})?.querySelectorAll('a,img,script,iframe').length`)).toBe(0);
    const publicScreenshot=await page.send<{data:string}>('Page.captureScreenshot',{format:'png'});
    writeFileSync(`${fixture.info.logPath}.collection-public.png`,Buffer.from(publicScreenshot.data,'base64'));
    const afterMessages=(await api('GET',`/api/threads/${first.resultsThreadId}/messages?limit=200`)).messages;
    expect(afterMessages.find((m:any)=>m.id===durable[0].id)).toEqual(durable[0]);
    expect(readFileSync(artifactPath,'utf8')).toBe(artifact);
    expect(reads).toEqual(['/page','/page']);
    passed=true;
  } finally {
    connection?.close();
    try { await waitForExit(chrome,{signal:'SIGTERM'}); closed.browser=true; }
    finally {
      try { await preview?.close(); }
      finally {
        try { await waitForExit(server,{signal:'SIGTERM'}); closed.server=true; }
        finally {
          pages.closeAllConnections(); await new Promise<void>((resolve,reject)=>pages.close(error=>error?reject(error):resolve())); closed.pages=true;
          if(closed.browser && closed.server && closed.pages) { await fixture?.close(); closed.fixture=true; }
          if(fixture) {
            closed.directoryRemoved=!existsSync(fixture.info.dataDir);
            writeFileSync(`${fixture.info.logPath}.collection-ui.json`,JSON.stringify({passed,posts,legacyPosts,reads,reportRequests,closed,fixture:fixture.info,reportAccess:'real authorized endpoint; actual denial, missing identity and tampered artifact responses'},null,2));
            if(closed.fixture) expect(closed.directoryRemoved).toBe(true);
          }
        }
      }
    }
  }
},180_000);
