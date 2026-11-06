import { closeSync, existsSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { assertGateLeases, createGateCapability, createVerificationLease, VerificationLifecycle } from "./verification-lifecycle.ts";
import type { VerificationIdentity } from "../../server/verification-process-scope.ts";

const probe = fileURLToPath(new URL("./verification-boundary-probe.mjs", import.meta.url));
const cwd = fileURLToPath(new URL("../../", import.meta.url));
afterEach(() => vi.restoreAllMocks());

function fixture(options: ConstructorParameters<typeof VerificationLifecycle>[0] = {}) {
  const lifecycle = new VerificationLifecycle({ capability: null, stopTimeoutMs: 600, ...options });
  let log = -1;
  let closed = true;
  onTestFinished(async () => {
    try { await lifecycle.close(); } catch {}
    try {
      const child = lifecycle.child;
      if (!closed) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await expect.poll(() => closed, { timeout: 1_000 }).toBe(true);
      }
    } catch (error) { if (!String(error).includes("has not started")) throw error; }
    if (log >= 0) closeSync(log);
    rmSync(lifecycle.dataDir, { recursive: true, force: true });
  });
  log = openSync(join(lifecycle.dataDir, "test.log"), "a");
  const start = (mode: string, missingCwd = false, extra = "") => {
    const launched = lifecycle.start([probe, "server", mode, extra], { cwd: missingCwd ? join(lifecycle.dataDir, "absent") : cwd,
      env: { PATH: process.env.PATH, HOME: lifecycle.dataDir, OMB_DATA_DIR: lifecycle.dataDir }, log });
    return launched.then(async child => {
      closed = child.exitCode !== null || child.signalCode !== null;
      child.once("close", () => { closed = true; });
      if (mode !== "startup-fail") {
        let ready = false;
        child.on("message", message => { if ((message as { type?: string }).type === "probe:ready") ready = true; });
        child.send({ type: "probe:request" });
        await expect.poll(() => ready, { timeout: 2_000 }).toBe(true);
      }
      return child;
    });
  };
  return { lifecycle, start, closed: () => closed };
}

it("confirms seal at actual production spawn and caches successful close", async () => {
  const f = fixture();
  const pending = f.start("sealed");
  const proof = new Promise<{ refused: boolean; spawnCalls: number }>(resolve => f.lifecycle.child.on("message", message => {
    const frame = message as { type?: string; refused: boolean; spawnCalls: number };
    if (frame.type === "probe:ready") resolve(frame);
  }));
  await pending;
  expect(await proof).toMatchObject({ refused: true, spawnCalls: 0 });
  const close = f.lifecycle.close();
  expect(f.lifecycle.close()).toBe(close);
  await close;
  expect(existsSync(f.lifecycle.dataDir)).toBe(false);
});

it("adopts a real ChildProcess when registration throws and never reports count-zero success", async () => {
  const f = fixture();
  const started = f.start("registration-failure");
  const proof = new Promise<{ adoptedPid: number; registered: number; confirmed: number; status: string }>(resolve => f.lifecycle.child.on("message", value => {
    const frame = value as { type?: string; adoptedPid: number; registered: number; confirmed: number; status: string };
    if (frame.type === "probe:ready") resolve(frame);
  }));
  await started;
  const observed = await proof;
  expect(observed).toMatchObject({ registered: 1, confirmed: 1, status: "unknown" });
  expect(observed.adoptedPid).toBeGreaterThan(1);
  await expect(f.lifecycle.close()).rejects.toThrow("registration failed");
  expect(existsSync(f.lifecycle.dataDir)).toBe(true);
  let gone = false;
  try { process.kill(-observed.adoptedPid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") gone = true; else throw error; }
  expect(gone).toBe(true);
});

it.each(["bad-nonce", "bad-gate", "bad-fixture", "bad-pid", "bad-generation", "bad-dir", "bad-version", "failed-exit", "missing-receipt"])("preserves the actual fixture directory on %s", async mode => {
  const f = fixture();
  await f.start(mode);
  const close = f.lifecycle.close();
  expect(f.lifecycle.close()).toBe(close);
  const error = await close.catch(value => value);
  expect(error).toBeInstanceOf(Error);
  expect(existsSync(f.lifecycle.dataDir)).toBe(true);
  expect(JSON.parse(readFileSync(join(f.lifecycle.dataDir, "verification-stop-unknown.json"), "utf8")).localServerClosed).toBe(true);
  await expect(f.lifecycle.close()).rejects.toBe(error);
});

it("proves a spawn rejection had no entry or resources before empty cleanup", async () => {
  const f = fixture();
  await expect(f.start("sealed", true)).rejects.toThrow("ENOENT");
  await f.lifecycle.close();
  expect(existsSync(f.lifecycle.dataDir)).toBe(false);
});

it("keeps a server that failed after INIT unknown", async () => {
  const f = fixture();
  await f.start("startup-fail");
  await expect.poll(f.closed).toBe(true);
  await expect(f.lifecycle.close()).rejects.toThrow("receipt missing");
  expect(existsSync(f.lifecycle.dataDir)).toBe(true);
});

it("retains INIT timeout and does not silently fall back to a product server", async () => {
  const f = fixture({ initTimeoutMs: 60 });
  const started = f.start("sealed");
  const send = vi.spyOn(f.lifecycle.child, "send").mockImplementation(() => true);
  try {
    await expect(started).rejects.toThrow("INIT acknowledgement timed out");
    await expect(f.lifecycle.close()).rejects.toThrow("INIT acknowledgement timed out");
    expect(existsSync(f.lifecycle.dataDir)).toBe(true);
  } finally { send.mockRestore(); }
});

it("requires the new generation's receipt after a stopped generation", async () => {
  const f = fixture();
  await f.start("sealed");
  const old = f.lifecycle.identity;
  await f.lifecycle.stop();
  expect(existsSync(f.lifecycle.dataDir)).toBe(true);
  await f.start("stale", false, JSON.stringify(old));
  expect(f.lifecycle.identity.generation).toBe(old.generation + 1);
  expect(f.lifecycle.identity.serverNonce).not.toBe(old.serverNonce);
  await expect(f.lifecycle.close()).rejects.toThrow("identity mismatch");
  expect(existsSync(f.lifecycle.dataDir)).toBe(true);
});

it("does not allow a new generation after an unknown stop", async () => {
  const f = fixture();
  await f.start("missing-receipt");
  const identity = f.lifecycle.identity;
  const error = await f.lifecycle.stop().catch(value => value);
  await expect(f.start("sealed")).rejects.toBe(error);
  expect(f.lifecycle.identity).toBe(identity);
});

it("does not create concurrent generations", async () => {
  const f = fixture();
  const first = f.start("sealed");
  await expect(f.start("sealed")).rejects.toThrow("transition in progress");
  await first;
  expect(f.lifecycle.identity.generation).toBe(1);
  await f.lifecycle.close();
});

it("does not spawn after a close wins the stopped-generation handoff", async () => {
  const f = fixture();
  await f.start("sealed");
  await f.lifecycle.stop();
  const generation = f.lifecycle.identity;
  const next = f.start("sealed");
  const close = f.lifecycle.close();
  await expect(next).rejects.toThrow("already closed");
  await close;
  expect(f.lifecycle.identity).toBe(generation);
  expect(existsSync(f.lifecycle.dataDir)).toBe(false);
});

it("keeps the directory when close exceeds its budget", async () => {
  const f = fixture({ stopTimeoutMs: 100 });
  await f.start("close-timeout");
  const kill = vi.spyOn(f.lifecycle.child, "kill").mockReturnValue(true);
  try {
    await expect(f.lifecycle.close()).rejects.toThrow("deadline exceeded");
    expect(existsSync(f.lifecycle.dataDir)).toBe(true);
  } finally { kill.mockRestore(); }
});

it("caches a deletion failure after a confirmed stop without erasing the directory", async () => {
  const f = fixture();
  await f.start("sealed");
  const nativeFs = process.getBuiltinModule("fs");
  const original = nativeFs.rmSync;
  const fault = vi.spyOn(nativeFs, "rmSync").mockImplementation((path, options) => {
    if (String(path) === f.lifecycle.dataDir) throw new Error("synthetic fixture removal refusal");
    return original(path, options);
  });
  process.getBuiltinModule("module").syncBuiltinESMExports();
  const close = f.lifecycle.close();
  expect(f.lifecycle.close()).toBe(close);
  try {
    await expect(close).rejects.toThrow("synthetic fixture removal refusal");
    expect(existsSync(f.lifecycle.dataDir)).toBe(true);
  } finally { fault.mockRestore(); process.getBuiltinModule("module").syncBuiltinESMExports(); }
});

it("rejects unauthenticated, stale, pending and unknown lease records without killing anything", () => {
  const home = mkdtempSync(join(tmpdir(), "gate-lease-test-"));
  onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const capability = createGateCapability(home);
  const identity: VerificationIdentity = { version: 1, gateNonce: capability.gateNonce, fixtureNonce: randomUUID(), serverNonce: randomUUID(), generation: 1, dataDir: home };
  const lease = createVerificationLease(identity, capability);
  const kill = vi.spyOn(process, "kill");
  expect(() => assertGateLeases(capability)).toThrow("pending or unknown");
  lease.update("unknown");
  expect(() => assertGateLeases(capability)).toThrow("pending or unknown");
  expect(() => lease.update("stopped")).toThrow("terminal");
  const validHome = mkdtempSync(join(home, "valid-"));
  const valid = createGateCapability(validHome);
  createVerificationLease({ ...identity, gateNonce: valid.gateNonce }, valid).update("stopped");
  expect(assertGateLeases(valid)).toBe(1);
  expect(() => assertGateLeases({ ...valid, gateNonce: randomUUID() })).toThrow("Stale");
  const path = join(valid.directory, readdirSync(valid.directory)[0]);
  writeFileSync(path, JSON.stringify({ payload: JSON.stringify({ status: "stopped", pid: process.pid }), mac: "0".repeat(64) }));
  expect(() => assertGateLeases(valid)).toThrow("Unauthenticated");
  expect(kill).not.toHaveBeenCalled();
});
