import { spawn, type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";
import { startGroupHistory, type GroupCapability, type GroupHistory } from "../server/verification-group-history.ts";

type FailureKind = "exit" | "timeout" | "cancelled" | "start" | "cleanup" | "unsupported";
type Stop = { kind: "timeout" | "cancelled"; detail: string };
type Evidence = { pid: number | undefined; exitCode: number | null; signal: NodeJS.Signals | null; exitAt: number | undefined; closeAt: number | undefined; groupGoneAt: number | undefined; termAttemptAt: number | undefined; killAttemptAt: number | undefined };
type Result = { stdout: string; stderr: string; outputTruncated: boolean; evidence: Evidence };
type CommandOptions = { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number; forwardOutput?: boolean; onStdout?: (chunk: string) => void };
type RunnerOptions = { processCapability?: GroupCapability; commandTimeoutMs?: number; overallTimeoutMs?: number; graceMs?: number; killWaitMs?: number; signal?: AbortSignal; handleSignals?: boolean };
const CAPTURE_CHARS = 4_194_304;

export class GateCommandError extends Error {
  kind: FailureKind;
  ownedGroupStopped: boolean;
  evidence: Evidence | undefined;
  output: { stdout: string; stderr: string; outputTruncated: boolean } | undefined;

  constructor(kind: FailureKind, label: string, detail: string, ownedGroupStopped = true, evidence?: Evidence) {
    super(`[${kind}] ${label}: ${detail}${ownedGroupStopped ? "" : "; owned group stop uncertain"}`);
    this.name = "GateCommandError";
    this.kind = kind;
    this.ownedGroupStopped = ownedGroupStopped;
    this.evidence = evidence;
  }
}

function duration(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw new Error("Execution budgets must be positive finite timer durations");
  return value;
}

function ownedCommand(executable: string, args: readonly string[], options: CommandOptions, label: string,
  signal: AbortSignal, timeoutMs: number, graceMs: number, killWaitMs: number, processCapability?: GroupCapability): Promise<Result> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      const reason = signal.reason as Stop;
      reject(new GateCommandError(reason.kind, label, reason.detail));
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn(executable, [...args], { cwd: options.cwd, env: options.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(new GateCommandError("start", label, String(error)));
      return;
    }
    let history: GroupHistory | undefined;
    let spawned = false;
    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let closed = false;
    let groupGone = false;
    let exitAt = 0;
    let closeAt: number | undefined;
    let groupGoneAt: number | undefined;
    let termAttemptAt: number | undefined;
    let killAttemptAt: number | undefined;
    let stoppingAt: number | undefined;
    let softSent = false;
    let escalated = false;
    let settled = false;
    let failure: { kind: FailureKind; detail: string } | undefined;
    let stdout = "";
    let stderr = "";
    let signalError = "";
    let outputTruncated = false;
    const streams: Array<[NodeJS.ReadableStream, (chunk: string) => void]> = [];
    const errorStreams: NodeJS.EventEmitter[] = [];
    const ownedGroup = () => Number.isSafeInteger(child.pid) && child.pid! > 1 && child.pid !== process.pid;
    const alive = () => {
      if (groupGone || !spawned || !child.pid) return false;
      if (!ownedGroup()) { signalError = "refused invalid owned process group"; return true; }
      try { process.kill(-child.pid, 0); return true; } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") { groupGone = true; groupGoneAt = performance.now(); return false; }
        signalError = String(error);
        return true;
      }
    };
    const send = (name: NodeJS.Signals) => {
      if (!alive() || !child.pid || !ownedGroup()) return;
      if (name === "SIGTERM") termAttemptAt = performance.now();
      else killAttemptAt = performance.now();
      try { process.kill(-child.pid, name); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") { groupGone = true; groupGoneAt = performance.now(); }
        else signalError = String(error);
      }
    };
    const beginCleanup = () => {
      if (settled) return;
      stoppingAt ??= performance.now();
      if (spawned && !softSent) {
        softSent = true;
        send("SIGTERM");
      }
    };
    const stop = (kind: FailureKind, detail: string) => {
      if (settled) return;
      failure ??= { kind, detail };
      beginCleanup();
    };
    const abort = () => {
      const reason = signal.reason as Stop;
      stop(reason.kind, reason.detail);
    };
    const finish = async (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      signal.removeEventListener("abort", abort);
      child.removeListener("spawn", onSpawn);
      child.removeListener("exit", onExit);
      child.removeListener("close", onClose);
      child.removeListener("error", onError);
      for (const [stream, listener] of streams) stream.removeListener("data", listener);
      for (const stream of errorStreams) stream.removeListener("error", onOutputError);
      if (!confirmed) {
        failure ??= { kind: "cleanup", detail: "command exited but descendants or output streams remain active after cleanup budget" };
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
      }
      try { await history?.finish(confirmed); }
      catch (error) { failure ??= { kind: "cleanup", detail: `process history persistence failed: ${String(error)}` }; }
      const evidence = { pid: child.pid, exitCode, signal: exitSignal, exitAt: exited ? exitAt : undefined, closeAt, groupGoneAt, termAttemptAt, killAttemptAt };
      if (failure) {
        const error = new GateCommandError(failure.kind, label, `${failure.detail}${signalError ? `; ${signalError}` : ""}`, confirmed, evidence);
        error.output = { stdout, stderr, outputTruncated };
        reject(error);
      } else resolve({ stdout, stderr, outputTruncated, evidence });
    };
    const check = () => {
      const running = alive();
      if ((exited || !spawned && closed) && closed && !running) { finish(true); return; }
      if (exited && stoppingAt === undefined && performance.now() - exitAt >= 250) beginCleanup();
      if (stoppingAt === undefined) return;
      const elapsed = performance.now() - stoppingAt;
      if (!escalated && elapsed >= graceMs) { escalated = true; send("SIGKILL"); }
      if (elapsed >= graceMs + killWaitMs) finish(false);
    };
    const onSpawn = () => {
      spawned = true;
      try {
        history = startGroupHistory(child, processCapability, "gate-command-runner");
        void history.ready.catch(error => stop("cleanup", `process history capture failed: ${String(error)}`));
      } catch (error) { stop("cleanup", `process history creation failed: ${String(error)}`); }
      if (signal.aborted) abort();
      else if (failure) stop(failure.kind, failure.detail);
    };
    const onExit = (code: number | null, observedSignal: NodeJS.Signals | null) => {
      exited = true;
      exitCode = code;
      exitSignal = observedSignal;
      exitAt = performance.now();
      if (code !== 0) stop("exit", `exit code ${code}, signal ${observedSignal ?? "none"}`);
    };
    const onClose = () => { closed = true; closeAt = performance.now(); };
    const onError = (error: Error) => { stop("start", error.message); };
    const onOutputError = (error: Error) => { stop("exit", `output stream failed: ${error.message}`); };
    child.on("spawn", onSpawn);
    child.on("exit", onExit);
    child.on("close", onClose);
    child.on("error", onError);
    for (const [stream, name] of [[child.stdout, "stdout"], [child.stderr, "stderr"]] as const) {
      if (!stream) continue;
      stream.setEncoding("utf8");
      const listener = (chunk: string) => {
        if (!outputTruncated && (name === "stdout" ? stdout : stderr).length + chunk.length > CAPTURE_CHARS) {
          outputTruncated = true;
          if (options.forwardOutput !== false) console.error(`[output] ${label}: captured output truncated to its last ${CAPTURE_CHARS} characters per stream`);
        }
        if (name === "stdout") stdout = (stdout + chunk).slice(-CAPTURE_CHARS);
        else stderr = (stderr + chunk).slice(-CAPTURE_CHARS);
        if (options.forwardOutput !== false) {
          try { process[name].write(chunk); } catch (error) { onOutputError(error as Error); }
        }
        if (name === "stdout" && options.onStdout) {
          try { options.onStdout(chunk); } catch (error) { stop("exit", `output observer failed: ${String(error)}`); }
        }
      };
      stream.on("data", listener);
      streams.push([stream, listener]);
      stream.on("error", onOutputError);
      errorStreams.push(stream);
    }
    if (options.forwardOutput !== false) for (const stream of [process.stdout, process.stderr]) {
      stream.on("error", onOutputError);
      errorStreams.push(stream);
    }
    const timer = setTimeout(() => stop("timeout", `command budget ${timeoutMs}ms exceeded`), timeoutMs);
    const poll = setInterval(check, 25);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export class GateCommandRunner {
  ownedGroupStopped = true;
  private controller = new AbortController();
  private active: Promise<Result> | undefined;
  private failure: unknown;
  private closed = false;
  private processCapability?: GroupCapability;
  private commandTimeoutMs: number;
  private graceMs: number;
  private killWaitMs: number;
  private overallTimer: NodeJS.Timeout;
  private deadline: number;
  private removers: Array<() => void> = [];

  constructor(options: RunnerOptions = {}) {
    this.processCapability = options.processCapability;
    if (!["darwin", "linux", "freebsd", "openbsd", "netbsd"].includes(process.platform)) {
      throw new GateCommandError("unsupported", "patch gate", `owned process-group containment unavailable on ${process.platform}; no command started`);
    }
    this.commandTimeoutMs = duration(options.commandTimeoutMs ?? 600_000);
    this.graceMs = duration(options.graceMs ?? 3_000);
    this.killWaitMs = duration(options.killWaitMs ?? 3_000);
    const overallTimeoutMs = duration(options.overallTimeoutMs ?? 900_000);
    this.deadline = performance.now() + overallTimeoutMs;
    this.overallTimer = setTimeout(() => this.cancel({ kind: "timeout", detail: `overall budget ${overallTimeoutMs}ms exceeded` }), overallTimeoutMs);
    if (options.handleSignals !== false) {
      for (const name of ["SIGINT", "SIGTERM"] as const) {
        const listener = () => this.cancel({ kind: "cancelled", detail: `received ${name}` });
        process.on(name, listener);
        this.removers.push(() => process.removeListener(name, listener));
      }
    }
    if (options.signal) {
      const signal = options.signal;
      const abort = () => this.cancel({ kind: "cancelled", detail: "caller aborted execution" });
      signal.addEventListener("abort", abort, { once: true });
      this.removers.push(() => signal.removeEventListener("abort", abort));
      if (signal.aborted) abort();
    }
  }

  private cancel(reason: Stop) {
    if (!this.controller.signal.aborted) this.controller.abort(reason);
  }

  assertActive() {
    if (this.failure) throw this.failure;
    if (this.closed) throw new Error("Command runner already closed");
    if (performance.now() >= this.deadline) this.cancel({ kind: "timeout", detail: "overall execution budget exceeded" });
    if (this.controller.signal.aborted) {
      const reason = this.controller.signal.reason as Stop;
      throw new GateCommandError(reason.kind, "patch gate", reason.detail);
    }
  }

  async run(executable: string, args: readonly string[], options: CommandOptions, label = executable): Promise<Result> {
    this.assertActive();
    if (this.active) throw new Error("Command runner executes one owned command at a time");
    const requestedTimeoutMs = duration(options.timeoutMs ?? this.commandTimeoutMs);
    this.active = (async () => {
      await new Promise<void>(resolve => setImmediate(resolve));
      this.assertActive();
      const timeoutMs = Math.min(requestedTimeoutMs, Math.max(1, Math.ceil(this.deadline - performance.now())));
      return ownedCommand(executable, args, options, label, this.controller.signal, timeoutMs, this.graceMs, this.killWaitMs, this.processCapability);
    })();
    try {
      return await this.active;
    } catch (error) {
      this.failure = error;
      if (error instanceof GateCommandError && !error.ownedGroupStopped) this.ownedGroupStopped = false;
      throw error;
    } finally { this.active = undefined; }
  }

  async close() {
    if (this.active) {
      this.cancel({ kind: "cancelled", detail: "runner closed during execution" });
      await this.active.catch(() => {});
    }
    clearTimeout(this.overallTimer);
    for (const remove of this.removers.splice(0)) remove();
    this.closed = true;
  }
}
