import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve, win32 } from "node:path";
import { assertSourceExecutables } from "./source-policy.mjs";

export function reportFile(root, file) {
  insist(typeof root === "string" && typeof file === "string", "missing report path");
  const name = (/^[a-z]:[\\/]/i.test(root) ? win32.relative(root, file) : relative(root, file)).replaceAll("\\", "/");
  insist(name && name !== ".." && !name.startsWith("../") && !/^[a-z]:/i.test(name), "foreign report file");
  return name;
}

export const GROUPS = [...Array.from({ length: 10 }, (_, i) => `main-vitest-${String(i + 1).padStart(2, "0")}`), "broker-vitest", "control-plane-vitest", "electron-node"];
export const STEPS = ["Exact final-source file coverage", "Strict totals: no failures or todos", "Fixture isolation and resource receipts", "Platform dispositions complete", "Clean unchanged source"];
export function insist(value, reason) { if (!value) throw new Error(`Full gate blocked: ${reason}`); }
export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export function exact(actual, expected, label) {
  insist(Array.isArray(actual) && actual.length > 0 && new Set(actual).size === actual.length, `${label}: empty or duplicate`);
  insist(JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()), `${label}: missing or extra file`);
}
export function source(root, sha) {
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 15000 }).trim();
  insist(/^[a-f0-9]{40}$/.test(sha) && git(["rev-parse", "HEAD"]) === sha, "wrong SHA");
  assertSourceExecutables(root);
  insist(git(["status", "--porcelain", "--untracked-files=all"]) === "", "dirty source");
  const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  return { sha, tree: git(["rev-parse", "HEAD^{tree}"]), hash: digest(files.map(file => `${file}\0${digest(readFileSync(resolve(root, file)))}`).join("\n")) };
}
export function unchanged(before, after) { insist(JSON.stringify(before) === JSON.stringify(after), "source changed"); }
export function nodeFiles(root) {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", timeout: 15000 }).split("\0").filter(file => file.endsWith(".node-test.mjs")).sort();
}
export function safeArgv(argv) {
  insist(Array.isArray(argv) && argv.length > 0, "missing argv");
  insist(!argv.some(arg => arg.startsWith("-") && /(?:testNamePattern|test-name-pattern|passWithNoTests|retry|bail|changed|related|exclude|include|grep|only|--test-rerun|^-t$)/i.test(arg)), "filter, retry or passWithNoTests");
}
export function vitestResults(report, root, group) {
  insist(report.success === true && Number.isSafeInteger(report.numTotalTests) && report.numTotalTests > 0, "incomplete totals");
  for (const key of ["numFailedTests", "numTodoTests", "numFailedTestSuites", "numPendingTestSuites"]) insist(report[key] === 0, `nonzero or missing ${key}`);
  insist(Array.isArray(report.testResults) && report.testResults.length > 0, "missing test results");
  const tests = [];
  const files = report.testResults.map(file => {
    insist(file.status === "passed" && file.assertionResults?.length > 0, "empty or failed file");
    const name = reportFile(root, file.name);
    for (const test of file.assertionResults) {
      insist(["passed", "skipped"].includes(test.status) && (test.retryCount ?? 0) === 0 && (test.retries ?? 0) === 0, "todo/pending/retry assertion");
      insist(typeof test.fullName === "string" && test.fullName.trim(), "missing full test identity");
      tests.push({ group, file: name, fullName: test.fullName, status: test.status });
    }
    return name;
  });
  const passed = tests.filter(t => t.status === "passed").length;
  const skipped = tests.filter(t => t.status === "skipped").length;
  insist(tests.length === report.numTotalTests && passed === report.numPassedTests && skipped === report.numPendingTests, "assertion total mismatch");
  exact(files, files, "report files");
  return { files, tests, total: tests.length, passed, skipped };
}
export function strictVitest(report, root) { return vitestResults(report, root, "synthetic").files; }
export function strictTap(text) {
  const summary = {};
  for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const values = [...text.matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, "gm"))];
    insist(values.length === 1, `missing/duplicate TAP ${key}`);
    summary[key] = Number(values[0][1]);
  }
  insist(/^TAP version 13\r?$/m.test(text) && /^\s*1\.\.\d+\r?$/m.test(text) && [...text.matchAll(/^\s*ok \d+\b/gm)].length >= summary.tests, "missing TAP results or plan");
  insist(summary.tests > 0 && summary.pass + summary.skipped === summary.tests && ["fail", "cancelled", "todo"].every(k => summary[k] === 0), "TAP skip/todo/failure/totals");
  insist(!/^\s*not ok\b|^(?:ok|\s+ok)\b[^\n]*#\s*TODO\b|^Bail out!/im.test(text), "TAP failure or todo");
  insist([...text.matchAll(/^\s*ok \d+\b[^\n]*#\s*SKIP\b/gim)].length === summary.skipped, "TAP skip count mismatch");
  return summary;
}
export function coverage(records, discovered) {
  exact(records.map(r => r.group), GROUPS, "groups");
  for (const [kind, names] of Object.entries(discovered)) {
    const members = records.filter(r => kind === "main" ? r.group.startsWith("main-vitest-") : r.group === kind);
    exact(members.flatMap(r => r.files), names, kind);
  }
}
export function validateReceipt(record, expectedSha) {
  insist(record.sha === expectedSha && record.attempt === "1", "receipt provenance");
  safeArgv(record.argv);
  insist(record.exitCode === 0 && record.timedOut === false, "nonzero or timeout");
  unchanged(record.before, record.after);
  insist(record.before.sha === expectedSha, "receipt source mismatch");
  insist(record.resources?.leasesVerified === true && record.resources?.ownedGroupStopped === true && record.resources?.processAudit === "confirmed", "resource receipts unknown");
  insist(record.isolation?.syntheticHome === true && record.isolation?.fakeEngines === true && record.isolation?.live === "0", "isolation missing");
}
