import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserDaemonFile, closeBrowserSession } from "./browser-engine.ts";
import { browserProcessesRunning, browserProcessTree, stopBrowserProcesses } from "./browser-processes.ts";

vi.mock("node:child_process", async (original) => ({ ...await original<typeof import("node:child_process")>(), spawn: vi.fn() }));
vi.mock("./browser-processes.ts", async (original) => ({ ...await original<typeof import("./browser-processes.ts")>(), browserProcessTree: vi.fn(), browserProcessesRunning: vi.fn(async () => true), stopBrowserProcesses: vi.fn() }));
let home: string;
let env: NodeJS.ProcessEnv;
let closeChild: ReturnType<typeof spawn>;
let nativeCode: number | undefined;
const tree = { daemon: 43210, members: new Map([[43210, "owned"]]), groups: [43210] };
function child(args: readonly string[], sessions = ["work"]): ReturnType<typeof spawn> {
  const result = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: vi.fn(() => { setTimeout(() => result.emit("close", null), 0); return true; }) });
  queueMicrotask(() => {
    if (args[0] === "session") {
      result.stdout.emit("data", JSON.stringify({ success: true, data: { sessions } }));
      result.emit("close", 0);
    } else if (nativeCode !== undefined) result.emit("close", nativeCode);
  });
  if (args[0] === "close") closeChild = result as unknown as ReturnType<typeof spawn>;
  return result as unknown as ReturnType<typeof spawn>;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  home = mkdtempSync(join(tmpdir(), "omb-close-budget-"));
  env = { HOME: home, USERPROFILE: home, PATH: "", AGENT_BROWSER_SESSION: "work" };
  mkdirSync(join(home, ".agent-browser"));
  writeFileSync(browserDaemonFile(env, ".pid"), String(tree.daemon));
  nativeCode = undefined;
  vi.mocked(browserProcessesRunning).mockResolvedValue(true);
  vi.mocked(spawn).mockImplementation((_file, args) => child(args));
  vi.mocked(browserProcessTree).mockResolvedValue(tree);
  vi.mocked(stopBrowserProcesses).mockResolvedValue(false);
});
afterEach(() => { closeChild?.emit("close", null); vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks(); rmSync(home, { recursive: true, force: true }); });
it("reserves owned fallback inside the caller allowance instead of starting it at expiry", async () => {
  let settled = false;
  vi.mocked(stopBrowserProcesses).mockImplementation(async (_tree, _grace, options?: { deadline?: number }) => {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, (options?.deadline ?? Date.now() + 2_000) - Date.now())));
    return false;
  });
  const result = closeBrowserSession("/fixture/engine", env, 4_000).then((value) => { settled = true; return value; });
  await vi.advanceTimersByTimeAsync(4_000);
  expect(settled).toBe(true);
  expect(await result).toBe(false);
  expect(stopBrowserProcesses).toHaveBeenCalledWith(tree, expect.any(Number), expect.objectContaining({ deadline: 14_000 }));
  expect(closeChild.kill).toHaveBeenCalled();
});
it("counts queued wait and never starts an expired queued operation", async () => {
  const first = closeBrowserSession("/fixture/engine", env, 4_000);
  await vi.advanceTimersByTimeAsync(1);
  let queued: boolean | undefined;
  const second = closeBrowserSession("/fixture/engine", env, 100).then((value) => { queued = value; });
  await vi.advanceTimersByTimeAsync(100);
  expect(queued).toBe(false);
  await vi.advanceTimersByTimeAsync(8_000);
  await Promise.all([first, second]);
  expect(vi.mocked(spawn).mock.calls.filter((call) => call[1][0] === "close")).toHaveLength(1);
});
it("distinguishes nonzero exit from timeout through command termination and fallback", async () => {
  nativeCode = 7;
  expect(await closeBrowserSession("/fixture/engine", env, 4_000)).toBe(false);
  expect(closeChild.kill).not.toHaveBeenCalled();
  expect(stopBrowserProcesses).toHaveBeenCalledTimes(1);
});
it("uses the reserved interval for a hung native command and confirms owned fallback", async () => {
  vi.mocked(stopBrowserProcesses).mockResolvedValue(true);
  const result = closeBrowserSession("/fixture/engine", env, 4_000);
  await vi.advanceTimersByTimeAsync(2_100);
  expect(await result).toBe(true);
  expect(closeChild.kill).toHaveBeenCalledWith("SIGKILL");
  expect(vi.getTimerCount()).toBe(0);
});
it("requires command close and fences a later call when KILL cannot confirm termination", async () => {
  const result = closeBrowserSession("/fixture/engine", env, 4_000);
  await vi.advanceTimersByTimeAsync(1);
  vi.mocked(closeChild.kill).mockImplementation(() => false);
  await vi.advanceTimersByTimeAsync(4_000);
  expect(await result).toBe(false);
  expect(stopBrowserProcesses).not.toHaveBeenCalled();
  const count = vi.mocked(spawn).mock.calls.length;
  expect(await closeBrowserSession("/fixture/engine", env, 4_000)).toBe(false);
  expect(spawn).toHaveBeenCalledTimes(count);
  expect(vi.getTimerCount()).toBe(0);
});
it.each([0, -1])("starts no command with expired allowance %s", async (timeout) => {
  const result = closeBrowserSession("/fixture/engine", env, timeout);
  await vi.advanceTimersByTimeAsync(0);
  expect(await result).toBe(false);
  expect(spawn).not.toHaveBeenCalled();
});
it("refuses fallback after session replacement during native close", async () => {
  const result = closeBrowserSession("/fixture/engine", env, 4_000);
  await vi.advanceTimersByTimeAsync(1);
  writeFileSync(browserDaemonFile(env, ".pid"), "54321");
  closeChild.emit("close", 7);
  expect(await result).toBe(false);
  expect(stopBrowserProcesses).not.toHaveBeenCalled();
});
it("refuses native close after replacement during discovery", async () => {
  vi.mocked(browserProcessTree).mockImplementation(async () => {
    writeFileSync(browserDaemonFile(env, ".pid"), "54321"); return tree;
  });
  expect(await closeBrowserSession("/fixture/engine", env, 4_000)).toBe(false);
  expect(vi.mocked(spawn).mock.calls.map((call) => call[1])).toEqual([["session", "list", "--json"]]);
});
it("allows distinct sessions to close concurrently without sharing a queue", async () => {
  nativeCode = 7;
  vi.mocked(stopBrowserProcesses).mockResolvedValue(true);
  const other = { ...env, AGENT_BROWSER_SESSION: "other" };
  writeFileSync(browserDaemonFile(other, ".pid"), "43211");
  vi.mocked(spawn).mockImplementation((_file, args) => args[0] === "session"
    ? (() => { const result = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: vi.fn() }); queueMicrotask(() => { result.stdout.emit("data", JSON.stringify({ success: true, data: { sessions: ["work", "other"] } })); result.emit("close", 0); }); return result as unknown as ReturnType<typeof spawn>; })()
    : child(args));
  expect(await Promise.all([closeBrowserSession("/fixture/engine", env), closeBrowserSession("/fixture/engine", other)])).toEqual([true, true]);
  expect(vi.mocked(spawn).mock.calls.filter((call) => call[1][0] === "close")).toHaveLength(2);
});
it("does not start native close when discovery consumes the last millisecond", async () => {
  vi.mocked(browserProcessTree).mockImplementation(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); return tree; });
  const result = closeBrowserSession("/fixture/engine", env, 100);
  await vi.advanceTimersByTimeAsync(100);
  expect(await result).toBe(false);
  expect(vi.mocked(spawn).mock.calls.map((call) => call[1])).toEqual([["session", "list", "--json"]]);
  expect(stopBrowserProcesses).not.toHaveBeenCalled();
});
it("awaits actual inventory stdio close after root exit", async () => {
  vi.useRealTimers();
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  let exited = false;
  let closed = false;
  let command: ReturnType<typeof spawn> | undefined;
  vi.mocked(spawn).mockImplementation(() => {
    command = actual.spawn(process.execPath, ["-e", `require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 150)'], {stdio:['ignore',1,'ignore']}); console.log(JSON.stringify({success:true,data:{sessions:[]}})); process.exit(0);`], { env, stdio: ["ignore", "pipe", "ignore"] });
    command.on("exit", () => { exited = true; expect(closed).toBe(false); });
    command.on("close", () => { closed = true; });
    return command;
  });
  try {
    expect(await closeBrowserSession("/fixture/engine", env, 1_000)).toBe(true);
    expect(exited && closed).toBe(true);
    expect(stopBrowserProcesses).not.toHaveBeenCalled();
  } finally { if (!closed) { command?.kill("SIGKILL"); command?.stdout?.destroy(); } }
});
it.each([false, true])("preserves owned fallback after native acknowledgement and a hung disappearance query (confirmed %s)", async (confirmed) => {
  nativeCode = 0;
  let inventories = 0;
  vi.mocked(spawn).mockImplementation((_file, args) => child(args, ++inventories === 1 ? ["work"] : []));
  const queries: number[] = [];
  vi.mocked(browserProcessesRunning).mockImplementation(async (_tree, deadline = Infinity) => {
    queries.push(deadline);
    await new Promise((resolve) => setTimeout(resolve, deadline - Date.now()));
    return true;
  });
  let fallbackAt: number | undefined;
  vi.mocked(stopBrowserProcesses).mockImplementation(async (_tree, _grace, options) => {
    fallbackAt = Date.now();
    expect(options?.deadline).toBe(10_160);
    await new Promise((resolve) => setTimeout(resolve, 10));
    return confirmed;
  });
  const result = closeBrowserSession("/fixture/engine", env, 160);
  await vi.advanceTimersByTimeAsync(160);
  expect(queries).toEqual([10_080]);
  expect(fallbackAt).toBe(10_080);
  expect(await result).toBe(confirmed);
  expect(vi.getTimerCount()).toBe(0);
});

function removableDaemon(onInventory?: (count: number, command: ReturnType<typeof spawn>) => ReturnType<typeof spawn> | void) {
  let sessions = ["work"];
  let inventories = 0;
  vi.mocked(spawn).mockImplementation((_file, args) => {
    const command = child(args, sessions);
    return args[0] === "session" ? onInventory?.(++inventories, command) ?? command : command;
  });
  vi.mocked(browserProcessesRunning).mockResolvedValue(false);
  return (code = 0) => {
    sessions = [];
    unlinkSync(browserDaemonFile(env, ".pid"));
    closeChild.emit("close", code);
  };
}
it("shares confirmed close with a queued subscriber after actual pid-file removal", async () => {
  const finish = removableDaemon();
  const first = closeBrowserSession("/fixture/engine", env, 1_000);
  await vi.advanceTimersByTimeAsync(1);
  const second = closeBrowserSession("/fixture/engine", env, 1_000);
  finish();
  expect(await Promise.all([first, second])).toEqual([true, true]);
  expect(vi.mocked(spawn).mock.calls.filter((call) => call[1][0] === "close")).toHaveLength(1);
});
it("does not inherit absence after a previous false close", async () => {
  const finish = removableDaemon();
  const first = closeBrowserSession("/fixture/engine", env, 1_000);
  await vi.advanceTimersByTimeAsync(1);
  const second = closeBrowserSession("/fixture/engine", env, 1_000);
  finish(7);
  expect(await Promise.all([first, second])).toEqual([false, false]);
  expect(vi.mocked(spawn).mock.calls.filter((call) => call[1][0] === "close")).toHaveLength(1);
});
it("does not inherit absence after false when both requests began without a pid file", async () => {
  const finish = removableDaemon();
  unlinkSync(browserDaemonFile(env, ".pid"));
  const first = closeBrowserSession("/fixture/engine", env, 1_000);
  await vi.advanceTimersByTimeAsync(1);
  const second = closeBrowserSession("/fixture/engine", env, 1_000);
  writeFileSync(browserDaemonFile(env, ".pid"), String(tree.daemon));
  finish(7);
  expect(await Promise.all([first, second])).toEqual([false, false]);
  expect(vi.mocked(spawn).mock.calls.filter((call) => call[1][0] === "close")).toHaveLength(1);
});
it("does not share successful close if fresh inventory lists the session again", async () => {
  const finish = removableDaemon((count) => count === 3 ? child(["session"], ["work"]) : undefined);
  const first = closeBrowserSession("/fixture/engine", env, 1_000);
  await vi.advanceTimersByTimeAsync(1);
  const second = closeBrowserSession("/fixture/engine", env, 1_000);
  finish();
  expect(await Promise.all([first, second])).toEqual([true, false]);
  expect(vi.mocked(spawn).mock.calls.filter((call) => call[1][0] === "close")).toHaveLength(1);
});
it("refuses a replacement before a queued subscriber settles even after confirmed close", async () => {
  const finish = removableDaemon();
  const first = closeBrowserSession("/fixture/engine", env, 1_000);
  await vi.advanceTimersByTimeAsync(1);
  const second = closeBrowserSession("/fixture/engine", env, 1_000);
  finish();
  expect(await first).toBe(true);
  writeFileSync(browserDaemonFile(env, ".pid"), "54321");
  expect(await second).toBe(false);
  expect(vi.mocked(spawn).mock.calls.filter((call) => call[1][0] === "close")).toHaveLength(1);
});
it.each(["during inventory", "after inventory result"])("refuses a replacement %s during queued confirmation", async (stage) => {
  const finish = removableDaemon((count, command) => {
    if (count !== 3) return;
    command.on("close", () => {
      const replace = () => writeFileSync(browserDaemonFile(env, ".pid"), "54321");
      if (stage === "during inventory") replace();
      else queueMicrotask(() => queueMicrotask(() => queueMicrotask(replace)));
    });
  });
  const first = closeBrowserSession("/fixture/engine", env, 1_000);
  await vi.advanceTimersByTimeAsync(1);
  const second = closeBrowserSession("/fixture/engine", env, 1_000);
  finish();
  expect(await Promise.all([first, second])).toEqual([true, false]);
  expect(vi.mocked(spawn).mock.calls.filter((call) => call[1][0] === "close")).toHaveLength(1);
});
it("does not inherit prior success for a different identity captured while queued", async () => {
  const finish = removableDaemon();
  const first = closeBrowserSession("/fixture/engine", env, 1_000);
  await vi.advanceTimersByTimeAsync(1);
  writeFileSync(browserDaemonFile(env, ".pid"), "54321");
  const second = closeBrowserSession("/fixture/engine", env, 1_000);
  finish();
  expect(await Promise.all([first, second])).toEqual([true, false]);
  expect(vi.mocked(spawn).mock.calls.filter((call) => call[1][0] === "close")).toHaveLength(1);
});
it("does not inherit absence while a prior command close remains unknown", async () => {
  const finish = removableDaemon();
  const first = closeBrowserSession("/fixture/engine", env, 160);
  await vi.advanceTimersByTimeAsync(1);
  const second = closeBrowserSession("/fixture/engine", env, 500);
  vi.mocked(closeChild.kill).mockImplementation(() => false);
  unlinkSync(browserDaemonFile(env, ".pid"));
  await vi.advanceTimersByTimeAsync(160);
  expect(await Promise.all([first, second])).toEqual([false, false]);
  expect(stopBrowserProcesses).not.toHaveBeenCalled();
  expect(vi.mocked(spawn).mock.calls.filter((call) => call[1][0] === "close")).toHaveLength(1);
  writeFileSync(browserDaemonFile(env, ".pid"), String(tree.daemon));
  finish(7);
});
it("keeps a queued subscriber unknown if its fresh inventory cannot complete in its own budget", async () => {
  const finish = removableDaemon((count) => {
    if (count !== 3) return;
    const pending = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: () => { queueMicrotask(() => pending.emit("close", null)); return true; } });
    return pending as unknown as ReturnType<typeof spawn>;
  });
  const first = closeBrowserSession("/fixture/engine", env, 1_000);
  await vi.advanceTimersByTimeAsync(1);
  const second = closeBrowserSession("/fixture/engine", env, 100);
  finish();
  expect(await first).toBe(true);
  await vi.advanceTimersByTimeAsync(100);
  expect(await second).toBe(false);
  expect(vi.mocked(spawn).mock.calls.filter((call) => call[1][0] === "close")).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("counts the subscriber's own expiry before a prior confirmed close", async () => {
  const finish = removableDaemon();
  const first = closeBrowserSession("/fixture/engine", env, 1_000);
  await vi.advanceTimersByTimeAsync(1);
  const second = closeBrowserSession("/fixture/engine", env, 5);
  await vi.advanceTimersByTimeAsync(5);
  expect(await second).toBe(false);
  finish();
  expect(await first).toBe(true);
  expect(vi.mocked(spawn).mock.calls.filter((call) => call[1][0] === "close")).toHaveLength(1);
});

it.each([7, null])("awaits the real owned command close (exit %s)", async (code) => {
  vi.useRealTimers();
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  let command: ReturnType<typeof spawn> | undefined;
  let closed = false;
  let exit: number | null | undefined;
  vi.mocked(spawn).mockImplementation((_file, args) => {
    if (args[0] === "session") return child(args);
    command = actual.spawn(process.execPath, ["-e", code === null ? "setInterval(() => {}, 1000)" : `process.exit(${code})`], { env, stdio: "ignore" });
    closeChild = command;
    command.on("exit", (value) => { exit = value; });
    command.on("close", () => { closed = true; });
    return command;
  });
  vi.mocked(stopBrowserProcesses).mockImplementation(async () => { expect(closed).toBe(true); return true; });
  const start = Date.now();
  try {
    expect(await closeBrowserSession("/fixture/engine", env, 1_000)).toBe(true);
    expect(closed).toBe(true);
    expect(exit).toBe(code);
    expect(Date.now() - start).toBeLessThan(1_000);
    expect(() => process.kill(command!.pid!, 0)).toThrow();
  } finally { if (!closed) command?.kill("SIGKILL"); }
});

