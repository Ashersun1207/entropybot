import { createHash } from "node:crypto";
import { readFileSync, lstatSync, readdirSync, readlinkSync, realpathSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { installEnvironment } from "../full-gate/install-policy.ts";
import { GateCommandRunner } from "../patch-gate-process.ts";

export const PNPM_URL = "https://registry.npmjs.org/pnpm/-/pnpm-10.33.0.tgz";
export const PNPM_SHA = "bfcc1bcbad279b13a516c446a75b3c58b6904b45d57a1951411015e50b751a80";
export const ELECTRON_SHA = "dcf13726bbf45646c968bb67f48d24ecfb941af1b3c01217f84edaf50fee632a";
export const SUITES = ["scripts/testing/patch-gate-process.test.ts", "scripts/testing/verification-lifecycle.test.ts", "server/verification-process-scope.test.ts"];
export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export function requireValue(value, reason) { if (!value) throw new Error(reason); }
export function actualHost(platform, arch, uname, version) {
  requireValue(platform === "darwin" && arch === "arm64" && uname === "Darwin arm64" && version === "v24.22.2", "actual macOS arm64 / Node 24.22.2 required before install");
}
export function environment(home, nodeDirectory) {
  return installEnvironment({ home, platform: "darwin", path: [nodeDirectory, "/usr/bin", "/bin", "/usr/sbin", "/sbin"] });
}
export function writeReport(directory, name, data) {
  requireValue(/^[a-z0-9-]+\.(json|log|txt)$/.test(name), "invalid report name");
  const bytes = typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n";
  requireValue(Buffer.byteLength(bytes) <= 16 * 1024 * 1024, "report size cap");
  writeFileSync(join(directory, name), bytes, { flag: "wx", mode: 0o600 });
}
export function sealReports(directory, quarantine, secret) {
  const rows = [];
  let total = 0;
  let rejected = 0;
  for (const name of readdirSync(directory).sort()) {
    const file = join(directory, name);
    const stat = lstatSync(file);
    total += stat.size;
    if (!/^[a-z0-9-]+\.(json|log|txt)$/.test(name) || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid() || stat.size > 16 * 1024 * 1024 || total > 128 * 1024 * 1024) {
      renameSync(file, join(quarantine, String(++rejected)));
      continue;
    }
    const bytes = readFileSync(file);
    if (secret && bytes.includes(Buffer.from(secret))) {
      renameSync(file, join(quarantine, String(++rejected)));
      continue;
    }
    rows.push({ name, bytes: bytes.length, sha256: digest(bytes) });
  }
  requireValue(rejected === 0, "unsafe/oversized diagnostic artifact quarantined outside upload root");
  return rows;
}
export function identity(file) {
  return { path: file, realpath: realpathSync(file), sha256: digest(readFileSync(file)), bytes: lstatSync(realpathSync(file)).size };
}
export function inventory(root, cap = 150000) {
  const rows = [];
  let bytes = 0;
  function visit(relative) {
    const path = join(root, relative);
    const stat = lstatSync(path);
    requireValue(rows.length < cap, "inventory entry cap");
    if (stat.isSymbolicLink()) rows.push({ path: relative, link: readlinkSync(path) });
    else if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(relative, name));
    else {
      requireValue(stat.isFile() && stat.size <= 300 * 1024 * 1024, "nonregular/oversized inventory member");
      bytes += stat.size;
      requireValue(bytes <= 4 * 1024 ** 3, "inventory byte cap");
      rows.push({ path: relative, sha256: digest(readFileSync(path)), bytes: stat.size });
    }
  }
  visit("");
  return { rows, bytes, sha256: digest(JSON.stringify(rows)) };
}
export async function recordCommand({ reports, name, executable, argv, cwd, env, timeoutMs, capability, signal, onStdout }) {
  const runner = new GateCommandRunner({ processCapability: capability, signal, commandTimeoutMs: timeoutMs, overallTimeoutMs: timeoutMs + 15000 });
  const record = { name, executable: identity(executable), argv, cwd, env, startedAt: new Date().toISOString() };
  let result;
  try {
    result = await runner.run(executable, argv, { cwd, env, timeoutMs, forwardOutput: false, onStdout });
    record.outcome = { ok: true, ...result.evidence, outputTruncated: result.outputTruncated };
  } catch (error) {
    record.outcome = { ok: false, kind: error.kind, message: String(error), ownedGroupStopped: error.ownedGroupStopped, ...error.evidence, outputTruncated: error.output?.outputTruncated };
    result = error.output;
  } finally {
    await runner.close();
    record.finishedAt = new Date().toISOString();
    writeReport(reports, `${name}-stdout.log`, result?.stdout ?? "");
    writeReport(reports, `${name}-stderr.log`, result?.stderr ?? "");
    writeReport(reports, `${name}.json`, record);
  }
  requireValue(record.outcome.ok && !record.outcome.outputTruncated && record.outcome.exitAt !== undefined && record.outcome.closeAt !== undefined && record.outcome.groupGoneAt !== undefined, `${name}: command failed or incomplete; see original reports`);
  return result;
}
export function checkSuiteReport(report) {
  requireValue(report.success === true && report.testResults?.length === SUITES.length && report.numTotalTests > 0 && report.numPassedTests === report.numTotalTests, "suite missing, empty or unsuccessful");
  requireValue(["numFailedTests", "numPendingTests", "numTodoTests", "numFailedTestSuites", "numPendingTestSuites"].every(key => report[key] === 0), "suite failure/skip/todo");
  const files = report.testResults.map(file => SUITES.find(name => file.name.endsWith("/" + name)));
  requireValue(new Set(files).size === SUITES.length && files.every(Boolean), "wrong suite coverage");
  for (const file of report.testResults) {
    requireValue(file.status === "passed" && file.assertionResults?.length > 0, "empty/failed suite");
    for (const test of file.assertionResults) requireValue(test.status === "passed" && !(test.retryCount || test.retries), "nonpass or retried assertion");
  }
}
export async function downloadPnpm(destination) {
  const startedAt = new Date().toISOString();
  const response = await fetch(PNPM_URL, { redirect: "error", signal: AbortSignal.timeout(60000) });
  requireValue(response.status === 200 && response.url === PNPM_URL, "pnpm origin/status mismatch");
  const chunks = [];
  let count = 0;
  for await (const chunk of response.body) {
    count += chunk.length;
    requireValue(count <= 10 * 1024 * 1024, "pnpm download cap");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const observed = digest(bytes);
  requireValue(observed === PNPM_SHA, "pnpm archive hash mismatch");
  writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
  return { url: PNPM_URL, expectedSha256: PNPM_SHA, observedSha256: observed, bytes: count, startedAt, finishedAt: new Date().toISOString(), redirects: [] };
}
