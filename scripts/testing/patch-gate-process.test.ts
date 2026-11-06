import { getEventListeners } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { GateCommandError, GateCommandRunner } from "../patch-gate-process.ts";

const childFile = fileURLToPath(new URL("./patch-gate-child.mjs", import.meta.url));
const cwd = fileURLToPath(new URL("../../", import.meta.url));
const env = { PATH: process.env.PATH };

afterEach(() => vi.restoreAllMocks());

function fixture(options: ConstructorParameters<typeof GateCommandRunner>[0] = {}) {
  const runner = new GateCommandRunner({ commandTimeoutMs: 2_000, overallTimeoutMs: 5_000, graceMs: 100, killWaitMs: 1_000, ...options });
  onTestFinished(() => runner.close());
  const events: Array<{ event: string; pid: number; descendant?: number; kind?: string }> = [];
  let output = "";
  const command = (mode: string, heartbeat = "") => runner.run(process.execPath, [childFile, mode, heartbeat], {
    cwd, env, forwardOutput: false,
    onStdout: chunk => {
      output += chunk;
      const lines = output.split("\n");
      output = lines.pop()!;
      events.push(...lines.filter(Boolean).map(line => JSON.parse(line)));
    },
  }).then(result => ({ result, error: undefined }), error => ({ result: undefined, error: error as GateCommandError }));
  const ready = () => expect.poll(() => events.some(event => event.event === "root-ready"), { timeout: 2_000 }).toBe(true);
  return { runner, command, events, ready };
}

it("observes normal output and close before allowing the next command", async () => {
  const f = fixture();
  const first = await f.command("normal");
  expect(first.error).toBeUndefined();
  expect(first.result?.stdout).toContain('"event":"normal"');
  expect(first.result?.stderr).toContain("synthetic stderr");
  expect(first.result?.evidence).toMatchObject({ exitAt: expect.any(Number), closeAt: expect.any(Number), groupGoneAt: expect.any(Number) });
  expect((await f.command("normal")).error).toBeUndefined();
});

it("bounds captured output and makes truncation observable", async () => {
  const f = fixture();
  const result = await f.runner.run(process.execPath, ["-e", "process.stdout.write('x'.repeat(4_200_000))"], { cwd, env, forwardOutput: false });
  expect(result.outputTruncated).toBe(true);
  expect(result.stdout).toHaveLength(4_194_304);
});

it("reports nonzero exit and refuses subsequent commands", async () => {
  const f = fixture();
  const outcome = await f.command("nonzero");
  expect(outcome.error).toMatchObject({ kind: "exit", cleanupConfirmed: true });
  expect(outcome.error?.message).toContain("exit code 7");
  await expect(f.runner.run(process.execPath, [childFile, "normal"], { cwd, env })).rejects.toBe(outcome.error);
  expect(f.events.map(event => event.event)).toEqual(["nonzero"]);
});

it("reports startup failure without inventing a kill target", async () => {
  const f = fixture();
  const kill = vi.spyOn(process, "kill");
  await expect(f.runner.run(join(tmpdir(), "absent-entropybot-fixture", "node"), [], { cwd, env })).rejects.toMatchObject({ kind: "start", cleanupConfirmed: true });
  expect(kill).not.toHaveBeenCalled();
});

it("times out an acknowledged hanging command and escalates ignored TERM", async () => {
  const f = fixture({ commandTimeoutMs: 400 });
  const kill = vi.spyOn(process, "kill");
  const outcome = f.command("hang");
  await f.ready();
  expect((await outcome).error).toMatchObject({ kind: "timeout", cleanupConfirmed: true });
  expect(f.events.some(event => event.event === "term")).toBe(true);
  expect(f.events.some(event => event.event === "insurance")).toBe(false);
  expect(kill.mock.calls.filter(([, signal]) => signal === "SIGTERM")).toHaveLength(1);
  expect(kill.mock.calls.filter(([, signal]) => signal === "SIGKILL")).toHaveLength(1);
});

it("retains the overall deadline across commands", async () => {
  const f = fixture({ commandTimeoutMs: 3_000, overallTimeoutMs: 600 });
  expect((await f.command("normal")).error).toBeUndefined();
  const outcome = f.command("hang");
  await f.ready();
  const error = (await outcome).error;
  expect(error).toMatchObject({ kind: "timeout", cleanupConfirmed: true });
  expect(error?.message).toContain("overall budget");
});

it("rejects pre-aborted execution without spawning", async () => {
  const controller = new AbortController();
  controller.abort();
  const f = fixture({ signal: controller.signal });
  const kill = vi.spyOn(process, "kill");
  expect((await f.command("normal")).error).toMatchObject({ kind: "cancelled", cleanupConfirmed: true });
  expect(f.events).toEqual([]);
  expect(kill).not.toHaveBeenCalled();
});

it("checks queued cancellation again at the asynchronous spawn boundary", async () => {
  const controller = new AbortController();
  const f = fixture({ signal: controller.signal });
  const kill = vi.spyOn(process, "kill");
  queueMicrotask(() => controller.abort());
  const outcome = await f.command("normal");
  expect(outcome.error).toMatchObject({ kind: "cancelled", cleanupConfirmed: true });
  expect(outcome.error?.evidence).toBeUndefined();
  expect(kill).not.toHaveBeenCalled();
});

it("handles cancellation between commands and removes signal/abort listeners and timers", async () => {
  const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  const timers = process.getActiveResourcesInfo().filter(name => name === "Timeout").length;
  const controller = new AbortController();
  const f = fixture({ signal: controller.signal });
  await f.command("normal");
  controller.abort();
  expect((await f.command("normal")).error?.kind).toBe("cancelled");
  await f.runner.close();
  expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  expect(process.getActiveResourcesInfo().filter(name => name === "Timeout").length).toBeLessThanOrEqual(timers);
});

it.each(["SIGINT", "SIGTERM"] as const)("does not start a command after a real %s received between commands", async signal => {
  const f = fixture();
  const outcome = f.command("gap");
  await expect.poll(() => f.events.some(event => event.event === "between"), { timeout: 2_000 }).toBe(true);
  const pid = f.events.find(event => event.event === "between")!.pid;
  process.kill(pid, signal);
  expect((await outcome).error).toMatchObject({ kind: "exit", cleanupConfirmed: true });
  expect(f.events.find(event => event.event === "gap-rejected")?.kind).toBe("cancelled");
});

it.each(["tree-held", "tree-closed", "orphan-held", "orphan-closed"])("reclaims %s descendants while an unrelated control remains responsive", async mode => {
  const temporary = mkdtempSync(join(tmpdir(), "gate-process-test-"));
  onTestFinished(() => rmSync(temporary, { recursive: true, force: true }));
  const controller = new AbortController();
  const f = fixture({ signal: controller.signal });
  const heartbeat = join(temporary, "owned-heartbeat");
  const controlHeartbeat = join(temporary, "control-heartbeat");
  const control = fixture();
  const controlOutcome = control.command("control", controlHeartbeat);
  await control.ready();
  const outcome = f.command(mode, heartbeat);
  await f.ready();
  await expect.poll(() => { try { return readFileSync(heartbeat, "utf8").length; } catch { return 0; } }).toBeGreaterThan(0);
  if (!mode.startsWith("orphan-")) controller.abort();
  const result = await outcome;
  expect(result.error).toMatchObject({ kind: mode.startsWith("orphan-") ? "cleanup" : "cancelled", cleanupConfirmed: true });
  const evidence = result.error!.evidence!;
  expect(evidence).toMatchObject({ exitAt: expect.any(Number), closeAt: expect.any(Number), groupGoneAt: expect.any(Number), termAttemptAt: expect.any(Number), killAttemptAt: expect.any(Number) });
  if (mode === "orphan-closed") expect(evidence.closeAt!).toBeLessThan(evidence.termAttemptAt!);
  if (mode === "orphan-held") expect(evidence.closeAt!).toBeGreaterThan(evidence.termAttemptAt!);
  const size = readFileSync(heartbeat, "utf8").length;
  const otherSize = readFileSync(controlHeartbeat, "utf8").length;
  await expect.poll(() => readFileSync(controlHeartbeat, "utf8").length).toBeGreaterThan(otherSize);
  expect(readFileSync(heartbeat, "utf8").length).toBe(size);
  process.stdout.write(JSON.stringify({ scenario: mode, events: f.events, evidence, heartbeatStopped: true, unrelatedHeartbeatAdvanced: true }) + "\n");
  expect(f.events.some(event => event.event === "insurance")).toBe(false);
  await control.runner.close();
  expect((await controlOutcome).error?.cleanupConfirmed).toBe(true);
});

it("reports uncertainty on denied termination instead of treating permission failure as exit", async () => {
  const controller = new AbortController();
  const f = fixture({ signal: controller.signal, graceMs: 50, killWaitMs: 100 });
  const outcome = f.command("hang");
  await f.ready();
  const pid = f.events.find(event => event.event === "root-ready")!.pid;
  const originalKill = process.kill.bind(process);
  const kill = vi.spyOn(process, "kill").mockImplementation((target, signal) => {
    if (target === -pid && signal !== 0) throw Object.assign(new Error("synthetic EPERM"), { code: "EPERM" });
    return originalKill(target, signal);
  });
  try {
    controller.abort();
    expect((await outcome).error).toMatchObject({ kind: "cancelled", cleanupConfirmed: false });
    expect(f.runner.cleanupConfirmed).toBe(false);
  } finally {
    kill.mockRestore();
    originalKill(-pid, "SIGKILL");
    await expect.poll(() => { try { originalKill(-pid, 0); return true; } catch { return false; } }).toBe(false);
  }
});
