import { realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { listProcesses, userDataDirOf } from "../../server/browser/chrome/processes.ts";
import { MAX_GROUP_HISTORY_FILES, readGroupHistory, readGroupIdentity, groupPresence } from "../../server/verification-group-history.ts";
import { digest, insist, source, unchanged } from "./core.mjs";
import { regularBytes } from "./artifact-input.mjs";

const DOMAIN = "declared-registry-identities-and-owned-home-profile-arguments";
const GROUP_DOMAIN = `${DOMAIN}-and-authenticated-internal-process-group-history`;
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
function groupRegistered(row, home, file) {
  return row?.kind === "verification-process-group" && Number.isSafeInteger(row.pid) && row.pid > 1
    && Number.isSafeInteger(row.pgid) && row.pgid > 0 && typeof row.startTime === "string" && row.startTime.length > 0
    && Number.isSafeInteger(row.ownerPid) && row.ownerPid > 0 && typeof row.ownerStartTime === "string" && row.ownerStartTime.length > 0
    && typeof row.launchedAt === "string" && Number.isFinite(Date.parse(row.launchedAt)) && new Date(row.launchedAt).toISOString() === row.launchedAt && inside(home, file)
    && /^[a-f0-9-]{36}$/.test(row.gateNonce) && ["pending", "stopped", "unknown"].includes(row.status);
}
function entryRegistered(row, home, file) { return row?.kind === "verification-process-group" ? groupRegistered(row, home, file) : registered(row, home); }
function diagnosticIdentity(row) {
  const start = value => value === null ? null : typeof value === "string" && /^(?:\d{1,24}|[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4})$/.test(value) ? value : "invalid";
  const text = (value, pattern) => typeof value === "string" && pattern.test(value) ? value : "invalid";
  return {
    kind: row.kind, pid: row.pid, pgid: row.pgid, ownerPid: row.ownerPid,
    startTime: start(row.startTime), ownerStartTime: start(row.ownerStartTime),
    creator: text(row.creator, /^(?:gate-command-runner|verification-scope:[a-f0-9-]{36})$/),
    status: row.status, gateNonce: text(row.gateNonce, /^[a-f0-9-]{36}$/),
    launchedAt: text(row.launchedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    binding: {
      sourceSha: text(row.binding.sourceSha, /^[a-f0-9]{40}$/), runId: text(row.binding.runId, /^[1-9]\d{0,19}$/),
      attempt: text(row.binding.attempt, /^[1-9]\d{0,2}$/), group: text(row.binding.group, /^[a-zA-Z0-9-]{1,64}$/),
    },
  };
}
function registryFailureCode(error, stage) {
  const known = { "Unauthenticated process history": "unauthenticated-process-history", "Invalid process history identity": "invalid-process-history-identity", "Unsafe verification process history path": "unsafe-process-history-path" };
  return Object.hasOwn(known, error?.message) ? known[error.message] : ["ENOENT", "EACCES", "EPERM", "ELOOP", "EISDIR", "EINVAL"].includes(error?.code) ? error.code : `${stage}-rejected`;
}
function active(row) { return row.kind !== "verification-process-group" || row.status !== "stopped"; }
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
  for (const registry of before.registries) {
    const current = after.registries.find(r => r.file === registry.file);
    for (const entry of registry.entries.filter(row => row.kind === "verification-process-group")) {
      const next = current?.entries.find(row => row.pid === entry.pid);
      if (!next || JSON.stringify({ ...entry, status: null }) !== JSON.stringify({ ...next, status: null })
        || entry.status === "unknown" && next.status !== "unknown" || entry.status === "stopped" && next.status === "pending") issues.push(`group history changed or disappeared: ${entry.pid}`);
    }
  }
  for (const entry of after.registries.flatMap(r => r.entries).filter(active)) {
    if (!after.processes.some(p => p.pid === entry.pid && p.startTime === entry.startTime)) issues.push(`registry identity unconfirmed: ${entry.pid}`);
  }
  return issues;
}
function statusFor(before, after, issues) {
  if (issues.length) return "unknown";
  if (after.processes.length || after.registries.some(r => r.entries.some(active)) || after.groups?.some(g => g.present !== false)) return "residual";
  return "clear-observed-domain";
}

export async function beginResourceAudit({ root, home, binding, output, registryFiles = [], processCapability, list = listProcesses, platform = process.platform, inventoryTimeoutMs = 12000 }) {
  insist(Number.isSafeInteger(inventoryTimeoutMs) && inventoryTimeoutMs > 0 && inventoryTimeoutMs <= 15000, "resource audit inventory deadline invalid");
  insist(binding && /^[a-f0-9]{40}$/.test(binding.sourceSha) && /^[1-9]\d*$/.test(binding.runId) && binding.attempt === "1" && typeof binding.group === "string" && binding.group.length > 0, "resource audit binding invalid");
  insist(home === realpathSync(home) && home !== resolve("/"), "resource audit requires a canonical owned fixture home");
  insist(Array.isArray(registryFiles) && registryFiles.length <= 64 && new Set(registryFiles).size === registryFiles.length && registryFiles.every(file => inside(home, file)), "resource audit registry outside owned home or duplicate");
  insist(!processCapability || dirname(processCapability.directory) === home, "process history capability outside owned home");
  binding = Object.freeze({ ...binding });
  registryFiles = [...registryFiles];
  let historyFiles = [];
  const domain = processCapability ? GROUP_DOMAIN : DOMAIN;
  const blindSpots = processCapability ? BLIND_SPOTS.map(s => s === "normal internal detached CLI groups not durably inventoried" ? "only capability-bound GateCommandRunner and VerificationProcessScope groups inventoried; other spawners and escaped descendants unconfirmed" : s) : BLIND_SPOTS;
  const startedAt = new Date().toISOString();
  const capture = async previous => {
    const snapshot = { at: new Date().toISOString(), source: null, registries: [], registryFailures: [], processes: [], groups: [], issues: [] };
    try { snapshot.source = source(root, binding.sourceSha); } catch { snapshot.issues.push("source identity unavailable or dirty"); }
    if (!POSIX.includes(platform)) { snapshot.issues.push(`independent process audit unsupported on ${platform}`); return snapshot; }
    if (processCapability) {
      try {
        insist(JSON.stringify(processCapability.processBinding) === JSON.stringify(binding), "process history binding mismatch");
        const retained = [...new Set([...historyFiles, ...readGroupHistory(processCapability).files])].sort();
        insist(retained.length <= MAX_GROUP_HISTORY_FILES && retained.every(file => inside(home, file)), "process history file budget or home boundary exceeded");
        historyFiles = retained;
        const declared = [...new Set([...registryFiles, ...historyFiles])].sort();
        insist(declared.length <= 64 + MAX_GROUP_HISTORY_FILES && declared.every(file => inside(home, file)), "resource audit aggregate file budget or home boundary exceeded");
        registryFiles = declared;
      } catch (error) {
        snapshot.historyInventoryFailure = { code: registryFailureCode(error, "history-inventory") };
        snapshot.issues.push("durable process history inventory unknown");
      }
    }
    for (const file of registryFiles) {
      let stage = "registry-read";
      let hash;
      let authenticated;
      try {
        insist(realpathSync(file) === file, "registry symlink or noncanonical path");
        const bytes = regularBytes(file);
        hash = digest(bytes);
        stage = "registry-json";
        const parsed = JSON.parse(bytes);
        stage = "history-authentication";
        if (parsed?.kind === "verification-process-group") authenticated = readGroupIdentity(processCapability, file);
        const entries = authenticated ? [authenticated] : parsed;
        stage = "registry-identity";
        insist(!Array.isArray(parsed) || parsed.every(row => row?.kind !== "verification-process-group"), "unauthenticated group array");
        insist(Array.isArray(entries) && entries.every(row => entryRegistered(row, home, file)) && new Set(entries.map(row => row.pid)).size === entries.length, "invalid registry identity");
        snapshot.registries.push({ file, sha256: hash, entries });
      } catch (error) {
        const problems = authenticated ? ["startTime", "ownerStartTime"].filter(key => typeof authenticated[key] !== "string" || !authenticated[key].length) : [];
        snapshot.registryFailures.push({ file, stage, code: registryFailureCode(error, stage), ...(hash ? { sha256: hash } : {}), authenticated: Boolean(authenticated),
          ...(authenticated ? { invalidFields: problems, identity: diagnosticIdentity(authenticated) } : {}) });
        snapshot.issues.push(`registry inventory unknown: ${file}`);
      }
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
      if (entry.kind === "verification-process-group") {
        if (observed && observed.startTime !== entry.startTime) {
          snapshot.groups.push({ pgid: entry.pgid, present: null });
          snapshot.issues.push(`registry process identity unavailable or stale: ${entry.pid}`);
          continue;
        }
        const present = groupPresence(entry.pgid);
        snapshot.groups.push({ pgid: entry.pgid, present });
        if (present === null || entry.status === "unknown") snapshot.issues.push(`group confirmation unknown: ${entry.pgid}`);
        if (entry.status === "stopped") continue;
      }
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
      const artifact = { schemaVersion: 1, kind: "posix-resource-audit", binding, platform, home, domain, blindSpots, completeCleanup: false, ...(processCapability ? { gateNonce: processCapability.gateNonce } : {}), registryFiles, startedAt, finishedAt: new Date().toISOString(), before, after, issues, status: statusFor(before, after, issues) };
      writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      return artifact;
    })();
    return finished;
  } };
}

export function validateResourceAudit(artifact, binding) {
  insist(artifact?.schemaVersion === 1 && artifact.kind === "posix-resource-audit" && artifact.completeCleanup === false && [DOMAIN, GROUP_DOMAIN].includes(artifact.domain) && POSIX.includes(artifact.platform), "resource audit schema/domain unsupported");
  const expectedBlindSpots = artifact.domain === GROUP_DOMAIN ? BLIND_SPOTS.map(s => s === "normal internal detached CLI groups not durably inventoried" ? "only capability-bound GateCommandRunner and VerificationProcessScope groups inventoried; other spawners and escaped descendants unconfirmed" : s) : BLIND_SPOTS;
  insist(JSON.stringify(artifact.blindSpots) === JSON.stringify(expectedBlindSpots), "resource audit blind spots missing");
  for (const key of ["sourceSha", "runId", "attempt", "group"]) insist(artifact.binding?.[key] === binding[key], "resource audit binding mismatch");
  insist(typeof artifact.home === "string" && isAbsolute(artifact.home) && Array.isArray(artifact.registryFiles), "resource audit inventory missing");
  for (const snapshot of [artifact.before, artifact.after]) {
    insist(snapshot && snapshot.source?.sha === binding.sourceSha && Array.isArray(snapshot.issues) && Array.isArray(snapshot.processes) && snapshot.processes.every(listed) && Array.isArray(snapshot.registries), "resource audit snapshot invalid");
    insist(!snapshot.historyInventoryFailure && (snapshot.registryFailures === undefined || Array.isArray(snapshot.registryFailures) && snapshot.registryFailures.length === 0), "resource audit rejected registry context");
    insist(artifact.domain === GROUP_DOMAIN && snapshot === artifact.before ? snapshot.registries.every(r => artifact.registryFiles.includes(r.file)) : JSON.stringify(snapshot.registries.map(r => r.file)) === JSON.stringify(artifact.registryFiles), "resource audit registry coverage missing");
    insist(snapshot.registries.every(r => /^[a-f0-9]{64}$/.test(r.sha256) && Array.isArray(r.entries) && r.entries.every(row => entryRegistered(row, artifact.home, r.file))), "resource audit registry invalid");
  }
  for (const snapshot of [artifact.before, artifact.after]) {
    const groups = snapshot.registries.flatMap(r => r.entries).filter(row => row.kind === "verification-process-group");
    insist(groups.every(row => row.gateNonce === artifact.gateNonce && artifact.domain === GROUP_DOMAIN && JSON.stringify(row.binding) === JSON.stringify(binding)), "process history binding mismatch");
    insist(groups.length === (snapshot.groups?.length ?? 0) && groups.every(row => snapshot.groups.some(g => g.pgid === row.pgid && typeof g.present === "boolean")), "resource audit process group observations missing or unknown");
    insist(groups.every(row => row.status !== "unknown"), "process history unknown");
  }
  unchanged(artifact.before.source, artifact.after.source);
  const issues = issuesFor(artifact.before, artifact.after);
  insist(Array.isArray(artifact.issues) && artifact.issues.length === 0 && issues.length === 0 && artifact.status === statusFor(artifact.before, artifact.after, issues) && artifact.status === "clear-observed-domain", "resource audit residual or unknown");
  insist(Number.isFinite(Date.parse(artifact.startedAt)) && Date.parse(artifact.finishedAt) >= Date.parse(artifact.startedAt), "resource audit chronology invalid");
  return { observedDomainClear: true, completeCleanup: false };
}
