import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { VerificationProcessScope, verificationProcessScope, type VerificationReceipt } from "./verification-process-scope.ts";

const identity = () => ({ version: 1 as const, gateNonce: randomUUID(), fixtureNonce: randomUUID(), serverNonce: randomUUID(), generation: 1, dataDir: "/synthetic-fixture" });
const child = () => new EventEmitter() as ChildProcess;

it("is a default product noop without explicit IPC installation", () => {
  vi.stubEnv("OMB_VERIFICATION_GATE_CAPABILITY", "not-an-activation-channel");
  try { expect(verificationProcessScope()).toBeUndefined(); } finally { vi.unstubAllEnvs(); }
});

it("seals before new creation and confirms each registered actual handle once", async () => {
  const scope = new VerificationProcessScope(identity(), async () => true);
  const first = child();
  const second = child();
  const stop = vi.fn(async () => true);
  scope.register(first, stop);
  scope.register(second, stop);
  const drain = scope.drain();
  expect(() => scope.assertSpawnAllowed()).toThrow("sealed");
  expect(scope.drain()).toBe(drain);
  expect(await drain).toMatchObject({ status: "stopped", registered: 2, confirmed: 2 });
  expect(stop).toHaveBeenCalledTimes(2);
  expect(first.listenerCount("close") + second.listenerCount("close")).toBe(0);
  scope.dispose();
});

it("seals an external-stop inventory without claiming the recorded groups have stopped", () => {
  const scope = new VerificationProcessScope(identity(), async () => true);
  scope.register(Object.assign(child(), { pid: 32100 }), async () => true);
  expect(scope.externalStopInventory()).toEqual({ groups: [32100] });
  expect(() => scope.assertSpawnAllowed()).toThrow("sealed");
  expect(scope.receipt()).toMatchObject({ status: "unknown", registered: 1, confirmed: 0 });
  scope.dispose();
});

it("refuses an external inventory with an unidentified process", () => {
  const scope = new VerificationProcessScope(identity(), async () => true);
  scope.register(child(), async () => true);
  expect(scope.externalStopInventory()).toMatchObject({ reason: "Unidentified verification CLI" });
  scope.dispose();
});

it.each(["false", "reject", "timeout"])("keeps %s stop results unknown", async mode => {
  const scope = new VerificationProcessScope(identity(), async () => true);
  scope.register(child(), async () => {
    if (mode === "reject") throw new Error("synthetic failure");
    if (mode === "timeout") return new Promise<boolean>(() => {});
    return false;
  });
  expect(await scope.drain(30)).toMatchObject({ status: "unknown", registered: 1, confirmed: 0 });
  scope.dispose();
  expect(scope.receipt().status).toBe("unknown");
});

it("retains handle responsibility when registration fails after spawn", async () => {
  const scope = new VerificationProcessScope(identity(), async () => true);
  const stop = vi.fn(async () => true);
  scope.registrationFailed(child(), stop);
  expect(await scope.drain()).toMatchObject({ status: "unknown", registered: 1, confirmed: 1 });
  expect(stop).toHaveBeenCalledOnce();
  scope.dispose();
});

it.each(["rejected-cleanup", "deadline", "flush", "flush-timeout"])("does not turn %s into shutdown success", async mode => {
  const sent: VerificationReceipt[] = [];
  const scope = new VerificationProcessScope(identity(), async value => {
    sent.push(value as VerificationReceipt);
    if (mode === "flush-timeout") return new Promise<boolean>(() => {});
    return mode !== "flush";
  });
  const exit = vi.fn();
  const cleanup = mode === "rejected-cleanup" ? [async () => { throw new Error("synthetic cleanup failure"); }]
    : mode === "deadline" ? [() => new Promise<void>(() => {})] : [];
  const shutdown = scope.shutdown(cleanup, exit, 300);
  expect(scope.shutdown(cleanup, exit, 300)).toBe(shutdown);
  await shutdown;
  expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(scope.receipt().status).toBe("unknown");
  if (!mode.startsWith("flush")) expect(sent[0].status).toBe("unknown");
});

it("runs cleanup and group drain concurrently rather than awaiting registry first", async () => {
  const scope = new VerificationProcessScope(identity(), async () => true);
  let release!: () => void;
  const cleanup = new Promise<void>(resolve => { release = resolve; });
  const stop = vi.fn(async () => { release(); return true; });
  const actual = child();
  scope.register(actual, stop);
  const exit = vi.fn();
  await scope.shutdown([() => cleanup], exit, 500);
  expect(stop).toHaveBeenCalledOnce();
  expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  expect(actual.listenerCount("close") + actual.listenerCount("error")).toBe(0);
});
