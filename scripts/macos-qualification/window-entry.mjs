import { app } from "electron";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { observeApplicationWindow, TEXT_REGION_SCRIPT } from "./window-observer.mjs";

const root = resolve(import.meta.dirname, "../..");
const home = process.env.HOME;
app.setAppPath(root);
app.setPath("home", home);
app.setPath("userData", join(home, "window-profile"));
const watchdog = setTimeout(() => app.exit(1), 110000);
const observed = observeApplicationWindow(app, {
  onWindow: async win => {
    win.show();
    const frame = await win.webContents.executeJavaScript(TEXT_REGION_SCRIPT);
    if (frame.location !== "http://127.0.0.1:8799/" || frame.platform !== "darwin" || frame.bridge !== "function") throw new Error("unexpected app renderer or desktop bridge");
    const image = await win.webContents.capturePage(frame.region);
    const png = image.toPNG();
    if (image.isEmpty() || png.length > 2 * 1024 * 1024) throw new Error("missing/oversized app region");
    writeFileSync(join(home, "window-region.png"), png, { flag: "wx", mode: 0o600 });
    return frame;
  },
});
observed.then(result => {
  writeFileSync(join(home, "window-observation.json"), JSON.stringify(result), { flag: "wx", mode: 0o600 });
  app.quit();
}, () => app.exit(1));
app.once("will-quit", () => clearTimeout(watchdog));
await import("../../electron/main.mjs");
