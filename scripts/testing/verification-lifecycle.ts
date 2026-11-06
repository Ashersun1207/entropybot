import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { sameVerificationIdentity, validVerificationIdentity, type VerificationIdentity, type VerificationReceipt } from "../../server/verification-process-scope.ts";

const CAP_SLOT = Symbol.for("entropybot.verification.gate.bootstrap.v1");
export type GateCapability = { version: 1; directory: string; gateNonce: string; secret: string };
type Bootstrap = { capability: GateCapability; fileNonce?: string };
type LeasePayload = { gateNonce: string; kind: "fixture" | "file"; identity: VerificationIdentity | { file: string; fileNonce: string }; owner?: string; status: "pending" | "stopped" | "unknown"; reason?: string };
type Lease = { update: (status: LeasePayload["status"], reason?: string) => void };

export function consumeGateCapability(): GateCapability | undefined {
  const host = process.getBuiltinModule("process") as NodeJS.Process & { [key: symbol]: unknown };
  const encoded = new URL(import.meta.url).searchParams.get("gate");
  if (encoded) {
    const capability = JSON.parse(readFileSync(encoded, "utf8")) as GateCapability;
    if (capability.version !== 1 || !/^[a-f0-9]{64}$/.test(capability.secret) || typeof capability.gateNonce !== "string"
      || realpathSync(capability.directory) !== capability.directory) throw new Error("Invalid gate capability");
    const previous = host[CAP_SLOT] as Bootstrap | undefined;
    if (previous && previous.capability.gateNonce !== capability.gateNonce) throw new Error("Gate bootstrap capability cannot be replaced");
    if (!previous) {
      const state: Bootstrap = { capability: Object.freeze(capability), fileNonce: undefined };
      Object.defineProperty(state, "capability", { writable: false, configurable: false });
      Object.seal(state);
      Object.defineProperty(host, CAP_SLOT, { value: state, configurable: false });
    }
  }
  const state = host[CAP_SLOT] as Bootstrap | undefined;
  if (state && !state.capability) throw new Error("Managed gate capability missing");
  return state?.capability;
}

consumeGateCapability();
const toolManager = process.argv[1]?.replaceAll("\\", "/").endsWith("/vitest/vitest.mjs") || !process.argv[1] && process.execArgv.includes("--test");
if (new URL(import.meta.url).searchParams.has("gate") && !toolManager) {
  for (const argv of new Set([process.execArgv, process.getBuiltinModule("process").execArgv])) {
    for (let index = argv.length - 1; index >= 0; index--) {
      if (argv[index]?.includes("verification-lifecycle.ts") && argv[index].includes("gate=")) {
        if (index > 0 && argv[index - 1] === "--import") argv.splice(index - 1, 2);
        else argv.splice(index, 1);
      }
    }
  }
}

export function createGateCapability(home: string): GateCapability {
  const directory = join(realpathSync(home), "verification-leases");
  mkdirSync(directory, { mode: 0o700 });
  const capability: GateCapability = { version: 1, directory, gateNonce: randomUUID(), secret: randomBytes(32).toString("hex") };
  writeFileSync(join(realpathSync(home), "verification-bootstrap.json"), JSON.stringify(capability), { flag: "wx", mode: 0o600 });
  return capability;
}

export function gateBootstrapArgs(capability: GateCapability): string[] {
  const url = new URL(import.meta.url);
  url.search = "";
  url.searchParams.set("gate", join(dirname(capability.directory), "verification-bootstrap.json"));
  return ["--import", url.href];
}

export function gateVitestWorkerArg(capability: GateCapability): string {
  return `--execArgv=--import=${gateBootstrapArgs(capability)[1]}`;
}

function signature(capability: GateCapability, payload: string): string {
  return createHmac("sha256", capability.secret).update(payload).digest("hex");
}

function createLease(kind: LeasePayload["kind"], identity: LeasePayload["identity"], capability: GateCapability | undefined, owner?: string): Lease {
  if (!capability) return { update() {} };
  identity = Object.freeze({ ...identity });
  const path = join(capability.directory, `${randomUUID()}.json`);
  let previous: LeasePayload["status"] = "pending";
  const update = (status: LeasePayload["status"], reason?: string) => {
    if (previous === "unknown" && status !== "unknown") throw new Error("Unknown verification lease is terminal");
    if (previous === "stopped" && status === "pending") throw new Error("Stopped verification lease cannot reopen");
    const payload = JSON.stringify({ gateNonce: capability.gateNonce, kind, identity, owner, status, ...(reason ? { reason } : {}) } satisfies LeasePayload);
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({ payload, mac: signature(capability, payload) }), { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
    previous = status;
  };
  update("pending");
  return { update };
}

export function createVerificationLease(identity: VerificationIdentity, capability: GateCapability | null | undefined = consumeGateCapability()): Lease {
  const host = process.getBuiltinModule("process") as NodeJS.Process & { [key: symbol]: unknown };
  if (capability && identity.gateNonce !== capability.gateNonce) throw new Error("Fixture lease gate identity mismatch");
  return createLease("fixture", identity, capability ?? undefined, (host[CAP_SLOT] as Bootstrap | undefined)?.fileNonce);
}

function readLease(capability: GateCapability, file: string): LeasePayload {
  const frame = JSON.parse(readFileSync(join(capability.directory, file), "utf8")) as { payload: string; mac: string };
  const expected = signature(capability, frame.payload);
  if (!/^[a-f0-9]{64}$/.test(frame.mac) || !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(frame.mac, "hex"))) throw new Error("Unauthenticated verification lease");
  const payload = JSON.parse(frame.payload) as LeasePayload;
  if (payload.gateNonce !== capability.gateNonce) throw new Error("Stale gate lease");
  if (payload.kind === "fixture") {
    if (!validVerificationIdentity(payload.identity) || payload.identity.gateNonce !== capability.gateNonce || !isAbsolute(payload.identity.dataDir)) throw new Error("Invalid fixture lease identity");
  } else if (payload.kind !== "file" || !("file" in payload.identity) || !isAbsolute(payload.identity.file) || !/^[a-f0-9-]{36}$/.test(payload.identity.fileNonce)) throw new Error("Invalid file lease identity");
  return payload;
}

export function beginGateFile(file: string | undefined): () => void {
  const capability = consumeGateCapability();
  if (!capability) return () => {};
  if (!file) throw new Error("Managed gate file identity missing");
  const host = process.getBuiltinModule("process") as NodeJS.Process & { [key: symbol]: unknown };
  const state = host[CAP_SLOT] as Bootstrap;
  const fileNonce = randomUUID();
  state.fileNonce = fileNonce;
  const lease = createLease("file", { file: realpathSync(file), fileNonce }, capability);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const pending = readdirSync(capability.directory).filter(name => name.endsWith(".json")).map(name => readLease(capability, name))
      .some(payload => payload.kind === "fixture" && payload.owner === fileNonce && payload.status !== "stopped");
    lease.update(pending ? "unknown" : "stopped", pending ? "file left unfinished fixture resources" : undefined);
    if (state.fileNonce === fileNonce) state.fileNonce = undefined;
    if (pending) throw new Error("Managed file left unfinished verification resources");
  };
}

export function assertGateLeases(capability: GateCapability, expectedFiles: readonly string[] = []): number {
  const files = readdirSync(capability.directory);
  const completedFiles = new Set<string>();
  for (const file of files) {
    if (!/^[a-f0-9-]{36}\.json$/.test(file)) throw new Error("Unfinished verification lease write");
    const payload = readLease(capability, file);
    if (payload.status !== "stopped") throw new Error("Verification fixture resources pending or unknown");
    if (payload.kind === "file" && "file" in payload.identity) completedFiles.add(payload.identity.file);
  }
  for (const file of expectedFiles) if (!completedFiles.has(realpathSync(file))) throw new Error(`Managed bootstrap/file confirmation missing: ${file}`);
  return files.length;
}

type LaunchOptions = { cwd: string; env: NodeJS.ProcessEnv; log: number };
type Generation = {
  identity: VerificationIdentity; child: ChildProcess; lease: Lease; spawned: boolean; exited: boolean; closed: boolean;
  ready: boolean; problem?: string; receipt?: VerificationReceipt; stop?: Promise<void>; detach: () => void;
};

export class VerificationLifecycle {
  readonly dataDir: string;
  readonly fixtureNonce = randomUUID();
  private generation = 0;
  private current: Generation | undefined;
  private closing: Promise<void> | undefined;
  private starting = false;
  private capability: GateCapability | null | undefined;
  private gateNonce: string;
  private initTimeoutMs: number;
  private stopTimeoutMs: number;

  constructor(options: { tempRoot?: string; capability?: GateCapability | null; initTimeoutMs?: number; stopTimeoutMs?: number } = {}) {
    this.capability = options.capability === null ? null : options.capability ?? consumeGateCapability();
    this.gateNonce = this.capability?.gateNonce ?? randomUUID();
    this.initTimeoutMs = options.initTimeoutMs ?? 3_000;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 8_000;
    if (![this.initTimeoutMs, this.stopTimeoutMs].every(value => Number.isSafeInteger(value) && value > 0 && value <= 30_000)) throw new Error("Invalid fixture lifecycle budget");
    this.dataDir = mkdtempSync(join(options.tempRoot ?? tmpdir(), "entropybot-verify-data-"));
  }

  get child(): ChildProcess {
    if (!this.current) throw new Error("Verification server has not started");
    return this.current.child;
  }

  get identity(): VerificationIdentity {
    if (!this.current) throw new Error("Verification server has not started");
    return this.current.identity;
  }

  async start(args: readonly string[], options: LaunchOptions): Promise<ChildProcess> {
    if (this.starting) throw new Error("Verification generation transition in progress");
    if (this.closing) throw new Error("Verification fixture already closed");
    if (this.current && !this.current.stop) throw new Error("Previous verification generation has not stopped");
    this.starting = true;
    try {
      if (this.current?.stop) await this.current.stop;
      if (this.closing) throw new Error("Verification fixture already closed");
      return await this.spawnGeneration(args, options);
    } finally { this.starting = false; }
  }

  private async spawnGeneration(args: readonly string[], options: LaunchOptions): Promise<ChildProcess> {
    const identity: VerificationIdentity = Object.freeze({ version: 1, gateNonce: this.gateNonce, fixtureNonce: this.fixtureNonce, serverNonce: randomUUID(), generation: ++this.generation, dataDir: realpathSync(this.dataDir) });
    const lease = createVerificationLease(identity, this.capability);
    let child: ChildProcess;
    try {
      child = spawn(process.execPath, ["--import", fileURLToPath(new URL("./verification-server-preload.ts", import.meta.url)), ...args], {
        cwd: options.cwd, env: options.env, stdio: ["ignore", options.log, options.log, "ipc"],
      });
    } catch (error) { lease.update("stopped"); throw error; }
    const state: Generation = { identity, child, lease, spawned: false, exited: false, closed: false, ready: false, detach() {} };
    this.current = state;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let initSent = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) { state.problem ??= error.message; reject(error); } else resolve();
      };
      const timer = setTimeout(() => finish(new Error("Verification INIT acknowledgement timed out")), this.initTimeoutMs);
      const message = (value: unknown) => {
        const envelope = value as { type?: string; serverPid?: number };
        if (envelope?.type === "verification:awaiting-init") {
          if (initSent || settled && !state.ready) return;
          if (envelope.serverPid !== child.pid) { finish(new Error("Verification bootstrap process mismatch")); return; }
          initSent = true;
          try { child.send({ type: "verification:init", identity }, error => { if (error) finish(error); }); }
          catch (error) { finish(error as Error); }
          return;
        }
        const frame = value as VerificationReceipt | { type: "verification:ready"; identity: VerificationIdentity; serverPid: number };
        if (!frame || !["verification:ready", "verification:stopped"].includes(frame.type)) return;
        if (!sameVerificationIdentity(frame.identity, identity) || frame.serverPid !== child.pid) {
          state.problem = "Verification receipt identity mismatch";
          finish(new Error(state.problem));
          return;
        }
        if (frame.type === "verification:ready") { state.ready = true; finish(); }
        else {
          if (!state.ready || !Number.isSafeInteger(frame.registered) || frame.registered < 0 || frame.confirmed !== frame.registered || frame.status !== "stopped") {
            state.problem = `Verification resources unknown or receipt invalid: ${frame.reason ?? "counts/status mismatch"}`;
          }
          state.receipt = frame;
        }
      };
      const spawned = () => {
        state.spawned = true;
      };
      const error = (value: Error) => { state.problem = value.message; finish(value); };
      const exited = () => { state.exited = true; };
      const closed = () => { state.closed = true; finish(new Error("Verification server closed before INIT acknowledgement")); };
      child.once("spawn", spawned);
      child.on("error", error);
      child.once("exit", exited);
      child.once("close", closed);
      child.on("message", message);
      state.detach = () => {
        clearTimeout(timer);
        child.removeListener("spawn", spawned); child.removeListener("error", error);
        child.removeListener("exit", exited); child.removeListener("close", closed); child.removeListener("message", message);
      };
    });
    return child;
  }

  stop(): Promise<void> {
    const state = this.current;
    if (!state) return Promise.resolve();
    if (state.stop) return state.stop;
    state.stop = (async () => {
      const deadline = performance.now() + this.stopTimeoutMs;
      let killed = false;
      try {
        if (!state.exited && state.spawned) state.child.kill("SIGTERM");
        while (!state.closed || state.spawned && !state.exited) {
          if (performance.now() >= deadline) throw new Error("Verification server exit/close deadline exceeded");
          if (!killed && performance.now() >= deadline - Math.min(1_000, this.stopTimeoutMs / 2)) {
            killed = true;
            if (!state.exited) state.child.kill("SIGKILL");
          }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        if (state.spawned && (!state.ready || state.problem || state.receipt?.status !== "stopped" || state.child.exitCode !== 0)) throw new Error(state.problem ?? "Verification internal stop receipt missing or server exit unsuccessful");
        state.lease.update("stopped");
      } catch (error) {
        try { state.lease.update("unknown", error instanceof Error ? error.message : "fixture stop failed"); }
        catch { console.error("Could not persist unknown verification lease"); }
        try { writeFileSync(join(this.dataDir, "verification-stop-unknown.json"), JSON.stringify({ identity: state.identity, reason: String(error), receipt: state.receipt, localServerExited: state.exited, localServerClosed: state.closed }), { mode: 0o600 }); } catch {}
        state.child.unref(); state.child.channel?.unref();
        throw error;
      } finally { state.detach(); }
    })();
    return state.stop;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      await this.stop();
      try { rmSync(this.dataDir, { recursive: true, force: true }); } catch (error) {
        try { this.current?.lease.update("unknown", "fixture directory removal failed"); }
        catch { console.error("Could not persist verification removal failure"); }
        throw error;
      }
    })();
    return this.closing;
  }
}
