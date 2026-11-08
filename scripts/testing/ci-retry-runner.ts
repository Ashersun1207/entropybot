// vitest's own runner plus CI-only retries for the known flaky tests in
// ci-retry-list.json; a test that needed a retry is logged to
// OMB_VITEST_RETRY_LOG for the job summary. Retries are bounded per file: once
// a listed test fails every attempt, the file's later listed tests get none.
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { RunnerTask, RunnerTestCase, RunnerTestFile } from "vitest";
import { VitestTestRunner } from "vitest/runners";
import { CI_RETRIES, findRetryEntry, loadRetryList, retriesInCi, testIdentity } from "./ci-retry-list.mjs";

// Fails open: the list is a CI convenience, and a list that cannot be read
// must never fail a run whose tests all passed.
const list = retriesInCi() ? safeRetryList() : [];

function safeRetryList() {
  try {
    return loadRetryList();
  } catch (error) {
    const message = `the flaky-test list could not be read, so no test is retried: ${String(error)}`;
    console.warn(`ci-retry-runner: ${message}`);
    // The summary step reports it, so a broken list is seen, not just survived.
    const log = process.env.OMB_VITEST_RETRY_LOG;
    if (log) {
      try { appendFileSync(log, `${JSON.stringify({ listError: message })}\n`); } catch { /* the warning above remains */ }
    }
    return [];
  }
}

export default class CiRetryRunner extends VitestTestRunner {
  /** Files where a listed test failed every attempt: no more retries there. */
  private readonly exhausted = new Set<string>();
  private readonly counts = { firstPass: 0, retriedPass: 0, retriedFailed: 0, failedWithoutRetry: 0, other: 0 };
  private readonly batchId = `${process.env.OMB_VITEST_RETRY_BATCH_ID ?? "batch"}-${randomUUID()}`;
  private readonly runId = process.env.OMB_VITEST_RETRY_RUN_ID;

  // The installed VitestTestRunner declares no onBeforeRunFiles member, so this
  // must not be an override; the runtime calls it when present.
  onBeforeRunFiles(files: RunnerTestFile[]) {
    const log = process.env.OMB_VITEST_RETRY_LOG;
    if (log) {
      const record = { schemaVersion: 1, runId: this.runId, batchId: this.batchId, kind: "start", files: files.map((file) => this.relPath(file.filepath)) };
      try { appendFileSync(log, `${JSON.stringify(record)}\n`); } catch (error) { console.warn(`ci-retry-runner: could not record a start: ${String(error)}`); }
    }
  }

  override onAfterRunFiles() {
    const log = process.env.OMB_VITEST_RETRY_LOG;
    if (log) {
      const record = { schemaVersion: 1, runId: this.runId, batchId: this.batchId, kind: "finish", counts: { ...this.counts } };
      try { appendFileSync(log, `${JSON.stringify(record)}\n`); } catch (error) { console.warn(`ci-retry-runner: could not record a finish: ${String(error)}`); }
    }
    return super.onAfterRunFiles();
  }

  private relPath(filepath: string) {
    const file = testIdentity(this.config.root, { name: "", file: { filepath } as RunnerTestFile });
    return file.file;
  }

  override onBeforeRunTask(test: RunnerTestCase) {
    if (list.length > 0 && !this.exhausted.has(test.file.filepath) && findRetryEntry(list, testIdentity(this.config.root, test))) test.retry = CI_RETRIES;
    return super.onBeforeRunTask(test);
  }

  override onAfterRunTask(test: RunnerTask) {
    super.onAfterRunTask(test);
    if (test.type === "test") {
      const retries = test.result?.retryCount ?? 0;
      const state = test.result?.state;
      if (state === "pass") { if (retries > 0) this.counts.retriedPass += 1; else this.counts.firstPass += 1; }
      else if (state === "fail") { if (retries > 0) this.counts.retriedFailed += 1; else this.counts.failedWithoutRetry += 1; }
      else this.counts.other += 1;
      if (retries > 0 && state === "fail") this.exhausted.add(test.file.filepath);
    }
    const retries = test.type === "test" ? (test.result?.retryCount ?? 0) : 0;
    const log = process.env.OMB_VITEST_RETRY_LOG;
    if (retries === 0 || !log || test.type !== "test") return;
    const line = { schemaVersion: 1, kind: "retry", ...testIdentity(this.config.root, test), retries, state: test.result?.state, platform: process.platform, runId: this.runId, batchId: this.batchId };
    try {
      appendFileSync(log, `${JSON.stringify(line)}\n`);
    } catch (error) {
      console.warn(`ci-retry-runner: could not record a retry in ${log}: ${String(error)}`);
    }
  }
}
