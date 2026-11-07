import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { waitForExit } from "./cleanup.ts";

afterEach(() => vi.useRealTimers());

function child() {
  return Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, connected: false, stdio: [{ destroyed: false }], kill: vi.fn(() => true) }) as unknown as ChildProcess;
}

it("waits for close after a child reports exit", async () => {
  const process = child();
  let closed = false;
  const stopped = waitForExit(process).then(() => { closed = true; });
  process.emit("exit", 0);
  await Promise.resolve();
  expect(closed).toBe(false);
  process.emit("close", 0);
  await stopped;
  expect(closed).toBe(true);
});

it("fails after escalation when no close can be confirmed", async () => {
  vi.useFakeTimers();
  const process = child();
  const stopped = waitForExit(process, { signal: "SIGTERM", graceMs: 10 });
  const failure = expect(stopped).rejects.toThrow("preserve its directory");
  await vi.advanceTimersByTimeAsync(2_010);
  await failure;
  expect(process.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
  expect(process.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  expect(process.listenerCount("close")).toBe(0);
});

it("does not equate a signal exit with a still-open pipe to close", async () => {
  const process = Object.assign(child(), { signalCode: "SIGTERM" });
  let closed = false;
  const stopped = waitForExit(process).then(() => { closed = true; });
  await Promise.resolve();
  expect(closed).toBe(false);
  process.emit("close", null, "SIGTERM");
  await stopped;
  expect(process.kill).not.toHaveBeenCalled();
});
