import { realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { listProcesses, userDataDirOf } from "../../server/browser/chrome/processes.ts";
import { digest, insist, source, unchanged } from "./core.mjs";
import { regularBytes } from "./artifact-input.mjs";

const DOMAIN = "declared-registry-identities-and-owned-home-profile-arguments";
const BLIND_SPOTS = ["unregistered processes without owned-home profile arguments", "normal internal detached CLI groups not durably inventoried", "descendants that change arguments or escape observed identities", "PID reuse and same-second POSIX start-time collisions", "same-UID tampering and races between observations", "OS-hidden or unreadable process entries and noncanonical profile argument aliases", "files, sockets, remote resources and kernel I/O hard deadlines"];
const POSIX = ["darwin", "linux", "freebsd", "openbsd", "netbsd"];
function inside(root, path) {
  if (typeof path !== "string" || !isAbsolute(path)) return false;
  const rel = relative(root, resolve(path));
  return rel !== "" && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
}
function registered(row, home) {
  return row && Number.isSafeInteger(row.pid) && row.pid > 1 && Number.isSafeInteger(row.ownerPid) && row.ownerPid > 0
    && typeof row.startTime === "string" && row.startTime.length > 0 && typeof row.launchedAt === "string" && inside(home, row.userDataDir);
}
function listed(row) {
  return row && Number.isSafeInteger(row.pid) && row.pid > 0 && Number.isSafeInteger(row.ppid) && row.ppid >= 0
    && typeof row.startTime === "string" && row.startTime.length > 0 && typeof row.args === "string";
}
function issuesFor(before, after) {
  const issues = [...before.issues, ...after.issues];
  for (const row of before.processes) {
    const current = after.processes.find(p => p.pid === row.pid);
    if (current && current.startTime !== row.startTime) issues.push(`process identity changed: ${row.pid}`);
  }
  for (const entry of after.registries.flatMap(r => r.entries)) {
    if (!after.processes.some(p => p.pid === entry.pid && p.startTime === entry.startTime)) issues.push(`registry identity unconfirmed: ${entry.pid}`);
  }
  return issues;
}
function statusFor(before, after, issues) {
  if (issues.length) return "unknown";
  if (after.processes.length || after.registries.some(r => r.entries.length)) return "residual";
  return "clear-observed-domain";
}

export async function beginResourceAudit({ root, home, binding, output, registryFiles = [], list = listProcesses, platform = process.platform, inventoryTimeoutMs = 12000 }) {
  insist(Number.isSafeInteger(inventoryTimeoutMs) && inventoryTimeoutMs > 0 && inventoryTimeoutMs <= 15000, "resource audit inventory deadline invalid");
  insist(binding && /^[a-f0-9]{40}$/.test(binding.sourceSha) && /^[1-9]\d*$/.test(binding.runId) && binding.attempt === "1" && typeof binding.group === "string" && binding.group.length > 0, "resource audit binding invalid");
  insist(home === realpathSync(home) && home !== resolve("/"), "resource audit requires a canonical owned fixture home");
  insist(Array.isArray(registryFiles) && registryFiles.length <= 64 && new Set(registryFiles).size === registryFiles.length && registryFiles.every(file => inside(home, file)), "resource audit registry outside owned home or duplicate");
  binding = Object.freeze({ ...binding });
  registryFiles = [...registryFiles];
  const startedAt = new Date().toISOString();
  const capture = async previous => {
    const snapshot = { at: new Date().toISOString(), source: null, registries: [], processes: [], issues: [] };
    try { snapshot.source = source(root, binding.sourceSha); } catch { snapshot.issues.push("source identity unavailable or dirty"); }
    if (!POSIX.includes(platform)) { snapshot.issues.push(`independent process audit unsupported on ${platform}`); return snapshot; }
    for (const file of registryFiles) {
      try {
        insist(realpathSync(file) === file, "registry symlink or noncanonical path");
        const bytes = regularBytes(file);
        const entries = JSON.parse(bytes);
        insist(Array.isArray(entries) && entries.every(row => registered(row, home)) && new Set(entries.map(row => row.pid)).size === entries.length, "invalid registry identity");
        snapshot.registries.push({ file, sha256: digest(bytes), entries });
      } catch { snapshot.issues.push(`registry inventory unknown: ${file}`); }
    }
    let rows;
    let timer;
    try {
      rows = await Promise.race([Promise.resolve().then(() => list()), new Promise(resolve => { timer = setTimeout(() => resolve(null), inventoryTimeoutMs); })]);
    } catch { rows = null; } finally { clearTimeout(timer); }
    if (!Array.isArray(rows) || rows.some(row => !listed(row)) || new Set(rows.map(row => row.pid)).size !== rows.length) {
      snapshot.issues.push("process inventory unknown or malformed");
      return snapshot;
    }
    const entries = snapshot.registries.flatMap(r => r.entries);
    const tracked = new Set([...entries, ...(previous?.processes ?? [])].map(row => row.pid));
    snapshot.processes = rows.filter(row => tracked.has(row.pid) || inside(home, userDataDirOf(row))).map(row => ({ pid: row.pid, ppid: row.ppid, startTime: row.startTime, args: row.args }));
    for (const entry of entries) {
      const observed = rows.find(row => row.pid === entry.pid);
      if (!observed || observed.startTime !== entry.startTime) snapshot.issues.push(`registry process identity unavailable or stale: ${entry.pid}`);
    }
    return snapshot;
  };
  const before = await capture();
  let finished;
  return { finish() {
    finished ??= (async () => {
      const after = await capture(before);
      const issues = issuesFor(before, after);
      if (before.source && after.source) {
        try { unchanged(before.source, after.source); } catch { issues.push("source changed during audit"); }
      }
      const artifact = { schemaVersion: 1, kind: "posix-resource-audit", binding, platform, home, domain: DOMAIN, blindSpots: BLIND_SPOTS, completeCleanup: false, registryFiles, startedAt, finishedAt: new Date().toISOString(), before, after, issues, status: statusFor(before, after, issues) };
      writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      return artifact;
    })();
    return finished;
  } };
}

export function validateResourceAudit(artifact, binding) {
  insist(artifact?.schemaVersion === 1 && artifact.kind === "posix-resource-audit" && artifact.completeCleanup === false && artifact.domain === DOMAIN && POSIX.includes(artifact.platform), "resource audit schema/domain unsupported");
  insist(JSON.stringify(artifact.blindSpots) === JSON.stringify(BLIND_SPOTS), "resource audit blind spots missing");
  for (const key of ["sourceSha", "runId", "attempt", "group"]) insist(artifact.binding?.[key] === binding[key], "resource audit binding mismatch");
  insist(typeof artifact.home === "string" && isAbsolute(artifact.home) && Array.isArray(artifact.registryFiles), "resource audit inventory missing");
  for (const snapshot of [artifact.before, artifact.after]) {
    insist(snapshot && snapshot.source?.sha === binding.sourceSha && Array.isArray(snapshot.issues) && Array.isArray(snapshot.processes) && snapshot.processes.every(listed) && Array.isArray(snapshot.registries), "resource audit snapshot invalid");
    insist(JSON.stringify(snapshot.registries.map(r => r.file)) === JSON.stringify(artifact.registryFiles), "resource audit registry coverage missing");
    insist(snapshot.registries.every(r => /^[a-f0-9]{64}$/.test(r.sha256) && Array.isArray(r.entries) && r.entries.every(row => registered(row, artifact.home))), "resource audit registry invalid");
  }
  unchanged(artifact.before.source, artifact.after.source);
  const issues = issuesFor(artifact.before, artifact.after);
  insist(Array.isArray(artifact.issues) && artifact.issues.length === 0 && issues.length === 0 && artifact.status === statusFor(artifact.before, artifact.after, issues) && artifact.status === "clear-observed-domain", "resource audit residual or unknown");
  insist(Number.isFinite(Date.parse(artifact.startedAt)) && Date.parse(artifact.finishedAt) >= Date.parse(artifact.startedAt), "resource audit chronology invalid");
  return { observedDomainClear: true, completeCleanup: false };
}
