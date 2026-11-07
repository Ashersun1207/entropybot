import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { BrowserService } from "./service.ts";
import { ChromeEngine } from "./engines.ts";
import { FakeBackend, FAKE_IDENTITY } from "./testing/fake-chrome.ts";
import { LocalBackend } from "./backends.ts";
import { ChromeCleanupError } from "./chrome/cleanup.ts";
import { profileDir } from "./chrome/profile.ts";
import { ProcessRegistry, sweep } from "./chrome/processes.ts";

it.each(["temp:close-test", "bot:erase-test"])("retains %s after an unconfirmed close through the service owner", async (key) => {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-close-owner-"));
  const backend = new FakeBackend();
  const open = backend.open.bind(backend);
  let release = false;
  backend.open = async (request) => {
    const opened = await open(request);
    const close = opened.close.bind(opened);
    return { ...opened, close: async () => { if (!release) throw new Error("synthetic unconfirmed close"); await close(); } };
  };
  const service = new BrowserService({ dataDir, backend: () => backend, maxRunning: 2, idleMs: () => 60_000 });
  const target = { key, session: key };
  const profile = service.profile(target);
  await service.running(profile);
  const directory = profileDir(dataDir, key);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "retain-marker"), "synthetic");
  const tabs = profile.tabs.list().length;
  const action = () => key.startsWith("temp:") ? service.close(target.session) : service.erase(key);
  await expect(action()).rejects.toThrow("synthetic unconfirmed close");
  expect(existsSync(join(directory, "retain-marker"))).toBe(true);
  expect(service.profiles()).toContain(profile);
  expect(profile.control.closing).toBe(true);
  await expect(service.running(profile)).rejects.toThrow("synthetic unconfirmed close");
  expect(backend.opened).toHaveLength(1);
  expect(profile.tabs.list()).toHaveLength(tabs);
  if (key.startsWith("bot:")) {
    const engine = new ChromeEngine({ dataDir, host: "desktop", env: {}, home: dataDir, egressPort: async () => 0, idleMs: () => 60_000, egressNotice: () => null });
    Object.defineProperty(engine, "service", { value: service });
    expect(await engine.erase({ kind: "bot", id: "erase-test", partitionId: "" })).toBe(false);
    expect(existsSync(join(directory, "retain-marker"))).toBe(true);
  }
  release = true;
  await action();
  expect(existsSync(directory)).toBe(false);
});

it("retains an initializing browser when both initialization and its cleanup fail", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-close-initialization-"));
  const backend = new FakeBackend();
  const open = backend.open.bind(backend);
  backend.open = async (request) => {
    const opened = await open(request);
    vi.spyOn(opened.browser, "waitForPage").mockRejectedValue(new Error("synthetic initialization failure"));
    return { ...opened, close: async () => { throw new Error("synthetic unconfirmed initialization close"); } };
  };
  const service = new BrowserService({ dataDir, backend: () => backend, maxRunning: 2, idleMs: () => 60_000 });
  const profile = service.profile({ key: "temp:initialization", session: "initialization" });
  await expect(service.running(profile)).rejects.toThrow();
  const directory = profileDir(dataDir, profile.key);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "retain-marker"), "synthetic");
  await expect(service.close(profile.session)).rejects.toThrow("synthetic unconfirmed initialization close");
  expect(existsSync(directory)).toBe(true);
});

it("retains a LocalBackend launch reservation until structured cleanup retry confirms closure", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-close-reservation-"));
  const root = join(dataDir, "browser"), key = "temp:reservation";
  const registry = new ProcessRegistry(root);
  const backend = new LocalBackend({ dataDir, home: dataDir, host: "desktop", registry,
    binary: async () => ({ path: "never-executed", identity: FAKE_IDENTITY }), screen: async () => ({ width: 1280, height: 800, deviceScaleFactor: 1 }),
    egressPort: async () => null, launch: async options => { throw new ChromeCleanupError("synthetic launch unknown", { status: "unknown", userDataDir: options.userDataDir }, undefined, async () => {}); } });
  const error = await backend.open({ key, mode: "headless", fresh: false, viewport: { width: 800, height: 600 }, downloadDir: join(dataDir, "downloads") }).catch(value => value);
  const dir = profileDir(dataDir, key);
  expect(error).toMatchObject({ cleanup: { status: "unknown" } });
  expect(registry.reserved(dir)).toBe(true);
  await sweep({ root, registry, list: async () => [], alive: () => false });
  expect(existsSync(dir)).toBe(true);
  await error.retryCleanup();
  expect(registry.reserved(dir)).toBe(false);
  await sweep({ root, registry, list: async () => [], alive: () => false });
  expect(existsSync(dir)).toBe(false);
});

it("refuses erase without a live service entry while registry ownership remains unconfirmed", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-close-unowned-"));
  const root = join(dataDir, "browser"), key = "bot:retained";
  const dir = profileDir(dataDir, key);
  mkdirSync(dir, { recursive: true });
  const registry = new ProcessRegistry(root);
  registry.add({ pid: 32100, startTime: null, userDataDir: dir, ownerPid: process.pid, launchedAt: "" });
  const service = new BrowserService({ dataDir, backend: () => new FakeBackend(), maxRunning: 2, idleMs: () => 60_000 });
  await expect(service.erase(key)).rejects.toMatchObject({ cleanup: { status: "unknown" } });
  expect(existsSync(dir)).toBe(true);
  registry.remove(32100);
  await service.erase(key);
  expect(existsSync(dir)).toBe(false);
});

it("does not treat a dead owner's unsuccessfully stopped root as recovered", async () => {
  const root = mkdtempSync(join(tmpdir(), "omb-close-dead-owner-"));
  const directory = join(root, "temp", "profile");
  mkdirSync(directory, { recursive: true });
  const registry = new ProcessRegistry(root);
  registry.add({ pid: 32100, startTime: null, ownerPid: 32200, userDataDir: directory, launchedAt: "" });
  let rootAlive = true;
  const run = () => sweep({ root, registry, list: async () => rootAlive ? [{ pid: 32100, ppid: 1, startTime: null, args: `chrome --user-data-dir=${directory} about:blank` }] : [],
    alive: pid => rootAlive && pid === 32100, kill: async () => {} });
  expect((await run()).temporaryRemoved).toEqual([]);
  expect(registry.list()).toHaveLength(1);
  expect(existsSync(directory)).toBe(true);
  rootAlive = false;
  await run();
  expect(registry.list()).toEqual([]);
  expect(existsSync(directory)).toBe(false);
});

it("keeps a live owner's exit-before-close profile across sweeps but recovers a dead owner's orphan", async () => {
  const root = mkdtempSync(join(tmpdir(), "omb-close-sweep-"));
  const directory = join(root, "temp", "profile");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "marker"), "synthetic");
  const registry = new ProcessRegistry(root);
  registry.add({ pid: 32100, startTime: null, ownerPid: 32200, userDataDir: directory, launchedAt: "" });
  const kill = vi.fn(async () => { throw new Error("no process was listed"); });
  const run = (ownerAlive: boolean) => sweep({ root, registry, list: async () => [], alive: pid => ownerAlive && pid === 32200, kill });
  await run(true);
  await run(true);
  expect(registry.list()).toHaveLength(1);
  expect(existsSync(directory)).toBe(true);
  await run(false);
  expect(registry.list()).toEqual([]);
  expect(existsSync(directory)).toBe(false);
  expect(kill).not.toHaveBeenCalled();
});
