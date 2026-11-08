import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { retrySummary, collectRetryReport } from "./ci-retry-summary.mjs";
import { initializeRetryLogs, readObservation, RETRY_CHECKS } from "./ci-retry-observation.mjs";

const runId = "fixture-run";
const base = { schemaVersion: 1, runId, batchId: "batch-1" };
const start = { ...base, kind: "start", files: ["fixture.test.ts"] };
const finish = (counts) => ({ ...base, kind: "finish", counts });
const counts = { firstPass: 1, retriedPass: 0, failed: 0, other: 0 };
const retry = (state) => ({ ...base, kind: "retry", file: "fixture.test.ts", test: "case", retries: state === "pass" ? 1 : 2, state, platform: "fixture" });
const text = (...records) => records.map((record) => JSON.stringify(record)).join("\n");
const summarize = (log) => retrySummary(log, [], { runId });

test("complete first-pass observation is different from absent or empty evidence", () => {
  const result = summarize(text(start, finish(counts)));
  assert.equal(result.status, "observed-no-retries");
  assert.equal(result.counts.firstPass, 1);
  for (const log of ["", "{invalid", "null", "[]", "7"]) {
    const invalid = summarize(log);
    assert.equal(invalid.status, "incomplete");
    assert.equal(invalid.counts, null);
    assert.ok(invalid.issues.length > 0);
  }
});

test("retried passes and failures remain separate from first-pass success", () => {
  const passed = summarize(text(start, retry("pass"), finish({ ...counts, firstPass: 0, retriedPass: 1 })));
  assert.equal(passed.status, "observed-retries");
  assert.equal(passed.counts.retriedPass, 1);
  const failed = summarize(text(start, retry("fail"), finish({ ...counts, firstPass: 0, failed: 1 })));
  assert.equal(failed.counts.retriedFailed, 1);
  assert.equal(failed.counts.firstPass, 0);
});

test("partial, stale, duplicate, malformed and inconsistent observations stay unknown", () => {
  const logs = [
    text(start), text(finish(counts)), text(start, start, finish(counts)),
    text(start, { ...finish(counts), runId: "old-run" }),
    `${text(start, finish(counts))}\n{bad`,
    text(start, { ...finish(counts), schemaVersion: 99 }),
    text(start, finish({ ...counts, retriedPass: 1 })),
    text(start, retry("pass"), retry("pass"), finish({ ...counts, firstPass: 0, retriedPass: 2 })),
    text(start, { ...retry("pass"), file: "other.test.ts" }, finish({ ...counts, firstPass: 0, retriedPass: 1 })),
    text(start, finish({ ...counts, firstPass: -1 })),
  ];
  for (const log of logs) {
    const result = summarize(log);
    assert.equal(result.status, "incomplete");
    assert.equal(result.counts, null);
  }
});

test("legacy retry details survive but do not establish complete observation", () => {
  const result = summarize(JSON.stringify({ file: "fixture.test.ts", test: "case", retries: 1, state: "pass" }));
  assert.equal(result.status, "incomplete");
  assert.match(result.markdown, /passed on a retry/);
  assert.equal(result.counts, null);
  const listError = summarize(text(start, { listError: "synthetic list error" }, finish(counts)));
  assert.equal(listError.status, "incomplete");
});

test("real CLI isolates run files, reports not-run and preserves failed command outcome", () => {
  const directory = mkdtempSync(join(tmpdir(), "retry-observe-"));
  try {
    const env = { PATH: process.env.PATH, HOME: directory, USERPROFILE: directory, LANG: "en_US.UTF-8", OMB_VITEST_RETRY_DIRECTORY: directory, OMB_VITEST_RETRY_RUN_ID: runId };
    const cli = fileURLToPath(new URL("./ci-retry-summary.mjs", import.meta.url));
    const invoke = (args = []) => spawnSync(process.execPath, [cli, ...args], { env, timeout: 5_000, encoding: "utf8" });
    assert.equal(invoke(["--init"]).status, 0);
    writeFileSync(join(directory, "ci-contract.jsonl"), text(start, retry("fail"), finish({ ...counts, firstPass: 0, failed: 1 })));
    env.OMB_VITEST_RETRY_OUTCOMES = JSON.stringify({ "ci-contract": "failure", patches: "skipped", guards: "skipped" });
    assert.equal(invoke().status, 0);
    let report = JSON.parse(readFileSync(join(directory, "summary.json"), "utf8"));
    assert.equal(report.checks[0].commandOutcome, "failure");
    assert.equal(report.checks[0].counts.retriedFailed, 1);
    assert.equal(report.checks[1].status, "not_run");
    assert.equal(invoke(["--init"]).status, 1);
    unlinkSync(join(directory, "ci-contract.jsonl"));
    assert.equal(invoke().status, 0);
    report = JSON.parse(readFileSync(join(directory, "summary.json"), "utf8"));
    assert.equal(report.checks[0].status, "incomplete");
    assert.equal(report.checks[0].counts, null);
    assert.throws(() => initializeRetryLogs(directory, runId));
    assert.equal(RETRY_CHECKS.length, 3);
    assert.equal(readObservation(join(directory, "manifest.json")).length > 0, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("collector marks missing, mismatched and contradictory observations unknown", () => {
  const directory = mkdtempSync(join(tmpdir(), "retry-observe-"));
  try {
    assert.equal(collectRetryReport(directory, "missing", { "ci-contract": "success", patches: "success", guards: "success" }, []).status, "incomplete");
    initializeRetryLogs(directory, runId);
    writeFileSync(join(directory, "ci-contract.jsonl"), text(start, finish(counts)));
    writeFileSync(join(directory, "patches.jsonl"), text(start, finish({ ...counts, firstPass: 3 })));
    writeFileSync(join(directory, "guards.jsonl"), text(start, finish({ ...counts, firstPass: 2 })));
    const contradictory = collectRetryReport(directory, runId, { "ci-contract": "success", patches: "success", guards: "success" }, []);
    assert.equal(contradictory.checks[0].status, "observed-no-retries");
    writeFileSync(join(directory, "guards.jsonl"), text(start, retry("fail"), finish({ ...counts, firstPass: 1, failed: 1 })));
    const failure = collectRetryReport(directory, runId, { "ci-contract": "success", patches: "success", guards: "success" }, []);
    assert.equal(failure.checks[2].status, "incomplete");
    assert.match(failure.checks[2].issues.join(","), /command-outcome-contradicts-observation/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
