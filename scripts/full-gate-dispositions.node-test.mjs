import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { CLASSES, canonical, reconcile, proposedDispositions } from "./full-gate/dispositions.mjs";
import { digest, vitestResults, strictTap } from "./full-gate/core.mjs";
import { nodeResults } from "./full-gate/node-results.mjs";
import { REQUIRED_ASSETS, assetDigest, assetIssues, preflight } from "./full-gate/preflight.mjs";
import { regularBytes } from "./full-gate/artifact-input.mjs";
import { ROOT } from "./full-gate/runner.mjs";
import { bootstrap } from "./full-gate/bootstrap.mjs";
import { GROUPS, reportFile } from "./full-gate/core.mjs";
import { sameRunEvidence, loadSameRun, PLATFORM_JOBS, WORKFLOW_PATH } from "./full-gate/same-run.mjs";
import { captureExecutionPaths, validateExecutionPaths } from "./full-gate/execution-paths.mjs";

const sha = "a".repeat(40);
const binding = { sourceSha: sha, runId: "99" };
const identity = { group: "main-vitest-01", file: "test.ts", fullName: "suite only Linux" };
function report(status = "passed") {
  return { success: true, numTotalTests: 1, numPassedTests: status === "passed" ? 1 : 0, numPendingTests: status === "skipped" ? 1 : 0, numFailedTests: 0, numTodoTests: 0, numFailedTestSuites: 0, numPendingTestSuites: 0, testResults: [{ name: "/fixture/test.ts", status: "passed", assertionResults: [{ fullName: identity.fullName, status }] }] };
}
function jobs() {
  const started_at = new Date(Date.now() - 60000).toISOString();
  const completed_at = new Date().toISOString();
  return [...GROUPS, "static-checks", "full-gate-verdict"].map((name, index) => ({ id: index + 1, name, run_id: 99, run_attempt: 1, head_sha: sha, status: "completed", conclusion: "success", started_at, completed_at, labels: [PLATFORM_JOBS.find(t => t.name === name)?.runner ?? "macos-15"] }));
}
function laneArtifacts(jobRecords) {
  return [...GROUPS, "static-checks"].map((name, index) => {
    const job = jobRecords.find(j => j.name === name);
    return { id: index + 101, name: `full-gate-${name}`, jobId: job.id, created_at: job.completed_at, expired: false, workflow_run: { id: 99, head_sha: sha } };
  });
}
const lockHash = "d".repeat(64);
function installation(platform = "linux") {
  const root = platform === "linux" ? "/fixture" : "C:\\fixture";
  const entry = platform === "linux" ? `${root}/node_modules/vitest/vitest.mjs` : `${root}\\node_modules\\vitest\\vitest.mjs`;
  const node = platform === "linux" ? "/usr/bin/node" : "C:\\node\\node.exe";
  return { root, tempRoot: platform === "linux" ? "/private/tmp" : "C:\\tmp", sourceSha: sha, frozen: true, lockHash, entry: { path: entry, resolvedPath: entry, target: null, sha256: "e".repeat(64) }, node: { path: node, resolvedPath: node, target: null, sha256: "f".repeat(64) }, nodeTests: {} };
}
function syntheticPaths(install, arguments_ = [install.entry.path]) {
  const entries = arguments_.map(argument => {
    const path = argument.startsWith("/") ? argument : `${install.root}/${argument}`;
    const approved = [install.entry, ...Object.values(install.nodeTests)].find(row => row.path === path);
    const parts = path.slice(install.root.length + 1).split("/");
    const components = parts.map((_, i) => { const prefix = `${install.root}/${parts.slice(0, i + 1).join("/")}`; return { path: prefix, resolvedPath: i === parts.length - 1 ? approved.resolvedPath : prefix }; });
    return { argument, path, resolvedPath: approved.resolvedPath, sha256: approved.sha256, components };
  });
  return { root: install.root, cwd: { path: install.root, resolvedPath: install.root }, reportRoot: { path: install.root, resolvedPath: install.root }, entries };
}
function fixture(kind = "executed-in-this-run") {
  const keys = generateKeyPairSync("ed25519");
  const raw = Buffer.from(JSON.stringify(report()));
  const entry = { ...identity, class: kind, reason: "Linux process identity requires /proc", targetPlatform: "linux", evidenceRef: "linux-execution" };
  const evidence = { ...entry, id: "linux-execution", sourceSha: sha, reference: "this-run:broker-vitest:one", kind: "execution", status: "passed", reportHash: digest(raw), reportRoot: "/fixture", format: "vitest" };
  if (kind === "policy-prohibited") Object.assign(evidence, { kind: "policy", status: "prohibited", policyRef: "task:no-live-account", acceptanceReference: "controller:policy-disposition", reference: "controller:policy-disposition" });
  const date = new Date(Date.now() - 1000).toISOString();
  const scope = { ...identity, sourceSha: sha, runId: binding.runId, targetPlatform: "linux" };
  const controller = { id: "synthetic-controller", keyId: "fixture" };
  const reviewRecord = { schemaVersion: 1, id: "controller:review-1", kind: "controller-review", sourceSha: sha, runId: binding.runId, controller, date, decision: "accepted with dispositions", scope: [{ ...identity, targetPlatform: "linux", class: kind }] };
  const install = installation();
  const env = { PATH: "/usr/bin:/bin", HOME: "/private/tmp/fg-home", USERPROFILE: "/private/tmp/fg-home", XDG_CONFIG_HOME: "/private/tmp/fg-home/config", XDG_CACHE_HOME: "/private/tmp/fg-home/cache", OMB_EVAL_LIVE: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const execution = { schemaVersion: 2, id: evidence.reference, kind: "execution-receipt", jobName: "broker-vitest", jobId: 11, runId: "99", attempt: "1", sourceSha: sha, platform: "linux", entry: { ...install.entry }, isolation: { home: env.HOME }, filesystem: syntheticPaths(install), assertion: { ...identity, status: "passed" }, report: { sha256: digest(raw), root: "/fixture", format: "vitest" }, source: { before: { sha, tree: "c".repeat(40), clean: true }, after: { sha, tree: "c".repeat(40), clean: true } }, command: { argv: [install.node.path, install.entry.path, "run"], cwd: "/fixture", env, exitCode: 0, signal: null, timedOut: false, retries: 0 }, startedAt: date, finishedAt: date };
  const jobRecords = jobs();
  const collection = { ...binding, attempt: "1", workflow: WORKFLOW_PATH, jobs: jobRecords, artifacts: laneArtifacts(jobRecords), matrix: [
    { ...binding, attempt: "1", jobName: "broker-vitest", platform: "linux", status: "passed", installation: install, executions: [{ receipt: execution, report: raw }] },
    { ...binding, attempt: "1", jobName: "control-plane-vitest", platform: "win32", status: "passed", installation: installation("win32"), executions: [] },
  ] };
  const prohibition = { schemaVersion: 1, id: evidence.policyRef, kind: "policy-prohibition", scope, status: "prohibited", reason: entry.reason, prohibition: "Current task forbids live account and model execution", date };
  const acceptance = { schemaVersion: 1, id: evidence.acceptanceReference, kind: "policy-acceptance", scope, policyRef: evidence.policyRef, controller, date, decision: "accepted with dispositions" };
  const records = kind === "policy-prohibited" ? [reviewRecord, prohibition, acceptance] : [reviewRecord];
  const bundle = { ...binding, attempt: "1", entries: [entry], evidence: [evidence], records, controllerReview: { decision: "accepted with dispositions", keyId: "fixture", controllerId: controller.id, reference: reviewRecord.id } };
  const seal = () => {
    const { signature: _signature, ...review } = bundle.controllerReview;
    const unsigned = { ...bundle, controllerReview: review };
    bundle.controllerReview.signature = sign(null, Buffer.from(canonical(unsigned)), keys.privateKey).toString("base64");
  };
  seal();
  return { tests: [{ ...identity, status: "skipped" }], bundle, binding, execution, install, collection, options: { publicKeys: { fixture: keys.publicKey }, get sameRun() { return kind === "policy-prohibited" ? undefined : sameRunEvidence(collection, binding, lockHash); } }, seal };
}
for (const kind of CLASSES) test(`source-bound reviewed ${kind} skip remains a skip`, () => {
  const f = fixture(kind);
  assert.deepEqual(reconcile(f.tests, f.bundle, f.binding, f.options), { total: 1, passed: 0, skipped: 1, strictGreen: false, status: "accepted with dispositions" });
});
test("no skips and no exceptions can be strict green", () => {
  const result = reconcile([{ ...identity, status: "passed" }], { ...binding, attempt: "1", entries: [], evidence: [] }, binding);
  assert.equal(result.strictGreen, true); assert.equal(result.passed, 1);
});
for (const [name, mutate] of Object.entries({
  undeclared: f => { f.bundle.entries = []; },
  extra: f => { f.bundle.entries.push({ ...f.bundle.entries[0], fullName: "extra" }); },
  duplicate: f => { f.tests.push({ ...f.tests[0], fullName: "another" }); f.bundle.entries.push({ ...f.bundle.entries[0] }); },
  identity: f => { f.bundle.entries[0].fullName = "wrong name"; },
  group: f => { f.bundle.entries[0].group = "main-vitest-02"; },
  file: f => { f.bundle.entries[0].file = "other.ts"; },
  class: f => { f.bundle.entries[0].class = "blanket allowlist"; },
  multipleClasses: f => { f.bundle.entries[0].class = ["executed-in-this-run", "policy-prohibited"]; },
  reason: f => { f.bundle.entries[0].reason = ""; },
  reasonMismatch: f => { f.bundle.evidence[0].reason = "other reason"; },
  classMismatch: f => { f.bundle.evidence[0].class = "policy-prohibited"; },
  targetMismatch: f => { f.bundle.evidence[0].targetPlatform = "win32"; },
  missingReference: f => { f.bundle.entries[0].evidenceRef = null; },
  missingEvidence: f => { f.bundle.evidence = []; },
  unresolved: f => { f.bundle.entries[0].reason = "unresolved"; },
  wrongSHA: f => { f.bundle.sourceSha = "b".repeat(40); },
  wrongRun: f => { f.bundle.runId = "100"; },
  retry: f => { f.bundle.attempt = "2"; },
  staleEvidence: f => { f.bundle.evidence[0].sourceSha = "b".repeat(40); },
  alteredEvidence: f => { f.collection.matrix[0].executions[0].report = Buffer.from("altered"); },
  unexecuted: f => { const raw = Buffer.from(JSON.stringify(report("skipped"))); f.bundle.evidence[0].reportHash = digest(raw); f.execution.report.sha256 = digest(raw); f.collection.matrix[0].executions[0].report = raw; },
  evidenceStatus: f => { f.bundle.evidence[0].status = "unknown"; },
  duplicateEvidence: f => { f.bundle.evidence.push({ ...f.bundle.evidence[0] }); },
  extraEvidence: f => { f.bundle.evidence.push({ ...f.bundle.evidence[0], id: "unused" }); },
  missingReview: f => { delete f.bundle.controllerReview; },
  untrustedReview: f => { f.options.publicKeys = {}; },
  changedSignature: f => { f.bundle.controllerReview.signature = Buffer.alloc(64).toString("base64"); },
  duplicateReport: f => { f.tests.push({ ...f.tests[0] }); },
  pendingReport: f => { f.tests[0].status = "pending"; },
})) test(`disposition rejects ${name}`, () => {
  const f = fixture(); mutate(f);
  if (f.bundle.controllerReview && name !== "changedSignature") f.seal();
  assert.throws(() => reconcile(f.tests, f.bundle, f.binding, f.options));
});
for (const [name, kind, mutate] of [
  ["nonexistent execution reference", "executed-in-this-run", f => { f.bundle.evidence[0].reference = "nonexistent:target-run"; }],
  ["execution receipt wrong report hash", "executed-in-this-run", f => { f.execution.report.sha256 = "b".repeat(64); }],
  ["execution receipt stale source", "executed-in-this-run", f => { f.execution.sourceSha = "b".repeat(40); }],
  ["execution receipt wrong platform", "executed-in-this-run", f => { f.execution.platform = "win32"; }],
  ["execution receipt wrong assertion", "executed-in-this-run", f => { f.execution.assertion.fullName = "unrelated"; }],
  ["execution receipt dirty source", "executed-in-this-run", f => { f.execution.source.before.clean = false; }],
  ["execution receipt changed source", "executed-in-this-run", f => { f.execution.source.after.sha = "b".repeat(40); }],
  ["execution receipt failed command", "executed-in-this-run", f => { f.execution.command.exitCode = 1; }],
  ["execution receipt filtered command", "executed-in-this-run", f => { f.execution.command.argv.push("--testNamePattern=one"); }],
  ["execution receipt retry", "executed-in-this-run", f => { f.execution.command.retries = 1; }],
  ["execution receipt missing command", "executed-in-this-run", f => { delete f.execution.command; }],
  ["execution receipt missing report", "executed-in-this-run", f => { delete f.execution.report; }],
  ["execution receipt missing outcome", "executed-in-this-run", f => { delete f.execution.command.exitCode; }],
  ["execution receipt missing platform", "executed-in-this-run", f => { delete f.execution.platform; }],
  ["execution receipt missing source", "executed-in-this-run", f => { delete f.execution.source; }],
  ["execution receipt missing date", "executed-in-this-run", f => { delete f.execution.finishedAt; }],
  ["nonexistent policy reference", "policy-prohibited", f => { f.bundle.evidence[0].policyRef = "nonexistent:prohibition"; }],
  ["nonexistent acceptance reference", "policy-prohibited", f => { f.bundle.evidence[0].acceptanceReference = "nonexistent:acceptance"; }],
  ["policy missing prohibition", "policy-prohibited", f => { delete f.bundle.records[1].prohibition; }],
  ["policy wrong identity", "policy-prohibited", f => { f.bundle.records[1].scope = { ...f.bundle.records[1].scope, fullName: "unrelated" }; }],
  ["policy stale source", "policy-prohibited", f => { f.bundle.records[1].scope = { ...f.bundle.records[1].scope, sourceSha: "b".repeat(40) }; }],
  ["policy wrong target", "policy-prohibited", f => { f.bundle.records[1].scope = { ...f.bundle.records[1].scope, targetPlatform: "win32" }; }],
  ["acceptance missing controller", "policy-prohibited", f => { delete f.bundle.records[2].controller; }],
  ["acceptance missing date", "policy-prohibited", f => { delete f.bundle.records[2].date; }],
  ["acceptance missing scope", "policy-prohibited", f => { delete f.bundle.records[2].scope; }],
  ["acceptance wrong controller", "policy-prohibited", f => { f.bundle.records[2].controller = { id: "other", keyId: "fixture" }; }],
  ["acceptance wrong run", "policy-prohibited", f => { f.bundle.records[2].scope = { ...f.bundle.records[2].scope, runId: "100" }; }],
  ["acceptance wrong target", "policy-prohibited", f => { f.bundle.records[2].scope = { ...f.bundle.records[2].scope, targetPlatform: "win32" }; }],
  ["acceptance wrong prohibition", "policy-prohibited", f => { f.bundle.records[2].policyRef = "other:policy"; }],
  ["valid signature without same-run receipts", "executed-in-this-run", f => { f.collection.matrix[0].executions = []; }],
  ["valid signature without policy records", "policy-prohibited", f => { f.bundle.records = [f.bundle.records[0]]; }],
  ["nonexistent controller review reference", "executed-in-this-run", f => { f.bundle.controllerReview.reference = "nonexistent:review"; }],
  ["duplicate provenance record", "executed-in-this-run", f => { f.bundle.records.push({ ...f.bundle.records[0] }); }],
  ["execution receipt missing assertion", "executed-in-this-run", f => { delete f.execution.assertion; }],
  ["execution receipt missing cwd", "executed-in-this-run", f => { delete f.execution.command.cwd; }],
  ["execution receipt eval command", "executed-in-this-run", f => { f.execution.command.argv.splice(1, 0, "--eval", "console.log(1)"); }],
  ["execution receipt command format mismatch", "executed-in-this-run", f => { f.execution.command.argv = ["node", "--test", "fixture.mjs"]; }],
  ["policy missing source scope", "policy-prohibited", f => { f.bundle.records[1].scope = { ...f.bundle.records[1].scope }; delete f.bundle.records[1].scope.sourceSha; }],
  ["policy missing target scope", "policy-prohibited", f => { f.bundle.records[1].scope = { ...f.bundle.records[1].scope }; delete f.bundle.records[1].scope.targetPlatform; }],
  ["policy missing date", "policy-prohibited", f => { delete f.bundle.records[1].date; }],
  ["acceptance missing decision", "policy-prohibited", f => { delete f.bundle.records[2].decision; }],
  ["acceptance missing key identity", "policy-prohibited", f => { f.bundle.records[2].controller = { id: "synthetic-controller" }; }],
  ["acceptance future date", "policy-prohibited", f => { f.bundle.records[2].date = "9999-01-01T00:00:00.000Z"; }],
  ["review wrong scope", "executed-in-this-run", f => { f.bundle.records[0].scope[0].file = "another.ts"; }],
  ["review missing date", "executed-in-this-run", f => { delete f.bundle.records[0].date; }],
  ["extra unreferenced provenance", "executed-in-this-run", f => { f.bundle.records.push({ ...f.bundle.records[0], id: "extra:receipt" }); }],
]) test(`resolved provenance rejects ${name} despite valid signature`, () => {
  const f = fixture(kind); mutate(f); f.seal();
  assert.throws(() => reconcile(f.tests, f.bundle, f.binding, f.options));
});
function nodeFixture() {
  const f = fixture();
  const row = { ...identity, file: "test.node-test.mjs" };
  f.tests[0] = { ...row, status: "skipped" };
  Object.assign(f.bundle.entries[0], row);
  Object.assign(f.bundle.evidence[0], row, { format: "node-events" });
  Object.assign(f.bundle.records[0].scope[0], row);
  const receipt = f.execution;
  Object.assign(receipt.assertion, row);
  const data = { file: "/fixture/test.node-test.mjs", entryFile: "/fixture/test.node-test.mjs", testId: 1, parentId: 0, name: row.fullName };
  const raw = Buffer.from([
    { type: "test:enqueue", data },
    { type: "test:pass", data: { ...data, details: { type: "test" } } },
    { type: "test:summary", data: { success: true, counts: { tests: 1, passed: 1, skipped: 0, failed: 0, cancelled: 0, todo: 0 } } },
  ].map(event => JSON.stringify(event)).join("\n"));
  f.bundle.evidence[0].reportHash = digest(raw);
  Object.assign(receipt.report, { sha256: digest(raw), format: "node-events" });
  receipt.command.argv = [f.install.node.path, "--test", "test.node-test.mjs"];
  const nodeEntry = { path: "/fixture/test.node-test.mjs", resolvedPath: "/fixture/test.node-test.mjs", target: null, sha256: "e".repeat(64) };
  f.install.nodeTests[row.file] = nodeEntry;
  receipt.entry = { ...nodeEntry };
  receipt.filesystem = syntheticPaths(f.install, ["test.node-test.mjs"]);
  f.collection.matrix[0].executions[0].report = raw;
  f.seal();
  return f;
}
const vitestEntry = "/fixture/node_modules/vitest/vitest.mjs";
const lifecycle = "file:///fixture/scripts/testing/verification-lifecycle.ts?gate=/private/tmp/fixture-bootstrap.json";
for (const [name, argv] of [
  ["reported version bypass", ["node", "--version", "vitest.mjs", "run"]],
  ["version", ["node", "--version", vitestEntry, "run"]],
  ["short version", ["node", "-v", vitestEntry, "run"]],
  ["help", ["node", "--help", vitestEntry, "run"]],
  ["short help", ["node", "-h", vitestEntry, "run"]],
  ["eval", ["node", "--eval", "console.log(1)", vitestEntry, "run"]],
  ["short eval", ["node", "-e", "console.log(1)", vitestEntry, "run"]],
  ["print", ["node", "--print", "1", vitestEntry, "run"]],
  ["short print", ["node", "-p", "1", vitestEntry, "run"]],
  ["syntax check", ["node", "--check", vitestEntry, "run"]],
  ["short syntax check", ["node", "-c", vitestEntry, "run"]],
  ["entry not first script", ["node", "unrelated.mjs", vitestEntry, "run"]],
  ["run before entry", ["node", "run", vitestEntry]],
  ["bare lookalike entry", ["node", "vitest.mjs", "run"]],
  ["entry outside cwd dependencies", ["node", "/other/node_modules/vitest/vitest.mjs", "run"]],
  ["help before run", ["node", vitestEntry, "--help", "run"]],
  ["Vitest help after run", ["node", vitestEntry, "run", "--help"]],
  ["Vitest version after run", ["node", vitestEntry, "run", "--version"]],
  ["missing run subcommand", ["node", vitestEntry]],
  ["positional subset filter", ["node", vitestEntry, "run", "selected.test.ts"]],
  ["test-only", ["node", "--test-only", vitestEntry, "run"]],
  ["unsupported pre-entry flag", ["node", "--no-warnings", vitestEntry, "run"]],
  ["unapproved import", ["node", "--import", "file:///fixture/early-exit.mjs", vitestEntry, "run"]],
]) test(`effective Vitest command rejects ${name} with a valid signature`, () => {
  const f = fixture(); f.execution.command.argv = [f.install.node.path, ...argv.slice(1)]; f.seal();
  assert.throws(() => reconcile(f.tests, f.bundle, f.binding, f.options));
});
for (const [name, argv] of [
  ["version before test mode", ["node", "--version", "--test", "test.node-test.mjs"]],
  ["help before test mode", ["node", "--help", "--test", "test.node-test.mjs"]],
  ["eval before test mode", ["node", "-e", "console.log(1)", "--test", "test.node-test.mjs"]],
  ["script before test mode", ["node", "unrelated.mjs", "--test", "test.node-test.mjs"]],
  ["test-only selection", ["node", "--test", "--test-only", "test.node-test.mjs"]],
  ["missing file entry", ["node", "--test"]],
  ["different file entry", ["node", "--test", "other.node-test.mjs"]],
  ["help after file", ["node", "--test", "test.node-test.mjs", "--help"]],
]) test(`effective Node test command rejects ${name} with a valid signature`, () => {
  const f = nodeFixture(); f.execution.command.argv = [f.install.node.path, ...argv.slice(1)]; f.seal();
  assert.throws(() => reconcile(f.tests, f.bundle, f.binding, f.options));
});
for (const [name, makeFixture, argv] of [
  ["Vitest dependency entry and run", fixture, ["node", vitestEntry, "run"]],
  ["Vitest approved bootstrap and runner options", fixture, ["node", "--import", lifecycle, vitestEntry, "run", "--config", "vite.config.ts", "--runner", "/fixture/scripts/full-gate/strict-runner.ts", `--execArgv=--import=${lifecycle}`, "--maxWorkers", "2", "--reporter=json", "--outputFile=/private/tmp/report.json", "--shard=1/10"]],
  ["Node test file", nodeFixture, ["node", "--test", "test.node-test.mjs"]],
  ["Node approved bootstrap and reporters", nodeFixture, ["node", "--import", lifecycle, "--test", "--test-concurrency=2", "--test-reporter=tap", "--test-reporter-destination=/private/tmp/report.tap", "--test-reporter=/fixture/scripts/full-gate/node-reporter.mjs", "--test-reporter-destination=/private/tmp/events.jsonl", "test.node-test.mjs"]],
]) test(`effective command accepts legitimate ${name} without converting skips to passes`, () => {
  const f = makeFixture(); f.execution.command.argv = [f.install.node.path, ...argv.slice(1)]; f.seal();
  assert.deepEqual(reconcile(f.tests, f.bundle, f.binding, f.options), { total: 1, passed: 0, skipped: 1, strictGreen: false, status: "accepted with dispositions" });
});
for (const [name, mutate] of [
  ["NODE_OPTIONS data import", f => { f.execution.command.env.NODE_OPTIONS = "--import=data:text/javascript,process.exit(0)"; }],
  ["NODE_OPTIONS require", f => { f.execution.command.env.NODE_OPTIONS = "--require=/tmp/exit.cjs"; }],
  ["empty NODE_OPTIONS", f => { f.execution.command.env.NODE_OPTIONS = ""; }],
  ["unapproved variable", f => { f.execution.command.env.UNAPPROVED = "1"; }],
  ["unapproved CA", f => { f.execution.command.env.NODE_EXTRA_CA_CERTS = "/tmp/foreign.pem"; }],
  ["Node flag in allowed environment value", f => { f.execution.command.env.PATH = "/usr/bin --import=data:text/javascript,process.exit(0)"; }],
  ["check flag in absolute environment value", f => { f.execution.command.env.PATH = "/usr/bin --check"; }],
  ["foreign cwd and dependency entry", f => { f.execution.command.cwd = "/other"; f.execution.command.argv[1] = "/other/node_modules/vitest/vitest.mjs"; }],
  ["foreign report root", f => { f.execution.report.root = "/other"; }],
  ["unrecorded symlink target", f => { f.install.entry.resolvedPath = "/fixture/node_modules/.pnpm/vitest/node_modules/vitest/vitest.mjs"; f.execution.entry = { ...f.install.entry }; }],
  ["entry outside approved installation", f => { f.execution.entry.resolvedPath = "/other/vitest.mjs"; }],
  ["wrong run", f => { f.execution.runId = "100"; }],
  ["wrong attempt", f => { f.execution.attempt = "2"; }],
  ["wrong source", f => { f.execution.sourceSha = "b".repeat(40); }],
  ["wrong platform", f => { f.execution.platform = "win32"; }],
  ["wrong receipt job", f => { f.execution.jobName = "main-vitest-01"; }],
  ["missing Windows matrix job", f => { f.collection.jobs = f.collection.jobs.filter(j => j.name !== "control-plane-vitest"); }],
  ["missing Linux matrix artifact", f => { f.collection.matrix.shift(); }],
  ["failed platform job", f => { f.collection.jobs.find(j => j.name === "broker-vitest").conclusion = "failure"; }],
  ["wrong API job source", f => { f.collection.jobs.find(j => j.name === "broker-vitest").head_sha = "b".repeat(40); }],
  ["wrong API runner", f => { f.collection.jobs.find(j => j.name === "broker-vitest").labels = ["macos-15"]; }],
  ["wrong API job run", f => { f.collection.jobs.find(j => j.name === "broker-vitest").run_id = 100; }],
  ["wrong API job attempt", f => { f.collection.jobs.find(j => j.name === "broker-vitest").run_attempt = 2; }],
  ["duplicate API job identity", f => { f.collection.jobs[1].id = f.collection.jobs[0].id; }],
  ["wrong lockfile approval", f => { f.install.lockHash = "b".repeat(64); }],
  ["missing sanitized environment", f => { delete f.execution.command.env; }],
  ["external signed execution receipt", f => { f.bundle.records.push(f.execution); }],
  ["removed executed-elsewhere class", f => { f.bundle.entries[0].class = f.bundle.evidence[0].class = f.bundle.records[0].scope[0].class = "environment-gated-but-executed-elsewhere"; }],
  ["legacy platform-only disposition", f => { f.bundle.entries[0].class = f.bundle.evidence[0].class = f.bundle.records[0].scope[0].class = "platform-specific"; }],
  ["external bundle cannot replace missing matrix execution", f => { f.collection.matrix[0].executions = []; f.bundle.records.push(f.execution); }],
  ["unapproved import argument", f => { f.execution.command.argv.splice(1, 0, "--import", "data:text/javascript,process.exit(0)"); }],
  ["unapproved require argument", f => { f.execution.command.argv.splice(1, 0, "--require", "/tmp/exit.cjs"); }],
]) test(`same-workflow evidence rejects ${name}`, () => {
  const f = fixture(); mutate(f); f.seal();
  assert.throws(() => reconcile(f.tests, f.bundle, f.binding, f.options));
});
test("same-workflow matrix receipt accepts an approved recorded pnpm symlink target", () => {
  const f = fixture();
  f.install.entry.resolvedPath = "/fixture/node_modules/.pnpm/vitest/node_modules/vitest/vitest.mjs";
  f.install.entry.target = f.install.entry.resolvedPath;
  f.execution.entry = { ...f.install.entry };
  f.execution.filesystem = syntheticPaths(f.install);
  assert.equal(reconcile(f.tests, f.bundle, f.binding, f.options).strictGreen, false);
});
test("external receipt callbacks cannot substitute for the collected workflow artifacts", () => {
  const f = fixture();
  Object.defineProperty(f.options, "sameRun", { value: undefined });
  f.options.loadEvidence = () => assert.fail("external report path must not be used");
  assert.throws(() => reconcile(f.tests, f.bundle, f.binding, f.options), /same-workflow/);
});
for (const stale of [false, true]) test(`collected same-run artifact loader ${stale ? "rejects a stale index" : "accepts a source-bound matrix receipt"}`, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fg-collected-")));
  const f = fixture();
  try {
    const { matrix, ...index } = f.collection;
    if (stale) index.runId = "100";
    writeFileSync(join(root, "collection.json"), JSON.stringify(index));
    for (const lane of matrix) {
      const directory = join(root, lane.jobName); mkdirSync(directory);
      const executions = lane.executions.map(row => {
        const reportHash = digest(row.report);
        writeFileSync(join(directory, `${reportHash}.json`), row.report);
        return { receipt: row.receipt, reportHash };
      });
      writeFileSync(join(directory, "platform.json"), JSON.stringify({ ...lane, executions }));
    }
    Object.defineProperty(f.options, "sameRun", { get: () => loadSameRun(root, binding, lockHash) });
    f.options.loadEvidence = () => assert.fail("external bytes must not replace matrix artifacts");
    if (stale) assert.throws(() => reconcile(f.tests, f.bundle, f.binding, f.options));
    else assert.equal(reconcile(f.tests, f.bundle, f.binding, f.options).status, "accepted with dispositions");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("CA environment is allowed only with an explicit source-approved mail fixture identity", () => {
  const f = fixture();
  const mailFixture = { path: "/private/tmp/fixture-ca.pem", sha256: "a".repeat(64) };
  f.execution.command.env.NODE_EXTRA_CA_CERTS = mailFixture.path;
  f.execution.mailCAHash = mailFixture.sha256;
  Object.defineProperty(f.options, "sameRun", { get: () => sameRunEvidence(f.collection, binding, lockHash, { mailFixture }) });
  assert.equal(reconcile(f.tests, f.bundle, f.binding, f.options).strictGreen, false);
  f.execution.mailCAHash = "b".repeat(64);
  assert.throws(() => reconcile(f.tests, f.bundle, f.binding, f.options));
});
for (const [name, mutate] of [
  ["wrong numeric job ID", f => { f.execution.jobId = 999999; }],
  ["stale execution timestamps", f => { f.execution.startedAt = f.execution.finishedAt = "2020-01-01T00:00:00.000Z"; }],
  ["execution before API job start", f => { f.execution.startedAt = new Date(Date.now() - 120000).toISOString(); }],
  ["execution after API job completion", f => { f.collection.jobs.find(j => j.name === "broker-vitest").completed_at = new Date(Date.now() - 10000).toISOString(); f.collection.artifacts.find(a => a.name === "full-gate-broker-vitest").created_at = new Date(Date.now() - 11000).toISOString(); }],
  ["future execution", f => { f.execution.startedAt = f.execution.finishedAt = "2099-01-01T00:00:00.000Z"; }],
  ["artifact created before job", f => { f.collection.artifacts[0].created_at = "2020-01-01T00:00:00.000Z"; }],
  ["artifact created after job", f => { f.collection.artifacts[0].created_at = "2099-01-01T00:00:00.000Z"; }],
  ["artifact copied between jobs", f => { const a = f.collection.artifacts[10]; const b = f.collection.artifacts[11]; [a.name, b.name] = [b.name, a.name]; }],
  ["duplicate artifact", f => { f.collection.artifacts.push({ ...f.collection.artifacts[0] }); }],
  ["missing artifact", f => { f.collection.artifacts.pop(); }],
  ["symlink dot-dot entry alias", f => { f.execution.command.argv[1] = "/fixture/escape/../node_modules/vitest/vitest.mjs"; }],
  ["relative dot-dot entry alias", f => { f.execution.command.argv[1] = "escape/../node_modules/vitest/vitest.mjs"; }],
]) test(`lane boundary rejects ${name} despite re-signed review`, () => {
  const f = fixture(); mutate(f); f.seal();
  assert.throws(() => reconcile(f.tests, f.bundle, f.binding, f.options));
});
for (const nextSecond of [false, true]) test(`job timestamp precision ${nextSecond ? "rejects the next second" : "accepts the same UTC second"}`, () => {
  const f = fixture();
  const job = f.collection.jobs.find(j => j.name === "broker-vitest");
  const end = Math.floor((Date.now() - 5000) / 1000) * 1000;
  job.completed_at = new Date(end).toISOString().replace(".000Z", "Z");
  f.collection.artifacts.find(a => a.jobId === job.id).created_at = job.completed_at;
  f.execution.finishedAt = new Date(end + (nextSecond ? 1000 : 500)).toISOString();
  f.execution.startedAt = new Date(end - 1000).toISOString();
  f.seal();
  if (nextSecond) assert.throws(() => reconcile(f.tests, f.bundle, f.binding, f.options), /job window/);
  else assert.equal(reconcile(f.tests, f.bundle, f.binding, f.options).strictGreen, false);
});
for (const mode of ["direct", "approved-pnpm", "symlink-dot-dot", "relative-symlink-dot-dot", "cwd-symlink", "report-root-symlink", "unapproved-entry-symlink"]) test(`native filesystem identity ${mode}`, () => {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "fg-realpaths-")));
  try {
    const root = join(temporary, "source");
    const foreign = join(temporary, "foreign");
    const entry = join(root, "node_modules/vitest/vitest.mjs");
    const foreignEntry = join(foreign, "node_modules/vitest/vitest.mjs");
    mkdirSync(join(root, "node_modules/vitest"), { recursive: true });
    mkdirSync(join(foreign, "node_modules/vitest"), { recursive: true });
    mkdirSync(join(foreign, "subdirectory"));
    writeFileSync(entry, "synthetic source entry"); writeFileSync(foreignEntry, "synthetic foreign entry");
    const install = { root, entry: { path: entry, resolvedPath: entry, target: null, sha256: digest(readFileSync(entry)) }, nodeTests: {} };
    let argument = entry; let cwd = root; let reportRoot = root;
    if (mode === "approved-pnpm") {
      const stored = join(root, "node_modules/.pnpm/vitest/node_modules/vitest/vitest.mjs");
      mkdirSync(join(stored, ".."), { recursive: true }); writeFileSync(stored, "synthetic source entry");
      rmSync(join(root, "node_modules/vitest"), { recursive: true });
      symlinkSync(join(stored, ".."), join(root, "node_modules/vitest"), "dir");
      install.entry.resolvedPath = stored; install.entry.target = stored;
    } else if (mode.includes("dot-dot")) {
      symlinkSync(join(foreign, "subdirectory"), join(root, "escape"), "dir");
      argument = mode.startsWith("relative") ? "escape/../node_modules/vitest/vitest.mjs" : `${root}/escape/../node_modules/vitest/vitest.mjs`;
      assert.equal(realpathSync.native(argument.startsWith("/") ? argument : `${root}/${argument}`), foreignEntry);
    } else if (mode === "cwd-symlink" || mode === "report-root-symlink") {
      symlinkSync(foreign, join(root, "alias"), "dir");
      if (mode === "cwd-symlink") cwd = join(root, "alias"); else reportRoot = join(root, "alias");
    } else if (mode === "unapproved-entry-symlink") {
      rmSync(join(root, "node_modules/vitest"), { recursive: true });
      symlinkSync(join(foreign, "node_modules/vitest"), join(root, "node_modules/vitest"), "dir");
    }
    if (["direct", "approved-pnpm"].includes(mode)) {
      const proof = captureExecutionPaths(install, { cwd }, reportRoot, [argument], "linux");
      validateExecutionPaths({ platform: "linux", command: { cwd }, report: { root: reportRoot }, filesystem: proof }, install, [argument]);
      assert.equal(proof.entries[0].resolvedPath, install.entry.resolvedPath);
    } else assert.throws(() => captureExecutionPaths(install, { cwd }, reportRoot, [argument], "linux"));
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
for (const [name, mutate] of [
  ["missing realpath capture", f => { delete f.execution.filesystem; }],
  ["cwd resolved outside checkout", f => { f.execution.filesystem.cwd.resolvedPath = "/foreign"; }],
  ["report root resolved outside checkout", f => { f.execution.filesystem.reportRoot.resolvedPath = "/foreign"; }],
  ["effective entry resolved outside approval", f => { f.execution.filesystem.entries[0].resolvedPath = "/foreign/vitest.mjs"; }],
  ["escaping intermediate symlink component", f => { f.execution.filesystem.entries[0].components[0].resolvedPath = "/foreign"; }],
  ["missing intermediate realpath capture", f => { f.execution.filesystem.entries[0].components.pop(); }],
]) test(`lane boundary rejects ${name} with unchanged approved entry`, () => {
  const f = fixture(); mutate(f); f.seal(); assert.throws(() => reconcile(f.tests, f.bundle, f.binding, f.options));
});
test("policy dispositions require prohibition and acceptance references", () => {
  for (const key of ["policyRef", "acceptanceReference"]) {
    const f = fixture("policy-prohibited"); delete f.bundle.evidence[0][key]; f.seal();
    assert.throws(() => reconcile(f.tests, f.bundle, f.binding, f.options));
  }
});
test("signed policy disposition never claims prohibited execution", () => {
  const f = fixture("policy-prohibited");
  Object.defineProperty(f.options, "sameRun", { value: { resolve: () => assert.fail("policy must not claim execution") } });
  assert.equal(reconcile(f.tests, f.bundle, f.binding, f.options).passed, 0);
});
test("artifact emission enumerates unresolved skips without accepting them", () => {
  const tests = [{ ...identity, status: "skipped" }, { ...identity, fullName: "passed", status: "passed" }];
  const bundle = proposedDispositions(tests, binding, []);
  assert.equal(bundle.entries.length, 1); assert.equal(bundle.entries[0].class, null);
  assert.throws(() => reconcile(tests, bundle, binding));
});
test("Vitest totals distinguish a terminal skip from pending and never count it as a pass", () => {
  const parsed = vitestResults(report("skipped"), "/fixture", identity.group);
  assert.equal(parsed.total, 1); assert.equal(parsed.passed, 0); assert.equal(parsed.skipped, 1);
  const bad = report("pending"); assert.throws(() => vitestResults(bad, "/fixture", identity.group));
});
test("actual Node reporter preserves nested identities, file and skip totals on synthetic fixture", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fg-node-events-")));
  try {
    const file = join(root, "fixture.mjs");
    const events = join(root, "events.jsonl"); const tapFile = join(root, "report.tap");
    writeFileSync(file, 'import {describe,it} from "node:test"; describe("suite",()=>{it("passed",()=>{});it.skip("skipped",()=>{});});\n');
    const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", `--test-reporter-destination=${tapFile}`, `--test-reporter=${join(ROOT, "scripts/full-gate/node-reporter.mjs")}`, `--test-reporter-destination=${events}`, file], { env: { PATH: process.env.PATH, HOME: root }, encoding: "utf8", timeout: 10000 });
    assert.equal(run.status, 0, run.stderr);
    const raw = readFileSync(events, "utf8");
    const parsed = nodeResults(raw, root);
    assert.deepEqual(parsed.tests.map(t => [t.fullName, t.status]), [["suite > passed", "passed"], ["suite > skipped", "skipped"]]);
    assert.equal(strictTap(readFileSync(tapFile, "utf8")).skipped, 1);
    assert.throws(() => nodeResults(raw.replaceAll('"skipped":1', '"skipped":0'), root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("asset checks reject missing approval, changed bytes and missing capability", () => {
  const root = mkdtempSync(join(tmpdir(), "fg-assets-"));
  try {
    const path = join(root, "asset"); writeFileSync(path, "synthetic asset");
    const env = Object.fromEntries(REQUIRED_ASSETS.map(k => [k, path]));
    const approvals = Object.fromEntries(REQUIRED_ASSETS.map(k => [k, assetDigest(path)]));
    assert.deepEqual(assetIssues(env, approvals), []);
    assert.ok(assetIssues(env, {}).every(i => i.includes("approved SHA-256")));
    writeFileSync(path, "changed"); assert.ok(assetIssues(env, approvals).every(i => i.includes("digest mismatch")));
    assert.equal(assetIssues({}, {}).length, REQUIRED_ASSETS.length);
    const result = preflight({ PATH: "/nonexistent", HOME: root }, { tempRoot: root, platform: "win32" });
    assert.equal(result.ready, false);
    assert.ok(result.issues.some(i => i.includes("Windows"))); assert.ok(result.issues.some(i => i.includes("Pillow"))); assert.ok(result.issues.some(i => i.includes("Postfix")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("Windows report identities normalize without claiming platform execution", () => {
  assert.equal(reportFile("C:\\checkout", "C:\\checkout\\server\\test.ts"), "server/test.ts");
  assert.throws(() => reportFile("C:\\checkout", "D:\\other\\test.ts"));
});
for (const unsafe of [null, "../escape", "/absolute", "symlink", "external-run", "missing-matrix-job", "foreign-workflow", "foreign-artifact-source"]) test(`artifact bootstrap handles ${unsafe ?? "valid synthetic"} archive without Actions`, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fg-bootstrap-")));
  try {
    const proposal = JSON.stringify({ ...binding, attempt: "1", entries: [] });
    const python = 'import io,sys,zipfile,stat; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); i=zipfile.ZipInfo(sys.argv[1]); i.external_attr=(stat.S_IFLNK|0o777)<<16 if sys.argv[1]=="symlink" else 0; z.writestr(i,sys.argv[2]); z.close(); sys.stdout.buffer.write(b.getvalue())';
    const made = spawnSync("python3", ["-I", "-c", python, unsafe ?? "platform-dispositions.json", proposal], { timeout: 5000 });
    assert.equal(made.status, 0);
    const jobRecords = jobs();
    const artifacts = laneArtifacts(jobRecords).map(row => ({ ...row, size_in_bytes: made.stdout.length }));
    if (unsafe === "missing-matrix-job") jobRecords.splice(jobRecords.findIndex(j => j.name === "control-plane-vitest"), 1);
    if (unsafe === "external-run") artifacts[0].workflow_run.id = 100;
    if (unsafe === "foreign-artifact-source") artifacts[0].workflow_run.head_sha = "b".repeat(40);
    const actions = { listWorkflowRunArtifacts() {}, listJobsForWorkflowRunAttempt() {}, getWorkflowRun: async () => ({ data: { id: 99, head_sha: sha, run_attempt: 1, path: unsafe === "foreign-workflow" ? ".github/workflows/foreign.yml" : WORKFLOW_PATH, event: "workflow_dispatch", repository: { full_name: "Ashersun1207/entropybot" }, head_repository: { full_name: "Ashersun1207/entropybot" } } }), downloadArtifact: async () => ({ data: made.stdout }) };
    const github = { paginate: async method => method === actions.listJobsForWorkflowRunAttempt ? jobRecords : artifacts, rest: { actions } };
    const operation = bootstrap({ github, context: { repo: { owner: "Ashersun1207", repo: "entropybot" }, runId: 99 }, env: { GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "99", GITHUB_SHA: sha, RUNNER_TEMP: root } });
    if (unsafe) await assert.rejects(operation);
    else {
      const directory = await operation;
      assert.equal(readFileSync(join(directory, GROUPS[0], "platform-dispositions.json"), "utf8"), proposal);
      const combined = JSON.parse(readFileSync(join(root, "full-gate-dispositions/platform-dispositions.json"), "utf8"));
      assert.equal(combined.controllerReview, null);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("artifact loader refuses directory and reads a bounded regular synthetic file", () => {
  const root = mkdtempSync(join(tmpdir(), "fg-artifact-"));
  try { mkdirSync(join(root, "directory")); writeFileSync(join(root, "record"), "synthetic"); assert.equal(regularBytes(join(root, "record")).toString(), "synthetic"); assert.throws(() => regularBytes(join(root, "directory"))); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
