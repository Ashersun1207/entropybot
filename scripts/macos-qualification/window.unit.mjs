import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { environment } from "./contract.mjs";
import { parse } from "yaml";
import { encodePng } from "../testing/png.ts";
import { windowWorkflowContract } from "./window-workflow-contract.mjs";
import { windowCommands, requireWindowDist, requireWindowHealth, requireDrawnRegion, WINDOW_ORIGIN } from "./window-contract.mjs";
import { observeApplicationWindow, windowPaths, assertWindowPaths } from "./window-observer.mjs";
import { applicationWindow } from "./window.mjs";
import { createGateCapability } from "../testing/verification-lifecycle.ts";

const workflow = parse(readFileSync(new URL("../../.github/workflows/entropybot-macos-window.yml", import.meta.url), "utf8"));
test("window workflow retains isolated installer and build/window mode on exact branch", () => windowWorkflowContract(workflow));
for (const [name, mutate] of [
  ["mutable action", w => { w.jobs.qualify.steps[1].uses = "actions/checkout@v4"; }],
  ["missing architecture check", w => { w.jobs.qualify.steps[0].run = w.jobs.qualify.steps[0].run.replace('test "$(/usr/bin/uname -m)" = arm64', "true"); }],
  ["no build/window entry", w => { w.jobs.qualify.steps[3].run = w.jobs.qualify.steps[3].run.replace(' window\n', '\n'); }],
  ["ignored failure", w => { w.jobs.qualify.steps[3].run += " || true"; }],
  ["secret in child", w => { w.jobs.qualify.steps[3].env = { KEY: "${{ secrets.KEY }}" }; }],
  ["profile artifact leak", w => { w.jobs.qualify.steps[4].with.path = "${{ runner.temp }}/"; }],
  ["hidden profile bytes", w => { w.jobs.qualify.steps[4].with["include-hidden-files"] = true; }],
  ["secret outside isolated command", w => { w.jobs.qualify.env = { KEY: "${{ secrets.KEY }}" }; }],
  ["rerun", w => { w.jobs.qualify.steps[0].run = w.jobs.qualify.steps[0].run.replace('test "$GITHUB_RUN_ATTEMPT" = 1', "true"); }],
]) test(`window workflow rejects ${name}`, () => { const w = structuredClone(workflow); mutate(w); assert.throws(() => windowWorkflowContract(w)); });

test("public commands build source and launch real main wrapper with mock Keychain and owned profile", () => {
  const commands = windowCommands("/owned/source", "/owned/pnpm.cjs", "/private/tmp/mq-unit", ["--import", "/owned/bootstrap.mjs"]);
  assert.deepEqual(commands.build, [process.execPath, "/owned/pnpm.cjs", "build"]);
  assert.deepEqual(commands.electron, ["/owned/source/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron", "--user-data-dir=/private/tmp/mq-unit/window-app-data/openmausbot", "--use-mock-keychain", "/owned/source/scripts/macos-qualification/window-entry.mjs"]);
  assert.ok(commands.worker.includes("/owned/source/scripts/macos-qualification/window.mjs"));
  assert.equal(JSON.stringify(commands).includes("cloudflared"), false);
});
function isolationChild(mode, check, fixtureName = "macos-window-isolation-child.mjs") {
  const home = realpathSync(mkdtempSync("/private/tmp/mwi-"));
  try {
    const fixture = fileURLToPath(new URL(`../testing/${fixtureName}`, import.meta.url));
    const argv = [fixture, home, mode];
    const env = environment(home, dirname(process.execPath));
    const result = spawnSync(process.execPath, argv, { env, encoding: "utf8", timeout: 10000 });
    if (process.env.MAC_CATALOG_EVIDENCE) writeFileSync(join(process.env.MAC_CATALOG_EVIDENCE, `window-isolation-${mode}.json`), JSON.stringify({ argv: [process.execPath, ...argv], env, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }, null, 2), { flag: "wx" });
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.error, undefined);
    const report = JSON.parse(result.stdout.trim());
    check(report, result.status, home);
  } finally { rmSync(home, { recursive: true, force: true }); }
}
for (const mode of ["window", "application"]) test(`real preinstall import closure for ${mode} mode resolves with installed packages unavailable`, () => {
  isolationChild(`preinstall-${mode}`, (report, status) => {
    assert.equal(status, 0);
    assert.equal(report.preinstallImported, true);
    assert.ok(report.startupModules.some(url => url.endsWith("/macos-qualification/application.mjs")));
    assert.ok(!report.startupModules.some(url => url.includes("/node_modules/") || url.endsWith("/macos-qualification/window.mjs") || url.endsWith("/control-omb.ts")));
    assert.deepEqual(report.deniedPackageControls, ["yaml", "zod"]);
    assert.match(report.sourceSha256, /^[a-f0-9]{64}$/);
  }, "macos-preinstall-import-child.mjs");
});

test("real entry survives main's actual userData override inside owned app/session/log paths", () => {
  isolationChild("owned-profile", (report, status, home) => {
    assert.equal(status, 0);
    assert.match(report.override.statement, /app\.getPath\("appData"\)/);
    assert.match(report.override.sourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.assignments.filter(a => a.name === "userData").length, 2);
    assert.deepEqual(report.observation.pathsBeforeImport, windowPaths(home));
    assert.deepEqual(report.observation.effectivePaths, windowPaths(home));
    assertWindowPaths({ getPath: name => report.observation.effectivePaths[name] }, home);
    assert.equal(report.observation.updaterNetworkDisabled, true);
  });
});
for (const mode of ["escaped-profile", "escaped-session"]) test(`real entry refuses ${mode} after actual main profile override`, () => {
  isolationChild(mode, (report, status) => {
    assert.equal(status, 1);
    assert.ok(report.override.statement);
    assert.equal(report.observation, null);
  });
});
test("diagnostic unpackaged updater schedules no network checks beyond 15 seconds and an hour or explicit IPC", () => {
  isolationChild("updater-diagnostic", (report, status) => {
    assert.equal(status, 0); assert.equal(report.firstCheckCalls, 0); assert.deepEqual(report.calls, []);
    assert.equal(report.state.status, "idle");
  });
});
for (const mode of ["updater-normal", "updater-packaged"]) test(`real manual updater keeps ${mode} behavior with intercepted fetch controls`, () => {
  isolationChild(mode, (report, status) => {
    assert.equal(status, 0); assert.equal(report.firstCheckCalls, 1); assert.ok(report.calls.length >= 2);
    assert.ok(report.calls.every(url => url === "https://api.github.com/repos/Ashersun1207/entropybot/releases/latest"));
  });
});

test("window refuses missing or unbuilt dist through public precondition", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mw-dist-")));
  try {
    assert.throws(() => requireWindowDist(root), /CI-built/);
    mkdirSync(join(root, "dist")); writeFileSync(join(root, "dist/index.html"), "<html>not built</html>");
    assert.throws(() => requireWindowDist(root), /built UI/);
    writeFileSync(join(root, "dist/index.html"), '<script type="module" src="/assets/index-fixture.js"></script>');
    assert.throws(() => requireWindowDist(root), /built UI/);
    mkdirSync(join(root, "dist/assets")); writeFileSync(join(root, "dist/assets/index-fixture.js"), "fixture");
    assert.equal(requireWindowDist(root), join(root, "dist"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("public orchestration builds before worker and stops on build failure or absent output", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "mw-flow-")));
  const reports = join(home, "reports"); mkdirSync(reports);
  const capability = createGateCapability(home);
  const options = { root: home, home, reports, env: { HOME: home }, capability, pnpm: "/synthetic/pnpm.cjs" };
  try {
    const calls = [];
    await assert.rejects(applicationWindow({ ...options, record: async command => { calls.push(command); throw new Error("synthetic build failure"); } }), /build failure/);
    assert.deepEqual(calls.map(c => c.name), ["window-source-build"]);
    assert.equal(calls[0].env.NODE_OPTIONS, "--max-old-space-size=6144");
    await assert.rejects(applicationWindow({ ...options, record: async () => ({}) }), /CI-built/);
    calls.length = 0;
    await applicationWindow({ ...options, record: async command => {
      calls.push(command);
      if (command.name === "window-source-build") {
        mkdirSync(join(home, "dist/assets"), { recursive: true });
        writeFileSync(join(home, "dist/index.html"), '<script src="/assets/fixture.js"></script>');
        writeFileSync(join(home, "dist/assets/fixture.js"), "synthetic build output");
      }
    } });
    assert.deepEqual(calls.map(c => c.name), ["window-source-build", "window-readiness"]);
    assert.deepEqual(calls[0].argv, ["/synthetic/pnpm.cjs", "build"]);
    assert.equal(calls[1].env.NODE_OPTIONS, undefined);
    assert.equal(JSON.parse(readFileSync(join(reports, "window-build.json"))).packaging, false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
function health() { return { app: "entropybot", pid: 1234, static: true, capabilities: { guardedMessages: 1, guardedRequests: 1, guardedFullAccess: 1, guardedOnBehalfOf: 1 } }; }
test("public health probe exercises identity polling and expected fixed URL/status/pid/static/capabilities", async () => {
  const calls = [];
  const result = await requireWindowHealth({ pid: 1234, fetchImpl: async url => { calls.push(url); return Response.json(health()); } });
  assert.deepEqual(calls, [`${WINDOW_ORIGIN}/api/health`, `${WINDOW_ORIGIN}/api/health`]);
  assert.equal(result.status, 200); assert.equal(result.pid, 1234);
  for (const mutate of [h => { h.app = "foreign"; }, h => { h.pid++; }, h => { h.static = false; }, h => { delete h.capabilities; }, h => { h.capabilities.guardedRequests = 0; }]) {
    const body = health(); mutate(body);
    await assert.rejects(requireWindowHealth({ pid: 1234, fetchImpl: async () => Response.json(body) }));
  }
  await assert.rejects(requireWindowHealth({ pid: 1234, fetchImpl: async () => Response.json(health(), { status: 201 }) }), /payload/);
  let now = 0;
  await assert.rejects(requireWindowHealth({ pid: 1234, fetchImpl: async () => { throw new Error("wrong port"); }, now: () => now, sleep: async ms => { now += ms; } }), /identity/);
});
function fakeWindow(preload = "/owned/electron/preload.cjs") {
  const win = new EventEmitter(); win.webContents = new EventEmitter();
  win.webContents.getLastWebPreferences = () => ({ preload });
  return win;
}
test("real observer requires main-window ready-to-show AND did-finish-load before frame check", async () => {
  for (const order of [["ready", "load"], ["load", "ready"]]) {
    const app = new EventEmitter(); let checked = 0;
    const observed = observeApplicationWindow(app, { timeoutMs: 100, onWindow: async () => { checked++; return { pixels: "checked" }; } });
    const splash = fakeWindow("/owned/startup-preload.cjs");
    app.emit("browser-window-created", {}, splash); splash.emit("ready-to-show"); splash.webContents.emit("did-finish-load");
    const win = fakeWindow(); app.emit("browser-window-created", {}, win);
    const emit = event => event === "ready" ? win.emit("ready-to-show") : win.webContents.emit("did-finish-load");
    emit(order[0]); await Promise.resolve(); assert.equal(checked, 0);
    emit(order[1]); const result = await observed;
    assert.equal(checked, 1); assert.equal(result.readyToShow, true); assert.equal(result.didFinishLoad, true);
    assert.equal(app.listenerCount("browser-window-created"), 0);
  }
});
for (const missing of ["ready", "load", "window"]) test(`public observer rejects missing ${missing} within bound`, async () => {
  const app = new EventEmitter(); let checked = false;
  const observed = observeApplicationWindow(app, { timeoutMs: 10, onWindow: () => { checked = true; } });
  const win = fakeWindow();
  if (missing !== "window") app.emit("browser-window-created", {}, win);
  if (missing !== "ready") win.emit("ready-to-show");
  if (missing !== "load") win.webContents.emit("did-finish-load");
  await assert.rejects(observed, /never became ready/); assert.equal(checked, false);
  win.emit("ready-to-show"); win.webContents.emit("did-finish-load");
  await Promise.resolve(); assert.equal(checked, false);
});
test("public observer propagates frame failure and renderer crash", async () => {
  const app = new EventEmitter();
  const observed = observeApplicationWindow(app, { timeoutMs: 100, onWindow: () => { throw new Error("blank frame"); } });
  const win = fakeWindow(); app.emit("browser-window-created", {}, win); win.emit("ready-to-show"); win.webContents.emit("did-finish-load");
  await assert.rejects(observed, /blank frame/);
  const crashed = observeApplicationWindow(app, { timeoutMs: 100, onWindow: () => ({}) });
  const other = fakeWindow(); app.emit("browser-window-created", {}, other); other.webContents.emit("render-process-gone");
  await assert.rejects(crashed, /renderer exited/);
});
test("L19: nonempty PNG of a blank text region fails; actual pixel variation passes", () => {
  const blank = encodePng(80, 20, () => [240, 240, 240]);
  assert.ok(blank.length > 0); assert.throws(() => requireDrawnRegion(blank), /no drawn/);
  const drawn = encodePng(80, 20, (x, y) => y > 4 && y < 15 && x % 8 < 3 ? [20 + x, 20 + x, 20 + x] : [240, 240, 240]);
  assert.ok(requireDrawnRegion(drawn).nonDominantPixels >= 16);
  assert.throws(() => requireDrawnRegion(encodePng(4, 4, () => [0, 0, 0])), /dimensions/);
});
