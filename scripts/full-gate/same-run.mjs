import { posix, win32 } from "node:path";
import { readFileSync } from "node:fs";
import { requireInstallation } from "./install-policy.ts";
import { GROUPS, insist, digest } from "./core.mjs";
import { regularBytes } from "./artifact-input.mjs";

export const PLATFORM_JOBS = [
  { name: "broker-vitest", platform: "linux", runner: "ubuntu-24.04" },
  { name: "control-plane-vitest", platform: "win32", runner: "windows-2025" },
];
export const WORKFLOW_PATH = ".github/workflows/entropybot-full-gate.yml";
export function utcSecond(value) {
  insist(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value), "missing/invalid UTC job timestamp");
  const parsed = Date.parse(value);
  insist(Number.isFinite(parsed) && new Date(parsed).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z"), "invalid UTC calendar timestamp");
  return Math.floor(parsed / 1000);
}
function jobWindow(job) {
  const start = utcSecond(job.started_at);
  const end = utcSecond(job.completed_at);
  insist(start <= end, "invalid API job window");
  return [start, end];
}
export function artifactJobs(jobs, artifacts, binding, captured = false) {
  const expected = [...GROUPS, "static-checks"].map(name => `full-gate-${name}`).sort();
  insist(Array.isArray(artifacts) && JSON.stringify(artifacts.map(a => a.name).sort()) === JSON.stringify(expected), "missing/extra/duplicate lane artifacts");
  insist(new Set(artifacts.map(a => a.id)).size === artifacts.length, "duplicate artifact identity");
  const mapped = artifacts.map(artifact => {
    const job = jobs.find(j => artifact.name === `full-gate-${j.name}`);
    insist(job && job.name !== "full-gate-verdict" && Number.isSafeInteger(artifact.id) && artifact.id > 0 && artifact.expired === false, "invalid per-job artifact identity");
    insist(String(artifact.workflow_run?.id) === binding.runId && artifact.workflow_run?.head_sha === binding.sourceSha, "artifact is not from this workflow run/source");
    insist(!captured && artifact.jobId === undefined || artifact.jobId === job.id, "artifact copied between API jobs");
    const [start, end] = jobWindow(job);
    const created = utcSecond(artifact.created_at);
    insist(created >= start && created <= end, "artifact creation is outside API job window");
    return { ...artifact, jobId: job.id };
  });
  insist(new Set(mapped.map(a => a.jobId)).size === mapped.length, "lane artifacts do not map one-to-one to distinct jobs");
  return mapped;
}
export function workflowJobs(jobs, binding) {
  const expected = [...GROUPS, "static-checks", "full-gate-verdict"].sort();
  insist(Array.isArray(jobs) && JSON.stringify(jobs.map(j => j.name).sort()) === JSON.stringify(expected), "missing/extra/duplicate same-run matrix job");
  insist(new Set(jobs.map(j => j.id)).size === jobs.length, "duplicate same-run API job identity");
  for (const job of jobs) {
    insist(Number.isSafeInteger(job.id) && job.id > 0 && String(job.run_id) === binding.runId && job.run_attempt === 1 && job.head_sha === binding.sourceSha, "same-run job provenance mismatch");
    insist(job.name === "full-gate-verdict" || job.status === "completed" && job.conclusion === "success", "same-run producer job failed or incomplete");
    if (job.name !== "full-gate-verdict") jobWindow(job);
  }
  for (const target of PLATFORM_JOBS) insist(jobs.find(j => j.name === target.name)?.labels?.includes(target.runner), "matrix job runner/platform mismatch");
}
export function executionEnvironment(receipt, installation, mailFixture) {
  const env = receipt.command?.env;
  const paths = receipt.platform === "win32" ? win32 : posix;
  const allowed = ["PATH", "HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "OMB_EVAL_LIVE", "OMB_VITEST_WORKERS", "CI", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "NODE_EXTRA_CA_CERTS", "FULL_GATE_TARGET_PLATFORM"];
  insist(env && Object.keys(env).every(k => allowed.includes(k)), "unapproved execution environment variable (including NODE_OPTIONS)");
  insist(Object.values(env).every(v => typeof v === "string" && !/(?:^|\s)(?:--import|--require|--eval|--print|--check|-e|-p|-c)(?:=|\s|$)/.test(v)), "execution environment contains a Node command override");
  insist(env.FULL_GATE_TARGET_PLATFORM === undefined || env.FULL_GATE_TARGET_PLATFORM === receipt.platform, "execution environment platform mismatch");
  insist(env.OMB_EVAL_LIVE === "0" && (env.CI === undefined || env.CI === "true") && (env.OMB_VITEST_WORKERS === undefined || /^[12]$/.test(env.OMB_VITEST_WORKERS)), "execution environment enables unapproved mode");
  insist(paths.isAbsolute(env.HOME ?? "") && env.HOME === receipt.isolation?.home && env.USERPROFILE === env.HOME && env.XDG_CONFIG_HOME === paths.join(env.HOME, "config") && env.XDG_CACHE_HOME === paths.join(env.HOME, "cache"), "execution environment is not an owned synthetic home");
  insist(paths.isAbsolute(installation.tempRoot ?? ""), "missing owned execution temporary root");
  const relative = paths.relative(installation.tempRoot, env.HOME);
  insist(relative && relative !== ".." && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative), "execution home escapes owned temporary root");
  insist(typeof env.PATH === "string" && env.PATH.split(paths.delimiter).every(p => paths.isAbsolute(p)), "execution PATH is not explicit and absolute");
  insist(env.GIT_CONFIG_NOSYSTEM === "1" && env.GIT_CONFIG_GLOBAL === (receipt.platform === "win32" ? "NUL" : "/dev/null"), "execution Git config is not isolated");
  if (env.NODE_EXTRA_CA_CERTS !== undefined) insist(mailFixture && env.NODE_EXTRA_CA_CERTS === mailFixture.path && receipt.mailCAHash === mailFixture.sha256 && /^[a-f0-9]{64}$/.test(mailFixture.sha256), "unapproved mail fixture CA environment");
}
// Structural inspection preserves receipt-parser regression coverage; it does not qualify an installation.
export function inspectSameRunEvidence(input, binding, lockHash, { mailFixture } = {}) {
  insist(input?.sourceSha === binding.sourceSha && input.runId === binding.runId && input.attempt === "1" && input.workflow === WORKFLOW_PATH, "same-run collection identity mismatch");
  workflowJobs(input.jobs, binding);
  artifactJobs(input.jobs, input.artifacts, binding, true);
  insist(Array.isArray(input.matrix) && input.matrix.length === PLATFORM_JOBS.length, "missing same-run matrix artifacts");
  const references = new Map();
  for (const target of PLATFORM_JOBS) {
    const lanes = input.matrix.filter(l => l.jobName === target.name);
    insist(lanes.length === 1, "duplicate/missing same-run platform lane");
    const lane = lanes[0];
    const job = input.jobs.find(j => j.name === target.name);
    insist(lane.sourceSha === binding.sourceSha && lane.runId === binding.runId && lane.attempt === "1" && lane.platform === target.platform && lane.status === "passed", "matrix execution failed or has wrong source/run/platform");
    const install = lane.installation;
    const paths = target.platform === "win32" ? win32 : posix;
    insist(install?.sourceSha === binding.sourceSha && install.frozen === true && install.lockHash === lockHash && paths.isAbsolute(install.root), "unapproved source dependency installation");
    const pathKey = p => target.platform === "win32" ? paths.normalize(p).toLowerCase() : paths.normalize(p);
    const expected = paths.join(install.root, "node_modules/vitest/vitest.mjs");
    insist(install.entry?.path === expected && paths.isAbsolute(install.entry.resolvedPath) && /^[a-f0-9]{64}$/.test(install.entry.sha256), "unapproved resolved test entry");
    const relative = paths.relative(paths.join(install.root, "node_modules"), install.entry.resolvedPath);
    insist(relative && relative !== ".." && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative), "resolved test entry escapes source dependencies");
    insist(pathKey(install.entry.resolvedPath) === pathKey(expected) ? install.entry.target === null : install.entry.target === install.entry.resolvedPath, "symlinked test entry missing recorded approved target");
    insist(paths.isAbsolute(install.node?.path ?? "") && paths.isAbsolute(install.node?.resolvedPath ?? "") && /^[a-f0-9]{64}$/.test(install.node?.sha256 ?? ""), "unapproved Node executable identity");
    insist(Array.isArray(lane.executions), "missing same-run execution receipts");
    for (const execution of lane.executions) {
      const receipt = execution.receipt;
      insist(receipt?.kind === "execution-receipt" && receipt.schemaVersion === 2 && receipt.jobName === target.name && receipt.jobId === job.id && receipt.runId === binding.runId && receipt.attempt === "1" && receipt.sourceSha === binding.sourceSha && receipt.platform === target.platform, "execution receipt job/run/attempt/source/platform mismatch");
      const [jobStart, jobEnd] = jobWindow(job);
      const started = utcSecond(receipt.startedAt);
      const finished = utcSecond(receipt.finishedAt);
      insist(started >= jobStart && finished <= jobEnd && started <= finished, "execution is outside its exact API job window");
      insist(typeof receipt.id === "string" && receipt.id.startsWith(`this-run:${target.name}:`) && !references.has(receipt.id), "duplicate or external execution reference");
      const approved = receipt.report?.format === "node-events" ? install.nodeTests?.[receipt.assertion?.file] : install.entry;
      insist(approved && JSON.stringify(receipt.entry) === JSON.stringify(approved) && /^[a-f0-9]{64}$/.test(approved.sha256) && paths.isAbsolute(approved.resolvedPath) && (approved.path === approved.resolvedPath ? approved.target === null : approved.target === approved.resolvedPath), "execution entry has no approved resolved identity/target");
      if (receipt.report?.format === "node-events") insist(approved.path === paths.join(install.root, receipt.assertion.file) && approved.resolvedPath === approved.path, "Node test entry is not a checked-out source file");
      insist(receipt.report?.root === install.root && receipt.command?.cwd === install.root && receipt.command.argv[0] === install.node.path, "execution cwd/entry not bound to checked-out source installation");
      executionEnvironment(receipt, install, mailFixture);
      insist(digest(execution.report) === receipt.report.sha256, "same-run original report hash mismatch");
      references.set(receipt.id, { receipt, report: execution.report, installation: install, jobId: job.id });
    }
  }
  return {
    resolve(reference) {
      const value = references.get(reference);
      insist(value, "missing execution reference from this workflow run");
      return value;
    },
  };
}
export function sameRunEvidence(input, binding, lockHash, approvals = {}) {
  const inspected = inspectSameRunEvidence(input, binding, lockHash, approvals);
  const policy = JSON.parse(readFileSync(new URL("./install-policy.json", import.meta.url), "utf8"));
  for (const lane of input.matrix) requireInstallation(lane.installation?.observation, { ...binding, attempt: "1", job: lane.jobName, platform: lane.platform, arch: lane.installation?.arch }, policy);
  return inspected;
}
export function loadSameRun(directory, binding, lockHash, approvals = {}) {
  const collection = JSON.parse(regularBytes(`${directory}/collection.json`));
  const matrix = PLATFORM_JOBS.map(target => {
    const lane = JSON.parse(regularBytes(`${directory}/${target.name}/platform.json`));
    return { ...lane, executions: lane.executions.map(row => {
      insist(/^[a-f0-9]{64}$/.test(row.reportHash), "invalid same-run report path");
      return { receipt: row.receipt, report: regularBytes(`${directory}/${target.name}/${row.reportHash}.${row.receipt.report.format === "node-events" ? "jsonl" : "json"}`) };
    }) };
  });
  return sameRunEvidence({ ...collection, matrix }, binding, lockHash, approvals);
}
