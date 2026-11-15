import { lstatSync, realpathSync, opendirSync } from "node:fs";
import { dirname, join } from "node:path";
import { readSafeLogTail, buildDiagnosticsReport, diagnosticsFileName, appendDesktopCrashRecord, formatDesktopCrashRecord, redactSecretsInLine } from "../../electron/diagnostics.mjs";
import { windowPaths } from "./window-observer.mjs";

export const FAILURE_LOG = "window-entry-failures.log";
const TAIL_BYTES = 8192;
const REPORT_BYTES = 128 * 1024;
const PRIVATE_RECORD = /"(?:accounts?|users?|sessions?|credentials?)"\s*:\s*[\[{]/i;

function ownedDirectory(path) {
  try { const stat = lstatSync(path); return stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && realpathSync(path) === path; }
  catch { return false; }
}
function scrub(text, secrets) {
  let out = String(text);
  for (const secret of secrets.filter(value => typeof value === "string" && value.length).sort((a, b) => b.length - a.length)) out = out.replaceAll(secret, "[redacted]");
  if (PRIVATE_RECORD.test(out)) return "[private structured diagnostic omitted]";
  return redactSecretsInLine(out)
    .replace(/\b(?:account(?:Id|_id)?|user(?:Id|_id)?|session(?:Id|_id)?|email|hmac|mac|signature|capability)\b["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, "[private diagnostic field redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]")
    .replace(/\b[A-Za-z0-9_+\/-]{40,}={0,2}\b/g, "[opaque value redacted]");
}
function safeLines(text, secrets, first = false) {
  if (PRIVATE_RECORD.test(text)) return "[private structured diagnostic tail omitted]";
  let complete = text;
  for (const secret of secrets.filter(value => typeof value === "string" && value.length).sort((a, b) => b.length - a.length)) complete = complete.replaceAll(secret, "[redacted]");
  const lines = redactSecretsInLine(complete).split(/\r?\n/);
  return (first ? lines.slice(0, 64) : lines.slice(-64)).map(line => Buffer.byteLength(line) > 2048 ? "[oversized diagnostic line omitted]" : scrub(line, [])).join("\n");
}
export function recordWindowFailure(home, stage, error, origin = "uncaughtException") {
  if (!ownedDirectory(home)) return;
  const allowed = new Set(["entry", "main-process", "window-observation", "watchdog"]);
  const label = allowed.has(stage) ? stage : "entry";
  let detail;
  try {
    const raw = String(error?.stack ?? error);
    detail = raw.slice(0, 32768);
    if (raw.length > detail.length) detail = detail.slice(0, detail.lastIndexOf("\n") + 1);
  } catch { detail = "error detail unavailable"; }
  const lines = [];
  let bytes = 0;
  for (const line of safeLines(detail, [], true).split("\n").slice(0, 16)) {
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > 4096) break;
    lines.push(line);
  }
  const metadata = label === "main-process" ? formatDesktopCrashRecord({ kind: "main", error, origin }) : "event=window-diagnostic-failure";
  appendDesktopCrashRecord(join(home, FAILURE_LOG), 64 * 1024,
    `stage=${label} ${metadata}\n${lines.join("\n")}`);
}

export function recordWindowCrash(home, event) {
  if (!ownedDirectory(home)) return;
  if (event.kind === "main") recordWindowFailure(home, "main-process", event.error, event.origin);
  else appendDesktopCrashRecord(join(home, FAILURE_LOG), 64 * 1024, formatDesktopCrashRecord(event));
}

export function collectWindowFailure(home, secrets = []) {
  if (!ownedDirectory(home)) throw new Error("failure diagnostics require canonical owned HOME");
  const paths = windowPaths(home);
  const inputs = [
    ["entry", join(home, FAILURE_LOG)],
    ["desktop", join(paths.logs, "desktop-crashes.log")],
    ["server", join(paths.logs, "server.log")],
    ["updater", join(paths.logs, "updater.log")],
    ["main", join(paths.logs, "main.log")],
    ["log-session", join(paths.logs, "session.log")],
    ["profile-session", join(paths.userData, "session.log")],
    ["profile-chromium", join(paths.userData, "chrome_debug.log")],
    ["profile-log", join(paths.userData, "LOG")],
    ["session-chromium", join(paths.sessionData, "chrome_debug.log")],
    ["session-log", join(paths.sessionData, "LOG")],
  ];
  const inventory = [];
  const tails = {};
  for (const [label, path] of inputs) {
    if (!ownedDirectory(dirname(path))) { inventory.push({ label, status: "missing-or-rejected" }); continue; }
    let stat;
    try { stat = lstatSync(path); } catch { inventory.push({ label, status: "missing-or-rejected" }); continue; }
    const tail = stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid() ? readSafeLogTail(path, TAIL_BYTES) : null;
    if (!tail) { inventory.push({ label, status: "missing-or-rejected" }); continue; }
    if (Array.from(tail.tail).some(character => character.charCodeAt(0) < 32 && !["\t", "\n", "\r"].includes(character))) {
      inventory.push({ label, status: "private-or-binary-omitted" }); continue;
    }
    const complete = tail.tail.slice(0, tail.tail.lastIndexOf("\n") + 1);
    tails[label] = safeLines(complete, secrets);
    inventory.push({ label, status: "tail-captured", sourceBytes: stat.size, readBytes: tail.bytes });
  }
  const crashInventories = [];
  for (const [label, path] of [["crash-dumps", paths.crashDumps], ["profile-crashpad", join(paths.userData, "Crashpad/reports")], ["session-crashpad", join(paths.sessionData, "Crashpad/reports")]]) {
    if (!ownedDirectory(path)) { crashInventories.push({ label, status: "missing-or-rejected" }); continue; }
    let directory;
    try { directory = opendirSync(path); } catch { crashInventories.push({ label, status: "missing-or-rejected" }); continue; }
    let observedEntries = 0;
    try { while (observedEntries < 16 && directory.readSync()) observedEntries++; }
    finally { directory.closeSync(); }
    crashInventories.push({ label, status: "names-and-contents-omitted", observedEntries, limitReached: observedEntries === 16 });
  }
  const desktop = Object.entries(tails).filter(([label]) => label !== "server" && label !== "updater").map(([label, tail]) => `[${label}]\n${tail}`).join("\n");
  const report = buildDiagnosticsReport({ appInfo: { platform: process.platform, arch: process.arch, node: process.versions.node, packaged: false },
    desktopLogTail: desktop, logTail: tails.server, updaterLogTail: tails.updater });
  if (Buffer.byteLength(report) > REPORT_BYTES) throw new Error("failure diagnostics report byte limit");
  return { fileName: diagnosticsFileName(), report, inventory, crashInventories, limits: { files: inputs.length, tailBytes: TAIL_BYTES, linesPerFile: 64, lineBytes: 2048, reportBytes: REPORT_BYTES, crashEntriesPerDirectory: 16 }, completeCleanup: false, completeQualification: false };
}
