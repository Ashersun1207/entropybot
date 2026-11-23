import assert from "node:assert/strict";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { MAIN_WINDOW_DIAGNOSTIC_EVENT } from "../../electron/diagnostics.mjs";

export function windowPaths(home) {
  const appData = join(home, "window-app-data");
  return { home, appData, userData: join(appData, "openmausbot"), sessionData: join(home, "window-session"),
    logs: join(home, "window-logs"), temp: join(home, "tmp"), crashDumps: join(home, "window-crashes") };
}
export function assertWindowPaths(app, home) {
  assert.equal(realpathSync(home), home, "window HOME must be canonical");
  assert.equal(lstatSync(home).uid, process.getuid(), "window HOME must be owned");
  const expected = windowPaths(home);
  const effective = Object.fromEntries(Object.keys(expected).map(name => [name, app.getPath(name)]));
  assert.deepEqual(effective, expected, "effective Electron paths escaped the owned HOME");
  for (const path of Object.values(effective)) {
    const stat = lstatSync(path);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid(), "window path must be an owned directory");
    assert.equal(realpathSync(path), path, "window path must be canonical");
  }
  return effective;
}
export function configureWindowPaths(app, home) {
  assert.equal(app.isPackaged, false, "window diagnostic requires the source application");
  assert.equal(realpathSync(home), home, "window HOME must be canonical");
  assert.equal(lstatSync(home).uid, process.getuid(), "window HOME must be owned");
  for (const [name, path] of Object.entries(windowPaths(home))) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    assert.equal(realpathSync(path), path, "window path must be canonical");
    app.setPath(name, path);
  }
  return assertWindowPaths(app, home);
}

export const WINDOW_TIMEOUT_MS = 90000;

export const TEXT_REGION_SCRIPT = `(async () => {
  const deadline = Date.now() + 20000;
  while (!document.querySelector('[data-sidebar-bot-row], [data-sidebar-hero]')) {
    if (Date.now() >= deadline) throw new Error('application sidebar never mounted');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await Promise.all([...document.images].map(image => image.complete ? null : new Promise(resolve => { image.onload = image.onerror = resolve; })));
  if (!window.ogb?.getCapabilities) throw new Error('desktop preload missing');
  const capabilities = await window.ogb.getCapabilities();
  const walker = document.createTreeWalker(document.getElementById('root'), NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    if (node.textContent.trim().length < 4 || node.parentElement.closest('script,style')) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const r = range.getBoundingClientRect(); const style = getComputedStyle(node.parentElement);
    if (r.x < 0 || r.y < 0 || r.right > innerWidth || r.bottom > innerHeight || r.width < 24 || r.width > 300 || r.height < 8 || r.height > 60 || style.visibility !== 'visible' || Number(style.opacity) === 0) continue;
    return { location: location.href, bridge: typeof window.ogb.getCapabilities, platform: capabilities.host?.platform,
      region: { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) } };
  }
  throw new Error('no bounded visible app text region');
})()`;

export function observeApplicationWindow(app, { onWindow, timeoutMs = WINDOW_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    let windowsCreated = 0;
    let selected = false, ready = false, loaded = false, checking = false, settled = false;
    const timer = setTimeout(() => {
      const stages = [
        `windowsCreated=${windowsCreated}`,
        `mainWindowSelected=${selected}`,
        `readyToShow=${ready}`,
        `didFinishLoad=${loaded}`,
        `frameCheckStarted=${checking}`,
      ];
      finish(new Error(`application window never became ready (${stages.join(" ")})`));
    }, timeoutMs);
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      app.removeListener("browser-window-created", countWindow);
      app.removeListener(MAIN_WINDOW_DIAGNOSTIC_EVENT, selectMainWindow);
      if (error) reject(error); else resolve(value);
    }
    function countWindow() { windowsCreated++; }
    function selectMainWindow(win) {
      if (selected) return;
      selected = true;
      const check = () => {
        if (settled || !ready || !loaded || checking) return;
        checking = true;
        Promise.resolve().then(() => onWindow(win)).then(value => finish(null, { readyToShow: ready, didFinishLoad: loaded, ...value }), error => finish(error));
      };
      win.once("ready-to-show", () => { ready = true; check(); });
      win.webContents.once("did-finish-load", () => { loaded = true; check(); });
      win.webContents.once("render-process-gone", () => finish(new Error("application renderer exited")));
      win.webContents.on("did-fail-load", (_event, code, _description, _url, main) => {
        if (main && code !== -3) finish(new Error("application main frame failed to load"));
      });
    }
    app.on("browser-window-created", countWindow);
    app.on(MAIN_WINDOW_DIAGNOSTIC_EVENT, selectMainWindow);
  });
}
