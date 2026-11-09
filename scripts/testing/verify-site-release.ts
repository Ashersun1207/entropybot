import assert from "node:assert/strict";
import { readFileSync, lstatSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { openHeadlessChrome } from "./headless-chrome.ts";

const dir = process.env.SITE_RELEASE_DIR ?? "";
const output = process.env.SITE_EVIDENCE_DIR ?? "";
if (!dir || !output) throw new Error("Release dir and evidence dir required");
mkdirSync(output, { recursive: true });
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json" };
function find(pathname: string): Buffer | undefined {
  if (!pathname || pathname === "/") return readFileSync(join(dir, "index.html"));
  const file = resolve(dir, pathname.slice(1));
  if (!file.startsWith(dir + sep)) return undefined;
  try {
    if (lstatSync(file).isFile()) return readFileSync(file);
    if (lstatSync(file).isDirectory()) return readFileSync(join(file, "index.html"));
  } catch {}
  return undefined;
}
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!["GET", "HEAD"].includes(req.method ?? "")) { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return; }
  const pathname = decodeURIComponent(url.pathname);
  const body = find(pathname);
  if (body === undefined) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("Not found"); return; }
  const type = pathname === "/" || pathname.endsWith("/") ? types[".html"] : types[extname(pathname)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store", "x-robots-tag": "noindex, nofollow, noarchive", "referrer-policy": "same-origin" });
  res.end(req.method === "HEAD" ? undefined : body);
});
await new Promise<void>((resolveListen) => server.listen(5211, "127.0.0.1", resolveListen));
const origin = "http://127.0.0.1:5211";
const startedAt = new Date().toISOString();
const checks: Record<string, unknown> = {};
async function runCase(name: string, seed: string, absentSeed?: string) {
  const page = await openHeadlessChrome(mkdtempSync(join(tmpdir(), "entropybot-site-release-")));
  try {
    await page.send("Page.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.send("Page.navigate", { url: `${origin}/` });
    await page.until('document.querySelector(".app-frame")?.dataset.state==="ready"', 30000);
    const tree = await page.send("Page.getFrameTree");
    const frame = tree.frameTree.childFrames.find((entry: { frame: { url: string } }) => new URL(entry.frame.url).pathname.endsWith("/product/"));
    assert(frame);
    const context = (await page.send("Page.createIsolatedWorld", { frameId: frame.frame.id, worldName: `release-${name}` })).executionContextId;
    const child = async (expression: string) => {
      const result = await page.send("Runtime.evaluate", { expression, contextId: context, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result?.value;
    };
    const childWait = (condition: string) => child(`new Promise((resolve,reject)=>{const done=()=>(${condition});if(done())return resolve(true);const o=new MutationObserver(()=>{if(done()){o.disconnect();clearTimeout(t);resolve(true)}});o.observe(document.body,{subtree:true,childList:true,characterData:true});const t=setTimeout(()=>{o.disconnect();reject(Error('Condition not met'))},25000)})`);
    await childWait(`document.querySelector('main')?.innerText.includes('日期有出入')`);
    await childWait(`document.querySelector('main')?.innerText.includes('邀请仍留作草稿，等你最后确认')`);
    const components = await child(`({
      tool: document.querySelector('main').innerText.includes('读取活动说明'),
      routine: document.querySelector('main').innerText.includes('读书会准备清单'),
    })`);
    assert.equal(components.tool, true);
    assert.equal(components.routine, true);
    if (absentSeed) {
      assert.equal(await child(`document.querySelector('main').innerText.includes(${JSON.stringify(absentSeed)})`), false);
      assert.equal(await child(`sessionStorage.getItem('entropybot.site.api.v1')?.includes(${JSON.stringify(absentSeed)}) ?? false`), false);
    }
    const previousReplies = await child(`[...document.querySelectorAll('main [data-citation-source]')].filter(e=>e.textContent.includes('这里没有发送邀请或创建日历')).length`);
    await page.send("Page.bringToFront");
    await child('document.querySelector("textarea").focus()');
    await page.send("Input.insertText", { text: seed });
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await child(`new Promise((resolve,reject)=>{const done=()=>document.querySelector('main')?.innerText.includes(${JSON.stringify(seed)})&&[...document.querySelectorAll('main [data-citation-source]')].filter(e=>e.textContent.includes('这里没有发送邀请或创建日历')).length>${previousReplies};if(done())return resolve(true);const o=new MutationObserver(()=>{if(done()){o.disconnect();clearTimeout(t);resolve(true)}});o.observe(document.body,{subtree:true,childList:true,characterData:true});const t=setTimeout(()=>{o.disconnect();reject(Error('Missing reply'))},20000)})`);
    const draft = await child('document.querySelector("textarea")?.value ?? ""');
    assert.equal(draft, "");
    const sentEcho = await child(`document.querySelector('main')?.innerText.includes(${JSON.stringify(seed)})`);
    assert.equal(sentEcho, true);
    return { sameOrigin: new URL(frame.frame.url).origin === origin, seeded: true, replied: true, playbackCompleted: true };
  } finally { page.close(); }
}
try {
  const first = await runCase("a", "独立核验一：请准备清单。");
  const second = await runCase("b", "独立核验二：请准备清单。", "独立核验一：请准备清单。");
  checks.first = first; checks.second = second;
  assert.equal(first.seeded, true); assert.equal(second.seeded, true);
  assert.equal(first.replied, true); assert.equal(second.replied, true);
  assert.equal(first.sameOrigin, true); assert.equal(second.sameOrigin, true);
  checks.isolation = true;
  const boundaries: Record<string, number> = {};
  for (const path of ["/ui/.vite/manifest.json", "/ui/assets/site-interactive-preview-", "/product/connection.json", "/api/config"]) {
    boundaries[path] = (await fetch(`${origin}${path}`, { method: path === "/api/config" ? "POST" : "HEAD", headers: path === "/api/config" ? { "content-type": "application/json" } : {}, body: path === "/api/config" ? "{}" : undefined })).status;
  }
  checks.boundaries = boundaries;
  assert.equal(boundaries["/ui/.vite/manifest.json"], 404);
  assert.equal(boundaries["/ui/assets/site-interactive-preview-"], 404);
  assert.equal(boundaries["/product/connection.json"], 200);
  assert(boundaries["/api/config"] >= 400);
  checks.passed = true;
  writeFileSync(join(output, "release-checks.json"), JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), checks, passed: true }, null, 2));
  console.log(JSON.stringify(checks, null, 2));
} catch (error) {
  writeFileSync(join(output, `release-failure-${Date.now()}.json`), JSON.stringify({ startedAt, checks, error: String(error), passed: false }, null, 2));
  throw error;
} finally { server.close(); }
