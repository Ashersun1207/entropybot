import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { captureVerificationGroups } from "./verification-external-stop.ts";

const identity = () => ({ version: 1 as const, gateNonce: randomUUID(), fixtureNonce: randomUUID(), serverNonce: randomUUID(), generation: 1, dataDir: "/synthetic-fixture" });

it("accepts only the inventoried groups of its own bootstrap generation", async () => {
  const owner = identity();
  const child = Object.assign(new EventEmitter(), {
    pid: 32000,
    send() { queueMicrotask(() => child.emit("message", { type: "verification:inventory", identity: owner, serverPid: 32000, groups: [32100] })); },
  });
  expect(await captureVerificationGroups(child as unknown as ChildProcess, owner, 100)).toEqual([32100]);
  expect(child.listenerCount("message")).toBe(0);
});

it.each(["stale", "self", "unknown"])("rejects a %s external inventory instead of authorizing a stop", async (mode) => {
  const owner = identity();
  const child = Object.assign(new EventEmitter(), {
    pid: 32000,
    send() {
      queueMicrotask(() => child.emit("message", { type: "verification:inventory", identity: mode === "stale" ? identity() : owner,
        serverPid: 32000, groups: mode === "self" ? [process.pid] : [32100], ...(mode === "unknown" ? { reason: "Unconfirmed CLI" } : {}) }));
    },
  });
  await expect(captureVerificationGroups(child as unknown as ChildProcess, owner, 100)).rejects.toThrow(/inventory invalid|Unconfirmed CLI/);
  expect(child.listenerCount("message")).toBe(0);
});
