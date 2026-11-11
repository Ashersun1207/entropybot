import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { listProcesses } from "./browser/chrome/processes.ts";

export type GroupBinding = { sourceSha: string; runId: string; attempt: string; group: string };
export type GroupCapability = { directory: string; gateNonce: string; secret: string; processBinding?: GroupBinding };
export type GroupIdentity = { kind: "verification-process-group"; pid: number; pgid: number; startTime: string | null; ownerPid: number; ownerStartTime: string | null; launchedAt: string; gateNonce: string; binding: GroupBinding; creator: string; status: "pending" | "stopped" | "unknown" };
export type GroupHistory = { ready: Promise<void>; finish: (stopped: boolean) => Promise<void> };

function owned(path: string, directory: boolean) {
  const stat = lstatSync(path);
  if (realpathSync(path) !== path || (directory ? !stat.isDirectory() : !stat.isFile()) || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error("Unsafe verification process history path");
}
export function groupHistoryDirectory(capability: GroupCapability): string {
  const home = dirname(capability.directory);
  if (realpathSync(home) !== home) throw new Error("Noncanonical process history home");
  owned(home, true);
  const directory = join(home, "verification-processes");
  try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  owned(directory, true);
  return directory;
}
function mac(capability: GroupCapability, payload: string) { return createHmac("sha256", capability.secret).update(payload).digest("hex"); }
export function readGroupHistory(capability: GroupCapability): { files: string[]; identities: GroupIdentity[] } {
  const directory = groupHistoryDirectory(capability);
  const names = readdirSync(directory).sort();
  if (names.length > 64) throw new Error("Process history file budget exceeded");
  const files = names.map(name => {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) throw new Error("Unfinished process history write");
    return join(directory, name);
  });
  return { files, identities: files.map(file => readGroupIdentity(capability, file)) };
}
export function readGroupIdentity(capability: GroupCapability, file: string): GroupIdentity {
  if (dirname(file) !== groupHistoryDirectory(capability)) throw new Error("Foreign process history file");
  owned(file, false);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  let frame: { payload: string; mac: string };
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65536) throw new Error("Invalid process history file");
    frame = JSON.parse(readFileSync(fd, "utf8")) as typeof frame;
  } finally { closeSync(fd); }
  if (typeof frame.payload !== "string" || !/^[a-f0-9]{64}$/.test(frame.mac) || !timingSafeEqual(Buffer.from(mac(capability, frame.payload), "hex"), Buffer.from(frame.mac, "hex"))) throw new Error("Unauthenticated process history");
  const row = JSON.parse(frame.payload) as GroupIdentity;
  if (row.kind !== "verification-process-group" || row.gateNonce !== capability.gateNonce || JSON.stringify(row.binding) !== JSON.stringify(capability.processBinding)
    || !Number.isSafeInteger(row.pid) || row.pid <= 1 || row.pgid !== row.pid || !Number.isSafeInteger(row.ownerPid) || row.ownerPid <= 0
    || !["pending", "stopped", "unknown"].includes(row.status) || !row.creator || !Number.isFinite(Date.parse(row.launchedAt))) throw new Error("Invalid process history identity");
  return row;
}
export function groupPresence(pgid: number): boolean | null {
  if (!Number.isSafeInteger(pgid) || pgid <= 1) return null;
  try { process.kill(-pgid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" ? false : null; }
}

export function startGroupHistory(child: ChildProcess, capability: GroupCapability | undefined, creator: string): GroupHistory {
  if (!capability?.processBinding) return { ready: Promise.resolve(), async finish() {} };
  const file = join(groupHistoryDirectory(capability), `${randomUUID()}.json`);
  if (!child.pid || child.pid <= 1) throw new Error("Process history requires a spawned PID");
  const row: GroupIdentity = { kind: "verification-process-group", pid: child.pid, pgid: child.pid, startTime: null, ownerPid: process.pid, ownerStartTime: null,
    launchedAt: new Date().toISOString(), gateNonce: capability.gateNonce, binding: capability.processBinding, creator, status: "pending" };
  const persist = () => {
    const payload = JSON.stringify(row);
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({ kind: row.kind, payload, mac: mac(capability, payload) }), { mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
  };
  persist();
  const ready = (async () => {
    const rows = await listProcesses();
    row.startTime = rows?.find(p => p.pid === row.pid)?.startTime ?? null;
    row.ownerStartTime = rows?.find(p => p.pid === process.pid)?.startTime ?? null;
    if (!row.startTime || !row.ownerStartTime) row.status = "unknown";
    persist();
  })();
  return { ready, async finish(stopped) {
    await ready;
    if (row.status === "unknown") return;
    if (row.status === "stopped") { if (!stopped) { row.status = "unknown"; persist(); } return; }
    const rows = await listProcesses();
    row.status = stopped && rows && !rows.some(p => p.pid === row.pid) && groupPresence(row.pgid) === false ? "stopped" : "unknown";
    persist();
  } };
}
