import type { ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";

export type VerificationIdentity = { version: 1; gateNonce: string; fixtureNonce: string; serverNonce: string; generation: number; dataDir: string };
export type VerificationReceipt = { type: "verification:stopped"; identity: VerificationIdentity; serverPid: number; status: "stopped" | "unknown"; registered: number; confirmed: number; reason?: string };
export type VerificationTransport = (message: unknown, budgetMs: number) => Promise<boolean>;

export function sameVerificationIdentity(a: VerificationIdentity | undefined, b: VerificationIdentity): boolean {
  return a?.version === 1 && a.gateNonce === b.gateNonce && a.fixtureNonce === b.fixtureNonce && a.serverNonce === b.serverNonce && a.generation === b.generation && a.dataDir === b.dataDir;
}

export function validVerificationIdentity(value: unknown): value is VerificationIdentity {
  if (!value || typeof value !== "object") return false;
  const v = value as VerificationIdentity;
  return v.version === 1 && /^[a-f0-9-]{36}$/.test(v.gateNonce) && /^[a-f0-9-]{36}$/.test(v.fixtureNonce) && /^[a-f0-9-]{36}$/.test(v.serverNonce)
    && Number.isSafeInteger(v.generation) && v.generation > 0 && typeof v.dataDir === "string" && v.dataDir.length > 0;
}

export class VerificationProcessScope {
  private records = new Map<ChildProcess, { stop: (graceMs: number) => Promise<boolean>; pending?: Promise<boolean>; close: () => void; error: () => void }>();
  private sealed = false;
  private disposed = false;
  private registered = 0;
  private confirmed = 0;
  private failure = "";
  private draining: Promise<VerificationReceipt> | undefined;
  private shutdownPromise: Promise<void> | undefined;
  readonly identity: VerificationIdentity;
  private transport: VerificationTransport;

  constructor(identity: VerificationIdentity, transport: VerificationTransport) {
    if (!validVerificationIdentity(identity)) throw new Error("Invalid verification scope identity");
    this.identity = Object.freeze({ ...identity });
    this.transport = transport;
    if (!["darwin", "linux", "freebsd", "openbsd", "netbsd"].includes(process.platform)) this.failure = `verification CLI tree confirmation unsupported on ${process.platform}`;
  }

  assertSpawnAllowed() {
    if (this.sealed || this.disposed) throw new Error("Verification resource scope is sealed; CLI was not spawned");
  }

  register(child: ChildProcess, stop: (graceMs: number) => Promise<boolean>) {
    this.assertSpawnAllowed();
    if (this.records.has(child)) throw new Error("Verification CLI already registered");
    this.track(child, stop);
  }

  registrationFailed(child: ChildProcess, stop: (graceMs: number) => Promise<boolean>) {
    this.failure ||= "CLI registration failed after creation";
    if (!this.records.has(child)) this.track(child, stop);
    void this.confirm(child, 0);
  }

  private track(child: ChildProcess, stop: (graceMs: number) => Promise<boolean>) {
    const close = () => { void this.confirm(child, 0); };
    const error = () => {
      if (child.pid) this.failure ||= "registered CLI reported a process error";
      else void this.confirm(child, 0);
    };
    this.records.set(child, { stop, close, error });
    this.registered++;
    child.once("close", close);
    child.once("error", error);
  }

  private confirm(child: ChildProcess, graceMs: number): Promise<boolean> {
    const record = this.records.get(child);
    if (!record || this.disposed) return Promise.resolve(false);
    if (record.pending) return record.pending;
    const pending = Promise.resolve().then(() => record.stop(graceMs)).then(stopped => {
      if (stopped && !this.disposed && this.records.get(child) === record) {
        child.removeListener("close", record.close);
        child.removeListener("error", record.error);
        this.records.delete(child);
        this.confirmed++;
      }
      return stopped;
    }, () => { this.failure ||= "CLI stop rejected"; return false; });
    record.pending = pending;
    return pending;
  }

  receipt(reason = this.failure): VerificationReceipt {
    if (reason) this.failure ||= reason;
    reason = this.failure;
    const stopped = this.sealed && !reason && this.records.size === 0 && this.confirmed === this.registered;
    return { type: "verification:stopped", identity: this.identity, serverPid: process.pid, status: stopped ? "stopped" : "unknown",
      registered: this.registered, confirmed: this.confirmed, ...(reason || !stopped ? { reason: reason || "resources not confirmed" } : {}) };
  }

  seal() { this.sealed = true; }

  externalStopInventory(): { groups: number[]; reason?: string } {
    this.seal();
    const groups = [...this.records.keys()].map(child => child.pid);
    const reason = this.failure || (groups.some(pid => !Number.isSafeInteger(pid) || pid! <= 1) ? "Unidentified verification CLI" : "");
    return { groups: groups.filter((pid): pid is number => pid !== undefined), ...(reason ? { reason } : {}) };
  }

  drain(budgetMs = 2_000, graceMs = 500): Promise<VerificationReceipt> {
    if (this.draining) return this.draining;
    this.seal();
    this.draining = (async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        const done = Promise.all([...this.records.keys()].map(child => this.confirm(child, graceMs))).then(values => values.every(Boolean));
        const complete = await Promise.race([done, new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), Math.max(1, budgetMs)); })]);
        return this.receipt(complete ? this.failure : "CLI drain failed or exceeded its deadline");
      } finally { clearTimeout(timer); }
    })();
    return this.draining;
  }

  shutdown(cleanup: ReadonlyArray<() => void | Promise<void>>, exit: (code: number) => void, timeoutMs: number): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.seal();
    this.shutdownPromise = (async () => {
      const deadline = performance.now() + timeoutMs;
      let timer: NodeJS.Timeout | undefined;
      let flushTimer: NodeJS.Timeout | undefined;
      try {
        const settled = Promise.all([Promise.allSettled(cleanup.map(job => Promise.resolve().then(job))), this.drain(Math.min(2_000, Math.max(1, timeoutMs - 250)))]).then(([jobs, receipt]) =>
          jobs.some(job => job.status === "rejected") ? this.receipt(`shutdown cleanup rejected at job ${jobs.findIndex(job => job.status === "rejected")}`) : receipt);
        const receipt = await Promise.race([settled, new Promise<VerificationReceipt>(resolve => {
          timer = setTimeout(() => resolve(this.receipt("shutdown deadline exceeded")), Math.max(1, timeoutMs - 250));
        })]);
        const flushBudget = Math.max(1, Math.min(250, deadline - performance.now()));
        const sent = await Promise.race([Promise.resolve().then(() => this.transport(receipt, flushBudget)).catch(() => false),
          new Promise<false>(resolve => { flushTimer = setTimeout(() => resolve(false), flushBudget); })]);
        if (!sent) this.failure ||= "verification receipt flush failed";
        exit(sent && receipt.status === "stopped" ? 0 : 1);
      } finally { clearTimeout(timer); clearTimeout(flushTimer); this.dispose(); }
    })();
    return this.shutdownPromise;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [child, record] of this.records) {
      child.removeListener("close", record.close);
      child.removeListener("error", record.error);
    }
    this.records.clear();
  }
}

let scope: VerificationProcessScope | undefined;

export function installVerificationProcessScope(identity: VerificationIdentity, transport: VerificationTransport) {
  if (scope) throw new Error("Verification scope already installed");
  scope = new VerificationProcessScope(identity, transport);
  return scope;
}

export function verificationProcessScope() { return scope; }
