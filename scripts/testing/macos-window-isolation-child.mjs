import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { mock } from "node:test";
import { createHash } from "node:crypto";
import { WINDOW_TIMEOUT_MS } from "../macos-qualification/window-observer.mjs";

const [home, mode] = process.argv.slice(2);
const entry = new URL("../macos-qualification/window-entry.mjs", import.meta.url).href;
const main = new URL("../../electron/main.mjs", import.meta.url).href;
const updaterURL = new URL("../../electron/updater.mjs", import.meta.url).href;
const app = new EventEmitter();
const paths = new Map();
const assignments = [];
app.isPackaged = mode === "updater-packaged";
app.setAppPath = () => {};
app.setPath = (name, path) => { paths.set(name, path); assignments.push({ name, path }); };
app.getPath = name => paths.get(name) ?? `/synthetic-external/${name}`;
app.getVersion = () => "0.2.6";
let exitCode;
let finished;
const completion = new Promise(resolve => { finished = resolve; });
app.quit = () => { exitCode = 0; app.emit("will-quit"); finished(); };
app.exit = code => { exitCode = code; app.emit("will-quit"); finished(); };
const handlers = new Map();
globalThis.__windowIsolation = { app, ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, shell: { openExternal: () => assert.fail("unexpected external link") } };
const electron = `const f=globalThis.__windowIsolation; export const app=f.app, ipcMain=f.ipcMain, shell=f.shell, clipboard={}, net={fetch: (...args) => fetch(...args)};`;
let override;
const loader = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron") return { url: "data:text/javascript," + encodeURIComponent(electron), shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url !== main) return next(url, context);
    const original = readFileSync(new URL(url), "utf8");
    const matches = original.split("\n").filter(line => line.startsWith('app.setPath("userData",'));
    assert.equal(matches.length, 1, "real main profile override must be unambiguous");
    override = { sourceSha256: createHash("sha256").update(original).digest("hex"), statement: matches[0] };
    const notify = original.split("\n").filter(line => line.trim() === "notifyMainWindowDiagnostic(app, win);");
    assert.equal(notify.length, 1, "real main window diagnostic call must be unambiguous");
    const diagnostics = new URL("../../electron/diagnostics.mjs", import.meta.url).href;
    return { format: "module", shortCircuit: true, source: `import {app} from "electron"; import path from "node:path";
import { notifyMainWindowDiagnostic } from ${JSON.stringify(diagnostics)};
${matches[0]}
globalThis.__windowIsolation.mainOverrideApplied(win => { ${notify[0]} });` };
  },
});
try {
  if (mode.startsWith("updater-")) {
    if (mode !== "updater-normal") process.env.OMB_MACOS_WINDOW_DIAGNOSTIC = "1";
    const calls = [];
    mock.method(globalThis, "fetch", async url => { calls.push(url); return { ok: true, json: async () => ({ tag_name: "entropybot-v0.2.6" }) }; });
    mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const updater = await import(updaterURL);
    updater.registerUpdaterIpc({ pageAllowed: () => true });
    updater.startUpdater();
    mock.timers.tick(15001);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const firstCheckCalls = calls.length;
    mock.timers.tick(3600001);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await handlers.get("update:check")({});
    console.log(JSON.stringify({ mode, firstCheckCalls, calls, state: handlers.get("update:get-state")({}) }));
    mock.timers.reset(); mock.restoreAll();
  } else {
    const timeoutMode = mode === "window-load-without-ready";
    if (timeoutMode) mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.__windowIsolation.mainOverrideApplied = notifyMainWindow => {
      if (mode === "escaped-profile") paths.set("userData", "/synthetic-external/openmausbot");
      if (mode === "escaped-session") paths.set("sessionData", "/synthetic-external/session");
      setImmediate(() => {
        const win = new EventEmitter();
        win.webContents = new EventEmitter();
        // Electron 43.7.9's SaveLastPreferences omits the separately stored preload path.
        win.webContents.getLastWebPreferences = () => ({ sandbox: true, contextIsolation: true });
        win.show = () => {};
        win.webContents.executeJavaScript = async () => ({ location: "http://127.0.0.1:8799/", platform: "darwin", bridge: "function", region: { x: 0, y: 0, width: 80, height: 20 } });
        win.webContents.capturePage = async () => ({ isEmpty: () => false, toPNG: () => Buffer.from("synthetic crop; no native drawing evidence") });
        app.emit("browser-window-created", {}, win);
        notifyMainWindow(win);
        win.webContents.emit("did-finish-load");
        if (timeoutMode) mock.timers.tick(WINDOW_TIMEOUT_MS);
        else win.emit("ready-to-show");
      });
    };
    try { await import(entry); }
    catch (error) {
      assert.match(String(error), /effective Electron paths escaped/);
      app.exit(1);
    }
    await completion;
    const report = join(home, "window-observation.json");
    console.log(JSON.stringify({ mode, exitCode, override, assignments, observation: existsSync(report) ? JSON.parse(readFileSync(report, "utf8")) : null }));
    process.exitCode = exitCode;
  }
} finally { loader.deregister(); }
