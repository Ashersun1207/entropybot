import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openHeadlessChrome } from "./headless-chrome.ts";

const url = process.env.SITE_PUBLIC_URL ?? "";
const output = process.env.SITE_EVIDENCE_DIR ?? "";
if (!url || !output) throw new Error("Public URL and evidence dir required");
mkdirSync(output, { recursive: true });
const startedAt = new Date().toISOString();
const checks: Record<string, unknown> = {};
async function context(page: Awaited<ReturnType<typeof openHeadlessChrome>>, suffix: string) {
  const tree = await page.send("Page.getFrameTree");
  const frame = tree.frameTree.childFrames.find((entry: { frame: { url: string } }) => new URL(entry.frame.url).pathname.endsWith(suffix));
  assert(frame, `missing ${suffix} frame`);
  return (await page.send("Page.createIsolatedWorld", { frameId: frame.frame.id, worldName: `public-${suffix}` })).executionContextId;
}
async function run() {
  const page = await openHeadlessChrome(mkdtempSync(join(tmpdir(), "entropybot-site-public-")));
  try {
    await page.send("Page.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.send("Page.navigate", { url });
    await page.until('document.querySelector(".app-frame")?.dataset.state==="ready"', 30000);
    const product = await context(page, "/product/");
    const child = async (expression: string) => {
      const result = await page.send("Runtime.evaluate", { expression, contextId: product, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result?.value;
    };
    await child(`new Promise((resolve,reject)=>{const done=()=>document.querySelector('main')?.innerText.includes('邀请仍留作草稿，等你最后确认');if(done())return resolve(true);const o=new MutationObserver(()=>{if(done()){o.disconnect();clearTimeout(t);resolve(true)}});o.observe(document.body,{subtree:true,childList:true,characterData:true});const t=setTimeout(()=>{o.disconnect();reject(Error('Missing completed sample conversation'))},25000)})`);
    const previousReplies = await child(`[...document.querySelectorAll('main [data-citation-source]')].filter(e=>e.textContent.includes('这里没有发送邀请或创建日历')).length`);
    await page.send("Page.bringToFront");
    await child('document.querySelector("textarea").focus()');
    await page.send("Input.insertText", { text: "上线验收：请准备清单。" });
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await child(`new Promise((resolve,reject)=>{const done=()=>document.querySelector('main')?.innerText.includes('上线验收：请准备清单。')&&[...document.querySelectorAll('main [data-citation-source]')].filter(e=>e.textContent.includes('这里没有发送邀请或创建日历')).length>${previousReplies};if(done())return resolve(true);const o=new MutationObserver(()=>{if(done()){o.disconnect();clearTimeout(t);resolve(true)}});o.observe(document.body,{subtree:true,childList:true,characterData:true});const t=setTimeout(()=>{o.disconnect();reject(Error('Missing reply'))},20000)})`);
    checks.workspace = { sent: true, replied: true, sameOrigin: await child('location.origin === new URL(document.referrer).origin') };
    await page.evaluate('document.querySelector("#workflow").scrollIntoView({block:"start",behavior:"instant"})');
    await page.until('document.querySelector(".features-status").hidden', 30000);
    const feature = await context(page, "/features/");
    await page.send("Runtime.evaluate", { contextId: feature, expression: `document.querySelector('[data-feature="team"] .feature-chat').click()` });
    await page.until('document.querySelector(".workspace-health").textContent.includes("示例已放入输入框")', 15000);
    const featureCheck = { draftFilled: await child('document.querySelector("textarea").value.includes("请汇总资料助手")') };
    checks.feature = featureCheck;
    assert.equal(featureCheck.draftFilled, true);
    checks.parentOverflow = await page.evaluate('document.documentElement.scrollWidth>innerWidth');
    assert.equal(checks.parentOverflow, false);
    const boundaries = {
      manifest: (await fetch(`${url}ui/.vite/manifest.json`, { method: "HEAD" })).status,
      connection: (await fetch(`${url}product/connection.json`, { method: "HEAD" })).status,
      postRefused: (await fetch(`${url}api/config`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status,
    };
    checks.boundaries = boundaries;
    assert.equal(boundaries.manifest, 404);
    assert.equal(boundaries.connection, 200);
    assert(boundaries.postRefused >= 400);
    writeFileSync(join(output, "public.webp"), Buffer.from((await page.send("Page.captureScreenshot", { format: "webp", quality: 85 })).data, "base64"));
    checks.passed = true;
  } finally { page.close(); }
}
try {
  await run();
  writeFileSync(join(output, "public-checks.json"), JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), checks, passed: true }, null, 2));
  console.log(JSON.stringify(checks, null, 2));
} catch (error) {
  writeFileSync(join(output, `public-failure-${Date.now()}.json`), JSON.stringify({ startedAt, checks, error: String(error), passed: false }, null, 2));
  throw error;
}
