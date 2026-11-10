import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserProcessesRunning, stopBrowserProcesses } from "./browser-processes.ts";

vi.mock("node:child_process", async (original) => ({ ...await original<typeof import("node:child_process")>(), execFile: vi.fn() }));
const platform = process.platform;
const started = "Tue Nov 10 10:00:00 2026";
const tree = { daemon: 43210, members: new Map([[43210, started]]), groups: [43210] };
let listing: string | null;
let delay: number;
let commandKills: string[];
let signals: Array<[number, string | number | undefined]>;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  listing = `43210 1 43210 S ${started}\n`;
  delay = 0; commandKills = []; signals = [];
  vi.spyOn(process, "kill").mockImplementation((pid, signal) => { signals.push([pid, signal]); return true; });
  vi.mocked(execFile).mockClear();
  vi.mocked(execFile).mockImplementation(((_file: string, _args: string[], _options: unknown, done: (error: Error | null, stdout: string) => void) => {
    const child = Object.assign(new EventEmitter(), { kill: (signal: string) => { commandKills.push(signal); return true; } });
    if (delay >= 0) setTimeout(() => done(listing === null ? new Error("synthetic table failure") : null, listing ?? ""), delay);
    return child;
  }) as unknown as typeof execFile);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); Object.defineProperty(process, "platform", { value: platform, configurable: true }); });
it("does not signal after an expired deadline", async () => {
  expect(await stopBrowserProcesses(tree, 1_500, { deadline: 10_000 })).toBe(false);
  expect(execFile).not.toHaveBeenCalled();
  expect(signals).toEqual([]);
});
it("does not signal unvalidated snapshot pids on process-table failure", async () => {
  listing = null;
  const result = stopBrowserProcesses(tree, 1_500, { deadline: 11_000 });
  await vi.advanceTimersByTimeAsync(0);
  expect(await result).toBe(false);
  expect(signals).toEqual([]);
  const running = browserProcessesRunning(tree, 11_000);
  await vi.advanceTimersByTimeAsync(0);
  expect(await running).toBe(true);
});
it("bounds a hung ps command and kills only that owned command", async () => {
  delay = -1;
  const result = stopBrowserProcesses(tree, 1_500, { deadline: 10_101 });
  await vi.advanceTimersByTimeAsync(101);
  expect(await result).toBe(false);
  expect(commandKills).toEqual(["SIGKILL"]);
  expect(signals).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});
it("keeps unknown when a validated tree survives TERM and KILL until expiry", async () => {
  const result = stopBrowserProcesses(tree, 1_500, { deadline: 11_000 });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await result).toBe(false);
  expect(signals).toContainEqual([43210, "SIGTERM"]);
  expect(signals).toContainEqual([-43210, "SIGKILL"]);
  const count = signals.length;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(signals).toHaveLength(count);
  expect(vi.getTimerCount()).toBe(0);
});
it("does not KILL after the caller's session identity changes during TERM grace", async () => {
  let current = true;
  const result = stopBrowserProcesses(tree, 1_500, { deadline: 11_000, isCurrent: () => current });
  await vi.advanceTimersByTimeAsync(1);
  current = false;
  await vi.advanceTimersByTimeAsync(1_000);
  expect(await result).toBe(false);
  expect(signals.filter(([, signal]) => signal === "SIGKILL")).toEqual([]);
});
it("leaves a reused pid untouched and confirms only the captured tree is gone", async () => {
  listing = "43210 1 43210 S Tue Nov 10 11:00:00 2026\n";
  const result = stopBrowserProcesses(tree, 1_500, { deadline: 11_000 });
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBe(true);
  expect(signals).toEqual([]);
});
it("root gone does not confirm while a group helper survives", async () => {
  listing = `43211 1 43210 S ${started}\n`;
  const result = stopBrowserProcesses(tree, 1_500, { deadline: 10_200 });
  await vi.advanceTimersByTimeAsync(200);
  expect(await result).toBe(false);
  expect(signals).toContainEqual([-43210, "SIGKILL"]);
});
it("clamps fractional near deadlines to a supported integer command timeout", async () => {
  const result = stopBrowserProcesses(tree, 1_500, { deadline: 10_100.5 });
  await vi.advanceTimersByTimeAsync(101);
  expect(await result).toBe(false);
  for (const call of vi.mocked(execFile).mock.calls) {
    const options = call[2] as { timeout: number; killSignal: string };
    expect(Number.isInteger(options.timeout)).toBe(true);
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThanOrEqual(100);
    expect(options.killSignal).toBe("SIGKILL");
  }
});
