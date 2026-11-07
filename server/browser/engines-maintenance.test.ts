import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ChromeEngine } from "./engines.ts";
import { ProcessRegistry } from "./chrome/processes.ts";
import { browserRoot, profileDir } from "./chrome/profile.ts";

vi.mock("./chrome/processes.ts", async (original) => {
  const actual = await original<typeof import("./chrome/processes.ts")>();
  return { ...actual, sweep: vi.fn((options: Parameters<typeof actual.sweep>[0]) => actual.sweep({ ...options,
    list: async () => [], alive: pid => pid === process.pid, kill: async () => { throw new Error("synthetic process list is empty"); },
  })) };
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("does not call an inaccessible registry an unused successful erase", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-engine-inaccessible-"));
  const log = vi.fn();
  vi.spyOn(ProcessRegistry.prototype, "list").mockImplementationOnce(() => { throw Object.assign(new Error("synthetic inaccessible registry"), { code: "EACCES" }); });
  const engine = new ChromeEngine({ dataDir, home: dataDir, env: {}, host: "desktop", egressPort: async () => 0, idleMs: () => 60_000, egressNotice: () => null, log });
  try {
    expect(await engine.erase({ kind: "bot", id: "not-visible", partitionId: "" })).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("synthetic inaccessible registry"));
    expect(existsSync(browserRoot(dataDir))).toBe(false);
  } finally { await engine.close(); }
});

it.each(["read-error", "active-read-error", "broken-json", "wrong-shape", "invalid-row"] as const)("retains resources through actual timer ticks during %s and resumes maintenance after recovery", async (mode) => {
  vi.useFakeTimers();
  const dataDir = mkdtempSync(join(tmpdir(), "omb-engine-maintenance-"));
  const root = browserRoot(dataDir);
  const temporary = profileDir(dataDir, "temp:maintenance");
  const persistent = profileDir(dataDir, "bot:erase-target");
  mkdirSync(temporary, { recursive: true });
  mkdirSync(persistent, { recursive: true });
  writeFileSync(join(temporary, "retain-marker"), "synthetic");
  const registry = new ProcessRegistry(root);
  const bad = mode === "broken-json" ? "{" : mode === "wrong-shape" ? "{}" : mode === "invalid-row" ? "[{}]" : "[]";
  writeFileSync(registry.file, bad);
  let fault = mode === "read-error" || mode === "active-read-error";
  const original = ProcessRegistry.prototype.list;
  vi.spyOn(ProcessRegistry.prototype, "list").mockImplementation(function (this: ProcessRegistry) {
    if (fault && this.file === registry.file) throw Object.assign(new Error("synthetic registry read refusal"), { code: "EACCES" });
    return original.call(this);
  });
  const log = vi.fn();
  const engine = new ChromeEngine({ dataDir, home: dataDir, env: {}, host: "desktop", egressPort: async () => 0, idleMs: () => 60_000, egressNotice: () => null, log });
  try {
    engine.start({ inUse: mode === "active-read-error", prepare: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(existsSync(join(temporary, "retain-marker"))).toBe(true);
    expect(await engine.erase({ kind: "bot", id: "erase-target", partitionId: "" })).toBe(false);
    expect(existsSync(persistent)).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    const warnings = log.mock.calls.length;
    expect(warnings).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(log.mock.calls).toHaveLength(warnings);
    expect(readFileSync(registry.file, "utf8")).toBe(bad);
    expect(existsSync(join(temporary, "retain-marker"))).toBe(true);
    fault = false;
    writeFileSync(registry.file, "[]");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(existsSync(temporary)).toBe(false);
    expect(log.mock.calls.some(([message]) => /recovered/.test(String(message)))).toBe(true);
    expect(await engine.erase({ kind: "bot", id: "erase-target", partitionId: "" })).toBe(true);
    expect(existsSync(persistent)).toBe(false);
    const afterRecovery = log.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(log.mock.calls).toHaveLength(afterRecovery);
    console.info(JSON.stringify({ maintenanceCase: mode, dataDir, warnings, recovered: true }));
  } finally { await engine.close(); }
});
