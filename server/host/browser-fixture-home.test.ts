import { expect, it, vi, afterEach } from "vitest";
import type { ChromeLauncherOptions } from "../browser/chrome/launcher.ts";
import type { LocalBackendOptions } from "../browser/backends.ts";
import type { ChromeEngineOptions } from "../browser/engines.ts";
import type { BrowserHostDeps } from "./browser.ts";

const captured = vi.hoisted(() => ({ engines: [] as ChromeEngineOptions[], launchers: [] as ChromeLauncherOptions[], backends: [] as LocalBackendOptions[] }));
vi.mock("../browser/engines.ts", async original => {
  const actual = await original<typeof import("../browser/engines.ts")>();
  return { ...actual, ChromeEngine: class extends actual.ChromeEngine {
    constructor(options: ChromeEngineOptions) { captured.engines.push(options); super(options); }
  } };
});
vi.mock("../browser/chrome/launcher.ts", async original => {
  const actual = await original<typeof import("../browser/chrome/launcher.ts")>();
  return { ...actual, ChromeLauncher: class extends actual.ChromeLauncher {
    constructor(options: ChromeLauncherOptions) { captured.launchers.push(options); super(options); }
  } };
});
vi.mock("../browser/backends.ts", async original => {
  const actual = await original<typeof import("../browser/backends.ts")>();
  return { ...actual, LocalBackend: class extends actual.LocalBackend {
    constructor(options: LocalBackendOptions) { captured.backends.push(options); super(options); }
  } };
});
const { createBrowserHost } = await import("./browser.ts");
afterEach(() => { vi.unstubAllEnvs(); captured.engines = []; captured.launchers = []; captured.backends = []; });

it.each([undefined, "/owned-fixture-home"])("passes the fixture override %s from the server host through ChromeEngine to launcher and LocalBackend", async home => {
  vi.stubEnv("OMB_TEST_BROWSER_HOME", home);
  const host = createBrowserHost({
    cfg: { features: { browser: true } }, store: () => ({ bots: [], bot: () => null, botByThread: () => null }),
    turnResources: { free: () => true, holder: () => undefined, onClaim: () => () => {} },
    activeInternalGenerationByThread: new Map(), mintInternalCapability: () => "fixture-only",
    DESKTOP_MANAGED: false, CLOUD_HOME: null, PORT: 19000,
  } as BrowserHostDeps);
  try {
    expect(captured.engines).toHaveLength(1);
    expect(captured.launchers).toHaveLength(1);
    expect(captured.backends).toHaveLength(1);
    expect(captured.engines[0]!.home).toBe(home);
    expect(captured.launchers[0]!.home).toBe(home);
    expect(captured.backends[0]!.home).toBe(home);
  } finally { await host.browserRuntime.closeAll(); }
});
