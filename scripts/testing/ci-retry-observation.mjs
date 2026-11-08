import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CI_RETRIES } from "./ci-retry-list.mjs";

export const RETRY_CHECKS = ["ci-contract", "patches", "guards"];
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(value);
const validText = (value) => typeof value === "string" && value.length > 0 && value.length <= 4096;
const countKeys = ["firstPass", "retriedPass", "retriedFailed", "failedWithoutRetry", "other"];

export function parseObservation(logText, expectedRunId, batchPrefix) {
  const issues = new Set();
  const starts = new Map();
  const finishes = new Map();
  const rows = [];
  const listErrors = new Set();
  const tasks = new Set();
  let runId = expectedRunId;
  for (const line of logText.split("\n").filter((item) => item.trim())) {
    let record;
    try { record = JSON.parse(line); } catch { issues.add("malformed-line"); continue; }
    if (!record || typeof record !== "object" || Array.isArray(record)) { issues.add("invalid-record"); continue; }
    if (typeof record.listError === "string") {
      listErrors.add(record.listError.slice(0, 500)); issues.add("retry-list-unavailable"); continue;
    }
    const retry = validText(record.file) && validText(record.test) && Number.isSafeInteger(record.retries) && record.retries > 0 && record.retries <= CI_RETRIES && ["pass", "fail"].includes(record.state);
    if (!record.kind && retry) { rows.push(record); issues.add("legacy-unbound-record"); continue; }
    runId ??= record.runId;
    if (record.schemaVersion !== 1 || !validId(record.runId) || record.runId !== runId || !validId(record.batchId)) {
      issues.add("schema-or-run-mismatch"); continue;
    }
    if (batchPrefix && !record.batchId.startsWith(`${batchPrefix}-`)) { issues.add("batch-prefix-mismatch"); continue; }
    const id = record.batchId;
    if (record.kind === "start") {
      if (starts.has(id) || !Array.isArray(record.files) || !record.files.length || !record.files.every(validText) || new Set(record.files).size !== record.files.length) {
        issues.add("invalid-or-duplicate-start"); continue;
      }
      starts.set(id, record);
    } else if (record.kind === "retry") {
      const task = JSON.stringify([id, record.file, record.test]);
      if (!retry || !starts.get(id)?.files.includes(record.file) || finishes.has(id) || tasks.has(task)) {
        issues.add("invalid-or-duplicate-retry"); continue;
      }
      tasks.add(task); rows.push(record);
    } else if (record.kind === "finish") {
      const counts = record.counts;
      if (!starts.has(id) || finishes.has(id) || !counts || Object.keys(counts).sort().join() !== [...countKeys].sort().join() || !countKeys.every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0)) {
        issues.add("invalid-or-duplicate-finish"); continue;
      }
      finishes.set(id, record);
    } else issues.add("unknown-record-kind");
  }
  if (!starts.size || starts.size !== finishes.size) issues.add("missing-lifecycle-evidence");
  const totals = { firstPass: 0, retriedPass: 0, retriedFailed: 0, failedWithoutRetry: 0, observedTests: 0 };
  for (const [id] of starts) {
    const counts = finishes.get(id)?.counts;
    if (!counts) continue;
    const attempts = rows.filter((row) => row.batchId === id);
    const passed = attempts.filter((row) => row.state === "pass").length;
    const failed = attempts.filter((row) => row.state === "fail").length;
    if (counts.retriedPass !== passed || counts.retriedFailed !== failed || counts.other > 0) issues.add("inconsistent-task-counts");
    totals.firstPass += counts.firstPass;
    totals.retriedPass += passed; totals.retriedFailed += failed;
    totals.failedWithoutRetry += counts.failedWithoutRetry;
    totals.observedTests += countKeys.reduce((sum, key) => sum + counts[key], 0);
  }
  if (!totals.observedTests) issues.add("no-executed-test-observation");
  const complete = issues.size === 0;
  return { status: complete ? rows.length ? "observed-retries" : "observed-no-retries" : "incomplete", counts: complete ? totals : null, issues: [...issues], rows, listErrors: [...listErrors] };
}

export function readObservation(path) {
  if (typeof constants.O_NONBLOCK !== "number" || typeof constants.O_NOFOLLOW !== "number") throw new Error("bounded reads unsupported");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const limit = 4 * 1024 * 1024;
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error("observation must be bounded regular file");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (!read) break;
      length += read;
    }
    if (length > limit) throw new Error("observation exceeded size limit");
    return buffer.toString("utf8", 0, length);
  } finally { closeSync(fd); }
}

export function initializeRetryLogs(directory, runId) {
  if (!validId(runId)) throw new Error("explicit retry run ID required");
  mkdirSync(directory, { recursive: true });
  for (const name of RETRY_CHECKS) writeFileSync(join(directory, `${name}.jsonl`), "", { flag: "wx", mode: 0o600 });
  writeFileSync(join(directory, "manifest.json"), JSON.stringify({ schemaVersion: 1, runId, checks: RETRY_CHECKS }), { flag: "wx", mode: 0o600 });
}

export function writeRetryReport(directory, report) {
  const path = join(directory, "summary.json");
  writeFileSync(`${path}.tmp`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
