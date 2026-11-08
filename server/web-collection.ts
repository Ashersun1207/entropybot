import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { commandReceipt, runCommand } from "./commands.ts";
import type { RoutineRun } from "./routines.ts";

export interface CollectionPlan {
  version: string;
  sources: Array<{ url: string; html?: string }>;
  limits: { pages: number; bytes: number; pageBytes: number; attempts: number; durationMs: number };
}

export interface CollectionReport {
  path: string;
  hash: string;
  pages: number;
  unique: number;
}

export interface CollectionOptions {
  run: Pick<RoutineRun, "id" | "routineId" | "manual">;
  requestId: string;
  plan: CollectionPlan;
  /** Existing, private, exclusively owned directory. No concurrent directory replacement is supported. */
  outputRoot: string;
  /** Read-only, bounded reader; must honor signal and pageBytes. HTML is stored as inert JSON text. */
  read: (source: CollectionPlan["sources"][number], signal: AbortSignal, pageBytes: number) => Promise<string>;
  signal: AbortSignal;
  now?: () => number;
  fault?: (phase: "reserved" | "page" | "artifact" | "completed", index: number) => void;
}

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const kind = "web-collection.v1";

export function collectionUrl(raw: string): string {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid collection URL");
  url.hash = "";
  return url.href;
}

/** Manual fixed collect/dedup/report workflow; command receipts are its only durable checkpoints. */
export async function collectWeb(options: CollectionOptions): Promise<CollectionReport> {
  const { signal, fault } = options;
  const now = options.now ?? Date.now;
  if (!options.run.manual || !options.run.id || !options.run.routineId || !options.requestId) throw new Error("Manual identity required");
  const plan: CollectionPlan = JSON.parse(JSON.stringify(options.plan));
  const { limits } = plan;
  if (!plan.version || !plan.sources.length || Object.values(limits).some(n => !Number.isSafeInteger(n) || n <= 0)
    || plan.sources.length > limits.pages || limits.pages > 100 || limits.pageBytes > 1_000_000 || limits.bytes > 10_000_000
    || limits.durationMs > 86_400_000) throw new Error("Invalid finite collection limits");
  const urls = plan.sources.map(source => collectionUrl(source.url));
  const root = realpathSync(options.outputRoot);
  const rootStat = statSync(root);
  if (root !== resolve(options.outputRoot) || !rootStat.isDirectory() || (rootStat.mode & 0o077) !== 0) throw new Error("Private output root required");
  const identity = JSON.stringify([options.run.routineId, options.run.id, options.requestId]);
  const key = digest(JSON.stringify([options.run.routineId, options.run.id]));
  const binding = digest(JSON.stringify({ identity, plan, root }));
  const receipt = <T>(suffix: string) => commandReceipt<T>(kind, `${key}:${suffix}`)?.result;
  const save = <T>(suffix: string, value: T) => runCommand({ kind, key: `${key}:${suffix}` }, () => value, now);
  const initial = save("plan", { binding, deadline: now() + limits.durationMs });
  if (initial.binding !== binding) throw new Error("Collection plan/input/identity mismatch");
  const completed = receipt<CollectionReport>("completed");
  const check = () => {
    signal.throwIfAborted();
    if (!completed && now() >= initial.deadline) throw new Error("Collection deadline exhausted");
  };
  const rows: Array<{ url: string; text: string }> = [];
  let bytes = 0;
  let attempts = 0;
  for (let index = 0; index < plan.sources.length; index++) {
    check();
    let page = receipt<{ text: string; bytes: number }>(`page:${index}`);
    if (!page) {
      if (receipt(`read:${index}`)) throw new Error("Collection read outcome unknown; reconciliation required, no resend");
      if (attempts + 1 > limits.attempts || bytes + limits.pageBytes > limits.bytes) throw new Error("Collection cumulative budget exhausted");
      let admitted = false;
      runCommand({ kind, key: `${key}:read:${index}` }, () => {
        admitted = true;
        return { binding, attempts: attempts + 1, reservedBytes: bytes + limits.pageBytes };
      }, now);
      if (!admitted) throw new Error("Collection read outcome unknown; no resend");
      fault?.("reserved", index);
      check();
      const deadline = new AbortController();
      const readerSignal = AbortSignal.any([signal, deadline.signal]);
      const timer = setTimeout(() => deadline.abort(new Error("Collection deadline exhausted")), Math.max(0, initial.deadline - now()));
      let onAbort: (() => void) | undefined;
      let text: string;
      try {
        const aborted = new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(readerSignal.reason);
          readerSignal.addEventListener("abort", onAbort, { once: true });
          if (readerSignal.aborted) onAbort();
        });
        text = await Promise.race([options.read(plan.sources[index]!, readerSignal, limits.pageBytes), aborted]);
      } finally {
        clearTimeout(timer);
        if (onAbort) readerSignal.removeEventListener("abort", onAbort);
      }
      check();
      const size = Buffer.byteLength(text);
      if (size > limits.pageBytes) throw new Error("Collection page byte limit exceeded; outcome unknown");
      page = save(`page:${index}`, { text, bytes: size });
      fault?.("page", index);
    }
    bytes += page.bytes;
    attempts++;
    if (!rows.some(row => row.url === urls[index])) rows.push({ url: urls[index]!, text: page.text });
  }
  check();
  const content = `${JSON.stringify({ version: 1, binding, pages: plan.sources.length, sources: rows }, null, 2)}\n`;
  const report: CollectionReport = { path: join(root, `${key}.json`), hash: digest(content), pages: plan.sources.length, unique: rows.length };
  const verify = () => {
    const fd = openSync(report.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== Buffer.byteLength(content) || readFileSync(fd, "utf8") !== content) throw new Error("Collection artifact conflict");
    } finally { closeSync(fd); }
  };
  if (completed) {
    if (JSON.stringify(completed) !== JSON.stringify(report)) throw new Error("Collection completion mismatch");
    verify();
    return completed;
  }
  check();
  let fd: number | undefined;
  try { fd = openSync(report.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  if (fd !== undefined) {
    try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
    const directory = openSync(root, constants.O_RDONLY);
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
  verify();
  fault?.("artifact", -1);
  check();
  const result = save("completed", report);
  fault?.("completed", -1);
  return result;
}
