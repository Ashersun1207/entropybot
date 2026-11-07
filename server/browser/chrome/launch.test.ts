import { execFile, spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { launchChrome } from "./launch.ts";
import { ProcessRegistry, sweep } from "./processes.ts";

vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn), execFile: vi.fn(actual.execFile) };
});
afterEach(() => { vi.mocked(spawn).mockReset(); vi.mocked(execFile).mockReset(); vi.useRealTimers(); });

const FAKE_CHROME = `
const fs = require("node:fs");
const mode = process.env.FAKE_CHROME_MODE;
const input = fs.createReadStream(null, { fd: 3 });
const output = fs.createWriteStream(null, { fd: 4 });
let pending = "";
input.on("data", (data) => {
  pending += data.toString();
  let end;
  while ((end = pending.indexOf("\\0")) !== -1) {
    const frame = JSON.parse(pending.slice(0, end));
    pending = pending.slice(end + 1);
    if (mode === "handshake-failure") {
      output.write(JSON.stringify({ id: frame.id, error: { message: "synthetic handshake refusal" } }) + "\\0");
    } else if (frame.method === "Browser.getVersion") {
      output.write(JSON.stringify({ id: frame.id, result: { product: "Synthetic Chrome", userAgent: "fixture", protocolVersion: "1.3", revision: "fixture" } }) + "\\0");
    } else if (frame.method === "Browser.close") {
      if (mode === "held-pipes") require("node:child_process").spawn(process.execPath, ["-e", 'setTimeout(() => { require("node:fs").writeFileSync(process.env.HOME + "/holder-finished", "done"); process.exit(0); }, 250)'], { stdio: ["ignore", "ignore", "ignore", 3, 4] });
      process.exit(0);
    }
  }
});
input.on("end", () => process.exit(0));
`;

async function realFixture(mode = "normal") {
  const dir = mkdtempSync(join(tmpdir(), "omb-chrome-close-"));
  const script = join(dir, "fake-chrome.cjs");
  writeFileSync(script, FAKE_CHROME);
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  let child: ChildProcess | undefined;
  let closed = false;
  const events: string[] = [];
  vi.mocked(spawn).mockImplementationOnce((command, argv, options) => {
    expect(command).toBe(process.execPath);
    child = actual.spawn(process.execPath, [script, ...argv!], options!);
    child.once("exit", () => events.push("exit"));
    child.once("close", () => { closed = true; events.push("close"); });
    return child;
  });
  onTestFinished(async () => {
    if (child) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      for (const stream of child.stdio) stream?.destroy();
      await expect.poll(() => closed, { timeout: 2_000 }).toBe(true);
    }
    if (mode === "held-pipes") await expect.poll(() => existsSync(join(dir, "holder-finished")), { timeout: 2_000 }).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
  const registry = new ProcessRegistry(dir);
  const start = () => launchChrome({ executablePath: process.execPath, userDataDir: join(dir, "profile"), home: dir, mode: "headless", host: "desktop",
    env: { PATH: process.env.PATH, HOME: dir, FAKE_CHROME_MODE: mode }, registry, handshakeTimeoutMs: 1_000 });
  return { start, registry, events, closed: () => closed, child: () => child! };
}

it("returns from close only after exit and ChildProcess.close with both DevTools pipe endpoints reclaimed", async () => {
  const f = await realFixture("held-pipes");
  const chrome = await f.start();
  chrome.transport.send(JSON.stringify({ id: 1, method: "Browser.close", params: {} }));
  await chrome.exited;
  expect(f.events).toContain("exit");
  await chrome.close(0);
  expect(f.closed()).toBe(true);
  expect(f.events).toEqual(["exit", "close"]);
  expect(f.child().stdio[3]?.destroyed).toBe(true);
  expect(f.child().stdio[4]?.destroyed).toBe(true);
  expect(f.registry.list()).toEqual([]);
});

it("reclaims the real child and its pipes before rejecting a refused handshake", async () => {
  const f = await realFixture("handshake-failure");
  await expect(f.start()).rejects.toThrow("synthetic handshake refusal");
  expect(f.closed()).toBe(true);
  expect(f.child().stdio[3]?.destroyed).toBe(true);
  expect(f.child().stdio[4]?.destroyed).toBe(true);
  expect(f.registry.list()).toEqual([]);
});

function mockFixture(refusesHandshake = false) {
  const dir = mkdtempSync(join(tmpdir(), "omb-chrome-close-unknown-"));
  const registry = new ProcessRegistry(dir);
  const userDataDir = join(dir, "temp", "profile");
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(join(userDataDir, "retain-marker"), "synthetic");
  const input = new PassThrough(), output = new PassThrough();
  const child = Object.assign(new EventEmitter(), { pid: 32100, stdout: new PassThrough(), stderr: new PassThrough(), stdio: [null, null, null, input, output],
    exitCode: null as number | null, signalCode: null, kill: vi.fn(() => true) });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess);
  vi.mocked(execFile).mockReturnValue(child as unknown as ChildProcess);
  input.on("data", (data) => {
    const frame = JSON.parse(data.toString().replace(/\0$/, ""));
    output.write(JSON.stringify({ id: frame.id, ...(refusesHandshake ? { error: { message: "synthetic handshake refusal" } }
      : { result: { product: "mock", userAgent: "mock", protocolVersion: "1.3", revision: "mock" } }) }) + "\0");
  });
  return { dir, userDataDir, registry, child, start: () => launchChrome({ executablePath: "synthetic-chrome", userDataDir, home: dir, mode: "headless", host: "desktop", registry }) };
}

it("fails boundedly and preserves registry evidence when exit arrives but close never does", async () => {
  vi.useFakeTimers();
  const { dir, registry, child, start } = mockFixture();
  const chrome = await start();
  child.exitCode = 0;
  child.emit("exit", 0, null);
  const closing = chrome.close(0).then(value => value as unknown, error => error as unknown);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await closing).toBeInstanceOf(Error);
  expect(String(await closing)).toMatch(/close|pipe/i);
  expect(registry.list()).toHaveLength(1);
  expect(existsSync(dir)).toBe(true);
  expect(readFileSync(join(dir, "processes.json"), "utf8")).toContain("32100");
  console.info(JSON.stringify({ retainedChromeCloseEvidence: dir }));
});

it.each(["close", "kill"] as const)("reports registry failure from %s without throwing from the close event, and retries safely", async (method) => {
  const { registry, child, start } = mockFixture();
  const chrome = await start();
  const remove = vi.spyOn(registry, "remove").mockImplementationOnce(() => { throw new Error("synthetic registry write refused"); });
  child.exitCode = 0;
  child.emit("exit", 0, null);
  expect(() => child.emit("close", 0, null)).not.toThrow();
  await expect(method === "kill" ? chrome.kill() : chrome.close(0)).rejects.toMatchObject({ cleanup: { status: "cleanup-failed" } });
  expect(registry.list()).toHaveLength(1);
  await chrome.close(0);
  expect(registry.list()).toEqual([]);
  expect(remove).toHaveBeenCalledTimes(2);
  expect(child.kill).not.toHaveBeenCalled();
});

it("does not throw from a late close after timeout when registry cleanup fails", async () => {
  vi.useFakeTimers();
  const { dir, userDataDir, registry, child, start } = mockFixture();
  const chrome = await start();
  child.exitCode = 0;
  child.emit("exit", 0, null);
  const outcome = chrome.kill().catch(error => error);
  await vi.advanceTimersByTimeAsync(2_100);
  expect(await outcome).toMatchObject({ cleanup: { status: "unknown" } });
  const clean = () => sweep({ root: dir, registry, list: async () => [], alive: pid => pid === process.pid, kill: async () => { throw new Error("nothing was listed"); } });
  await clean();
  await clean();
  expect(registry.list()).toHaveLength(1);
  expect(existsSync(userDataDir)).toBe(true);
  vi.spyOn(registry, "remove").mockImplementationOnce(() => { throw new Error("synthetic late registry refusal"); });
  expect(() => child.emit("close", 0, null)).not.toThrow();
  await expect(chrome.close(0)).rejects.toMatchObject({ cleanup: { status: "cleanup-failed" } });
  await chrome.close(0);
  expect(registry.list()).toEqual([]);
  await clean();
  expect(existsSync(userDataDir)).toBe(false);
});

it("reports registry cleanup failure during a refused handshake and retries without losing the close fact", async () => {
  const { registry, child, start } = mockFixture(true);
  vi.spyOn(registry, "remove").mockImplementationOnce(() => { throw new Error("synthetic handshake registry refusal"); });
  const outcome = start().catch(error => error);
  child.exitCode = 0;
  child.emit("exit", 0, null);
  expect(() => child.emit("close", 0, null)).not.toThrow();
  const error = await outcome;
  expect(error).toMatchObject({ cleanup: { status: "cleanup-failed" } });
  expect(error.cause.message).toContain("synthetic handshake registry refusal");
  expect(registry.list()).toHaveLength(1);
  await error.retryCleanup();
  expect(registry.list()).toEqual([]);
  expect(child.kill).not.toHaveBeenCalled();
});

it("keeps handshake failure and unconfirmed close evidence instead of declaring launch cleanup complete", async () => {
  vi.useFakeTimers();
  const { dir, registry, start } = mockFixture(true);
  const failed = start().then(value => value as unknown, error => error as unknown);
  await vi.advanceTimersByTimeAsync(2_500);
  expect(await failed).toBeInstanceOf(Error);
  expect(String(await failed)).toContain("synthetic handshake refusal");
  expect(String(await failed)).toContain("close was not confirmed");
  expect(registry.list()).toHaveLength(1);
  expect(existsSync(dir)).toBe(true);
  console.info(JSON.stringify({ retainedChromeCloseEvidence: dir }));
});
