import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { removeTempDir } from "../testing/cleanup.ts";
import { LocalBackend, type LocalBackendOptions } from "./backends.ts";
import { ChromeCleanupError, chromeCleanupState } from "./chrome/cleanup.ts";
import type { ChromeProcess, LaunchOptions } from "./chrome/launch.ts";
import { ProcessRegistry, sweep } from "./chrome/processes.ts";
import { browserRoot, ensureProfile, profileDir, recordOpenedBy } from "./chrome/profile.ts";
import { FAKE_IDENTITY, FakeChrome } from "./testing/fake-chrome.ts";

const folders: string[] = [];
afterAll(async () => { for (const folder of folders) await removeTempDir(folder); });

/** A LocalBackend on a fake Chrome per start, each cancelling its first navigation as Chrome for Testing on Windows can. */
function backend(platform: NodeJS.Platform, tracked = false) {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-backends-test-"));
  folders.push(dataDir);
  const chromes: FakeChrome[] = [];
  const launches: LaunchOptions[] = [];
  const registry = new ProcessRegistry(browserRoot(dataDir));
  const local = new LocalBackend({
    dataDir, home: dataDir,
    host: "desktop",
    registry: tracked ? registry : undefined,
    platform,
    binary: async () => ({ path: "/fake/chrome", identity: { ...FAKE_IDENTITY } }),
    screen: async () => ({ width: 1920, height: 1080, deviceScaleFactor: 1 }),
    egressPort: async () => null,
    launch: async (options) => {
      launches.push(options);
      if (tracked) registry.add({ pid: 32100, ownerPid: process.pid, startTime: null, userDataDir: options.userDataDir, launchedAt: "" });
      const chrome = new FakeChrome({ navigationErrors: ["net::ERR_ABORTED"] });
      chromes.push(chrome);
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => chrome.onClose(() => resolve({ code: 0, signal: null })));
      const close = async () => { chrome.exit(); if (tracked) registry.remove(32100); return exited; };
      const launched: ChromeProcess = {
        pid: tracked ? 32100 : 1, argv: [], transport: chrome, version: { product: "Chrome/153.0.8010.12", userAgent: "", protocolVersion: "1.3", revision: "" },
        exited, output: () => "", close, kill: close,
      };
      return launched;
    },
  });
  const open = (key = "bot:warm") => local.open({ key, mode: "headless", fresh: false, viewport: { width: 1280, height: 800 }, downloadDir: join(dataDir, "downloads") });
  return { open, chromes, launches, dataDir, registry };
}

describe("a fresh profile's first navigation on Windows", () => {
  it("is taken by a page of our own in a tab of its own, so the bot's first page opens", async () => {
    const { open, chromes } = backend("win32");
    const opened = await open();
    const chrome = chromes[0]!;
    expect(chrome.sent.filter((sent) => sent.method === "Target.createTarget")).toHaveLength(1);
    expect(chrome.sent.filter((sent) => sent.method === "Target.closeTarget")).toHaveLength(1);
    const tabs = opened.browser.pages();
    expect(tabs).toHaveLength(1);
    expect(opened.browser.activePage).toBe(tabs[0]);
    await tabs[0]!.navigate("http://example.test/first");
    expect(tabs[0]!.url()).toBe("http://example.test/first");
    await opened.close();
  });

  it("is left to the bot on a profile that navigated before, and off Windows", async () => {
    const windows = backend("win32");
    await (await windows.open()).close();
    const again = await windows.open();
    expect(windows.chromes[1]!.sent.some((sent) => sent.method === "Target.createTarget" || sent.method === "Page.navigate")).toBe(false);
    await again.close();
    const mac = backend("darwin");
    const opened = await mac.open();
    expect(mac.chromes[0]!.sent.some((sent) => sent.method === "Target.createTarget" || sent.method === "Page.navigate")).toBe(false);
    await expect(opened.browser.pages()[0]!.navigate("http://example.test/first")).rejects.toThrow(/ERR_ABORTED/);
    await opened.close();
  });
});

describe("a local browser's profile folder", () => {
  it("passes its explicit synthetic home and private profile to the launch boundary", async () => {
    const { open, launches, dataDir } = backend("darwin");
    const opened = await open();
    try {
      expect(launches[0]?.home).toBe(dataDir);
      expect(launches[0]?.userDataDir).toBe(profileDir(dataDir, "bot:warm"));
    } finally { await opened.close(); }
  });
  it("is held while launching and releases only a structured confirmed-closed failure", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "omb-backends-test-"));
    folders.push(dataDir);
    const registry = new ProcessRegistry(browserRoot(dataDir));
    const dir = profileDir(dataDir, "temp:a");
    const held: boolean[] = [];
    const local = new LocalBackend({
      dataDir,
      host: "desktop",
      binary: async () => ({ path: "/fake/chrome", identity: { ...FAKE_IDENTITY } }),
      screen: async () => ({ width: 1920, height: 1080, deviceScaleFactor: 1 }),
      egressPort: async () => { held.push(registry.reserved(dir)); return null; },
      registry,
      launch: async () => { held.push(registry.reserved(dir)); throw new ChromeCleanupError("Chrome did not start", { status: "closed", userDataDir: dir }); },
    });
    await expect(local.open({ key: "temp:a", mode: "headless", fresh: false, viewport: { width: 1280, height: 800 }, downloadDir: join(dataDir, "downloads") })).rejects.toThrow("Chrome did not start");
    expect(held).toEqual([true, true]);
    expect(registry.reserved(dir)).toBe(false);
  });

  it.each(["binary", "profile", "downgrade", "egress", "screen", "timezone"] as const)("marks a %s failure before launch as closed and releases the reservation", async (stage) => {
    const dataDir = mkdtempSync(join(tmpdir(), "omb-before-launch-"));
    folders.push(dataDir);
    const registry = new ProcessRegistry(browserRoot(dataDir));
    const key = "temp:before-launch", dir = profileDir(dataDir, key);
    if (stage === "profile") { mkdirSync(dirname(dir), { recursive: true }); writeFileSync(dir, "synthetic profile blocker"); }
    if (stage === "downgrade") { ensureProfile(dataDir, key); recordOpenedBy(dir, "999.0.0.0"); }
    const fail = () => { throw new Error(`synthetic ${stage} refusal`); };
    const launch = vi.fn<NonNullable<LocalBackendOptions["launch"]>>(async () => { throw new Error("launch must not run"); });
    const local = new LocalBackend({ dataDir, home: dataDir, host: "desktop", registry, launch,
      binary: stage === "binary" ? async () => fail() : async () => ({ path: "/fake/chrome", identity: FAKE_IDENTITY }),
      screen: stage === "screen" ? async () => fail() : async () => ({ width: 1920, height: 1080, deviceScaleFactor: 1 }),
      egressPort: stage === "egress" ? async () => fail() : async () => null, timezone: stage === "timezone" ? fail : () => null,
    });
    const outcome = await local.open({ key, mode: "headless", fresh: false, viewport: { width: 800, height: 600 }, downloadDir: join(dataDir, "downloads") }).catch(error => error);
    expect(outcome).toBeInstanceOf(ChromeCleanupError);
    expect(outcome.cleanup).toEqual({ status: "closed", userDataDir: dir });
    expect(launch).not.toHaveBeenCalled();
    expect(registry.reserved(dir)).toBe(false);
  });

  it("keeps an unclassified error after launch invocation unknown and held during sweep", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "omb-after-launch-"));
    const registry = new ProcessRegistry(browserRoot(dataDir));
    const key = "temp:unknown", dir = profileDir(dataDir, key);
    const launch = vi.fn<NonNullable<LocalBackendOptions["launch"]>>(async () => { throw new Error("synthetic launch error without proof"); });
    const local = new LocalBackend({ dataDir, home: dataDir, host: "desktop", registry, launch,
      binary: async () => ({ path: "/fake/chrome", identity: FAKE_IDENTITY }), egressPort: async () => null,
      screen: async () => ({ width: 1920, height: 1080, deviceScaleFactor: 1 }),
    });
    const failure = await local.open({ key, mode: "headless", fresh: false, viewport: { width: 800, height: 600 }, downloadDir: join(dataDir, "downloads") }).catch(error => error);
    expect(chromeCleanupState(failure, dir).status).toBe("unknown");
    expect(launch).toHaveBeenCalledOnce();
    expect(registry.reserved(dir)).toBe(true);
    await sweep({ root: browserRoot(dataDir), registry, list: async () => [], alive: () => false });
    expect(existsSync(dir)).toBe(true);
    console.info(JSON.stringify({ retainedUnclassifiedLaunch: dataDir }));
  });

  it("releases a successful launch reservation while registered Chrome ownership still protects the profile", async () => {
    const f = backend("darwin", true);
    const key = "temp:tracked", dir = profileDir(f.dataDir, key);
    const opened = await f.open(key);
    expect(f.registry.reserved(dir)).toBe(false);
    expect(f.registry.list()).toHaveLength(1);
    const clean = () => sweep({ root: browserRoot(f.dataDir), registry: f.registry, list: async () => [], alive: pid => pid === process.pid });
    await clean();
    expect(existsSync(dir)).toBe(true);
    expect(f.registry.list()).toHaveLength(1);
    await opened.close();
    await clean();
    expect(existsSync(dir)).toBe(false);
    expect(f.registry.list()).toEqual([]);
  });
});
