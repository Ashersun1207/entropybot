import { app } from "electron";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { installDesktopCrashListeners } from "../../electron/diagnostics.mjs";
import { recordWindowFailure, recordWindowCrash } from "./failure-diagnostics.mjs";
import { observeApplicationWindow, TEXT_REGION_SCRIPT, configureWindowPaths, assertWindowPaths } from "./window-observer.mjs";

const root = resolve(import.meta.dirname, "../..");
const home = process.env.HOME;
installDesktopCrashListeners({ appTarget: app, processTarget: process, record: event => recordWindowCrash(home, event) });
try {
  app.setAppPath(root);
  const pathsBeforeImport = configureWindowPaths(app, home);
  process.env.OMB_MACOS_WINDOW_DIAGNOSTIC = "1";
  const watchdog = setTimeout(() => {
    recordWindowFailure(home, "watchdog", new Error("window diagnostic watchdog expired"));
    app.exit(1);
  }, 110000);
  const observed = observeApplicationWindow(app, {
    onWindow: async win => {
      const effectivePaths = assertWindowPaths(app, home);
      if (process.env.OMB_MACOS_WINDOW_DIAGNOSTIC !== "1" || app.isPackaged) throw new Error("window updater isolation missing");
      win.show();
      const frame = await win.webContents.executeJavaScript(TEXT_REGION_SCRIPT);
      if (frame.location !== "http://127.0.0.1:8799/" || frame.platform !== "darwin" || frame.bridge !== "function") throw new Error("unexpected app renderer or desktop bridge");
      const image = await win.webContents.capturePage(frame.region);
      const png = image.toPNG();
      if (image.isEmpty() || png.length > 2 * 1024 * 1024) throw new Error("missing/oversized app region");
      writeFileSync(join(home, "window-region.png"), png, { flag: "wx", mode: 0o600 });
      return { ...frame, pathsBeforeImport, effectivePaths, updaterNetworkDisabled: true };
    },
  });
  observed.then(result => {
    writeFileSync(join(home, "window-observation.json"), JSON.stringify(result), { flag: "wx", mode: 0o600 });
    app.quit();
  }, error => {
    recordWindowFailure(home, "window-observation", error);
    app.exit(1);
  });
  app.once("will-quit", () => clearTimeout(watchdog));
  await import("../../electron/main.mjs");
  assertWindowPaths(app, home);
} catch (error) {
  recordWindowFailure(home, "entry", error);
  app.exit(1);
}
