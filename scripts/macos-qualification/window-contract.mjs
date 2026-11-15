import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pollServerIdentity } from "../../electron/server-boot-probe.mjs";
import { decodePng } from "../testing/png.ts";
import { requireValue } from "./contract.mjs";

export const WINDOW_PORT = 8799;
export const WINDOW_ORIGIN = `http://127.0.0.1:${WINDOW_PORT}`;

export function windowCommands(root, pnpm, home, capabilityArgs) {
  return {
    build: [process.execPath, pnpm, "build"],
    worker: [process.execPath, ...capabilityArgs, join(root, "scripts/macos-qualification/window.mjs"), "--worker"],
    electron: [join(root, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
      `--user-data-dir=${join(home, "window-profile")}`, "--use-mock-keychain", join(root, "scripts/macos-qualification/window-entry.mjs")],
  };
}
export function requireWindowDist(root) {
  const dist = join(root, "dist");
  requireValue(existsSync(join(dist, "index.html")), "window qualification requires CI-built dist/index.html");
  requireValue(realpathSync(dist) === dist, "window dist must be owned build output, not an external asset link");
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const entry = /<script[^>]+src="(\/assets\/[^"/]+\.js)"/.exec(html)?.[1];
  requireValue(entry && existsSync(join(dist, entry)), "window dist lacks built UI entry");
  return dist;
}
export async function requireWindowHealth({ pid, fetchImpl = globalThis.fetch, ...options }) {
  const identity = await pollServerIdentity({ port: WINDOW_PORT, pid: () => pid, bootTimeoutMs: 5000, fetchImpl, ...options });
  requireValue(identity.outcome === "ready", "window server identity not ready");
  const response = await fetchImpl(`${WINDOW_ORIGIN}/api/health`, { signal: AbortSignal.timeout(5000), redirect: "error" });
  const health = await response.json();
  requireValue(response.status === 200 && health.app === "entropybot" && health.pid === pid && health.static === true, "window health payload mismatch");
  const keys = ["guardedMessages", "guardedRequests", "guardedFullAccess", "guardedOnBehalfOf"];
  requireValue(keys.every(key => health.capabilities?.[key] === 1), "window server capabilities missing");
  return { status: response.status, app: health.app, pid: health.pid, static: health.static,
    capabilities: Object.fromEntries(keys.map(key => [key, health.capabilities[key]])) };
}
export function requireDrawnRegion(png) {
  requireValue(png.length <= 2 * 1024 * 1024, "window region byte bound");
  const image = decodePng(png);
  requireValue(image.width >= 20 && image.width <= 1200 && image.height >= 8 && image.height <= 240, "window region dimensions");
  const histogram = new Map();
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const rgb = image.pixel(x, y);
    const key = rgb.map(value => value >> 4).join(",");
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  const background = Math.max(...histogram.values());
  const varied = image.width * image.height - background;
  requireValue(histogram.size >= 3 && varied >= 16, "text region has no drawn pixel evidence");
  return { width: image.width, height: image.height, colourBuckets: histogram.size, nonDominantPixels: varied,
    scope: "bounded text-region pixel presence only; not visual correctness or interaction acceptance" };
}
