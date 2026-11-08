import { appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findRetryEntry, loadRetryList } from "./ci-retry-list.mjs";
import { initializeRetryLogs, parseObservation, readObservation, RETRY_CHECKS, writeRetryReport } from "./ci-retry-observation.mjs";

const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const escapeData = (text) => String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (text) => escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** @param {string} logText @param {import('./ci-retry-list.mjs').RetryEntry[]} list @param {{runId?: string}} options */
export function retrySummary(logText, list, options = {}) {
  const parsed = parseObservation(logText, options.runId);
  const { rows, listErrors, ...result } = parsed;
  const annotations = listErrors.map((message) => `::warning title=${escapeProperty("Flaky-test list unreadable")}::${escapeData(message)}`);
  let markdown = listErrors.length ? ["### The flaky-test list could not be read", "", ...listErrors.map((message) => `- ${cell(message)}`), "", "Observation totals are unknown.", ""].join("\n") : "";
  if (rows.length) {
    markdown += ["### Flaky tests that needed a retry", "", "| Test | Retries | Result | Owner | Why it is listed |", "|---|---|---|---|---|",
      ...rows.map((row) => {
        const entry = findRetryEntry(list, row);
        return `| \`${cell(row.file)}\` > ${cell(row.test)} | ${row.retries} | ${row.state === "pass" ? "passed on a retry" : "failed every attempt"} | ${cell(entry?.owner ?? "unlisted")} | ${cell(entry?.reason)} |`;
      }), ""].join("\n");
    annotations.push(...rows.map((row) => `::warning file=${escapeProperty(row.file)},title=Flaky test retried::${escapeData(`${row.test} needed ${row.retries} retries (${row.state === "pass" ? "passed" : "failed"}).`)}`));
  }
  if (result.status === "incomplete" && !listErrors.length) annotations.push(`::warning title=Retry observation incomplete::${escapeData(result.issues.join(", "))}`);
  if (result.status === "incomplete") markdown += "\nRetry observation is incomplete; missing evidence is not zero retries.\n";
  return { ...result, markdown, annotations };
}

function unknown(issue) {
  return { status: "incomplete", counts: null, issues: [issue], markdown: "Retry observation is incomplete; totals are unknown.\n", annotations: [`::warning title=Retry observation incomplete::${issue}`] };
}

export function collectRetryReport(directory, runId, outcomes, list) {
  let manifestValid = false;
  try {
    const manifest = JSON.parse(readObservation(join(directory, "manifest.json")));
    manifestValid = manifest.schemaVersion === 1 && manifest.runId === runId && typeof runId === "string" && JSON.stringify(manifest.checks) === JSON.stringify(RETRY_CHECKS);
  } catch { /* incomplete evidence is reported below */ }
  const checks = RETRY_CHECKS.map((check) => {
    const commandOutcome = outcomes?.[check];
    let text;
    try { text = readObservation(join(directory, `${check}.jsonl`)); } catch { /* missing is unknown */ }
    let result;
    if (!manifestValid) result = unknown("manifest-unavailable-or-mismatched");
    else if (!["success", "failure", "cancelled", "skipped"].includes(commandOutcome)) result = unknown("command-outcome-unavailable");
    else if (commandOutcome === "skipped" && !text?.trim()) result = { status: "not_run", counts: null, issues: [], markdown: "", annotations: [] };
    else if (text === undefined) result = unknown("log-unavailable");
    else {
      result = retrySummary(text, list, { runId });
      if (commandOutcome === "skipped" || commandOutcome === "success" && result.counts && result.counts.retriedFailed + result.counts.failedWithoutRetry > 0) result = unknown("command-outcome-contradicts-observation");
    }
    return { check, commandOutcome: commandOutcome ?? "unknown", ...result };
  });
  return { schemaVersion: 1, runId: runId ?? null, status: checks.some((check) => check.status === "incomplete") ? "incomplete" : "observed", checks,
    limitations: ["Root Vitest runner observations only; skipped/todo and Node/eval subprocess coverage are not inferred.", "Observation success does not replace the test command exit status or the full verification gate."] };
}

function main() {
  const directory = process.env.OMB_VITEST_RETRY_DIRECTORY;
  const runId = process.env.OMB_VITEST_RETRY_RUN_ID;
  if (process.argv.length > 3 || process.argv[2] && process.argv[2] !== "--init") throw new Error("Usage: ci-retry-summary.mjs [--init]");
  if (process.argv[2] === "--init") {
    if (!directory) throw new Error("retry directory required");
    initializeRetryLogs(directory, runId);
    return;
  }
  let list = [];
  let listUnavailable = false;
  try { list = loadRetryList(); if (!Array.isArray(list)) throw new Error("invalid list"); } catch { listUnavailable = true; }
  let outcomes;
  try { outcomes = JSON.parse(process.env.OMB_VITEST_RETRY_OUTCOMES ?? "null"); } catch { /* unknown outcomes */ }
  const report = directory ? collectRetryReport(directory, runId, outcomes, list) : { status: "incomplete", checks: [{ check: "unknown", commandOutcome: "unknown", ...unknown("retry-directory-unavailable") }] };
  if (listUnavailable) {
    report.status = "incomplete";
    for (const check of report.checks) Object.assign(check, unknown("retry-list-unavailable"));
  }
  const markdown = ["## CI retry observations", "", "| Check | Command outcome | Observation | First pass | Passed after retry | Failed |", "|---|---|---|---|---|---|",
    ...report.checks.map((check) => `| ${cell(check.check)} | ${cell(check.commandOutcome)} | ${cell(check.status)} | ${check.counts?.firstPass ?? "unknown"} | ${check.counts?.retriedPass ?? "unknown"} | ${check.counts ? check.counts.retriedFailed + check.counts.failedWithoutRetry : "unknown"} |`), "", ...report.checks.map((check) => check.markdown)].join("\n");
  for (const check of report.checks) for (const annotation of check.annotations) console.log(annotation);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  if (directory) writeRetryReport(directory, report);
  console.log(JSON.stringify(report));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
