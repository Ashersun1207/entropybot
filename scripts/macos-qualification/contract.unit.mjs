import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { parse } from "yaml";
import { actualHost, environment, recordCommand, checkSuiteReport, SUITES, sealReports } from "./contract.mjs";

import { workflowContract } from "./workflow-contract.mjs";

const root = resolve(import.meta.dirname, "../..");
const workflow = parse(readFileSync(join(root, ".github/workflows/entropybot-macos-qualification.yml"), "utf8"));

test("workflow invokes real isolated qualification with fixed host/actions and always uploads", () => workflowContract(workflow));
for (const [name, mutate] of [
  ["mutable action", w => { w.jobs.qualify.steps[1].uses = "actions/checkout@v4"; }],
  ["wrong architecture", w => { w.jobs.qualify["runs-on"] = "macos-15-intel"; }],
  ["no install entry", w => { w.jobs.qualify.steps[3].run = "echo passed"; }],
  ["ignored failure", w => { w.jobs.qualify.steps[3].run += " || true"; }],
  ["skip as pass", w => { w.jobs.qualify.steps[3].run += " --skip-as-pass"; }],
  ["secret forwarded", w => { w.jobs.qualify.steps[3].run += "\nTOKEN=${{ secrets.TEST }}"; }],
  ["skipped command", w => { w.jobs.qualify.steps[3].if = "false"; }],
  ["rerun", w => { w.jobs.qualify.steps[0].run = w.jobs.qualify.steps[0].run.replace('test "$GITHUB_RUN_ATTEMPT" = 1', "true"); }],
]) test(`workflow rejects ${name}`, () => { const changed = structuredClone(workflow); mutate(changed); assert.throws(() => workflowContract(changed)); });
test("actual host rejects x64, Linux and wrong Node even when label says macos", () => {
  actualHost("darwin", "arm64", "Darwin arm64", "v24.22.2");
  for (const args of [["darwin", "x64", "Darwin arm64", "v24.22.2"], ["linux", "arm64", "Darwin arm64", "v24.22.2"], ["darwin", "arm64", "Darwin x86_64", "v24.22.2"], ["darwin", "arm64", "Darwin arm64", "v24.22.1"]]) assert.throws(() => actualHost(...args));
});
test("constructed environment excludes caller tokens, proxy, mirror and Node injection", () => {
  const env = environment("/private/tmp/synthetic-macos", dirname(process.execPath));
  assert.equal(env.CI, "true");
  assert.equal(env.OMB_EVAL_LIVE, "0");
  assert.equal(env.npm_config_optional, "true");
  assert.equal(env.npm_config_registry, "https://registry.npmjs.org/");
  assert.equal(Object.keys(env).some(key => /token|secret|proxy|mirror|node_options|override|skip/i.test(key)), false);
  assert.equal(env.HOME, env.USERPROFILE);
});
function report() {
  return { success: true, numTotalTests: 3, numPassedTests: 3, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, numFailedTestSuites: 0, numPendingTestSuites: 0,
    testResults: SUITES.map(name => ({ name: `${root}/${name}`, status: "passed", assertionResults: [{ status: "passed" }] })) };
}
test("suite report rejects no-op, omitted suite, ignored failure, skip and retry", () => {
  checkSuiteReport(report());
  for (const mutate of [r => { r.numTotalTests = 0; }, r => { r.testResults.pop(); }, r => { r.success = false; }, r => { r.numPendingTests = 1; }, r => { r.testResults[0].assertionResults[0].status = "skipped"; }, r => { r.testResults[0].assertionResults[0].retryCount = 1; }, r => { r.testResults[0].assertionResults = []; }]) {
    const r = report(); mutate(r); assert.throws(() => checkSuiteReport(r));
  }
});
test("artifact inventory refuses links and capability secrets without uploading their bytes", () => {
  const home = mkdtempSync(join(tmpdir(), "mq-artifact-"));
  const reports = join(home, "reports"); const quarantine = join(home, "quarantine");
  mkdirSync(reports); mkdirSync(quarantine);
  try {
    writeFileSync(join(home, "outside"), "synthetic-private");
    symlinkSync(join(home, "outside"), join(reports, "link.log"));
    writeFileSync(join(reports, "secret.log"), "synthetic-capability");
    writeFileSync(join(reports, "safe.log"), "safe");
    assert.throws(() => sealReports(reports, quarantine, "synthetic-capability"), /quarantined/);
    assert.equal(existsSync(join(reports, "link.log")), false);
    assert.equal(existsSync(join(reports, "secret.log")), false);
    assert.equal(readFileSync(join(home, "outside"), "utf8"), "synthetic-private");
    assert.deepEqual(sealReports(reports, quarantine, "synthetic-capability").map(row => row.name), ["safe.log"]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test("hosted entry retains actual frozen install, explicit Electron provision and independent lifecycle phases", () => {
  const entry = readFileSync(join(root, "scripts/macos-qualification/run.mjs"), "utf8");
  assert.match(entry, /\[pnpm, "install", "--frozen-lockfile", "--store-dir", env.npm_config_store_dir\]/);
  assert.match(entry, /await run\("electron-provision", process.execPath, \[join\(electron, "install.js"\)\]/);
  assert.match(entry, /await run\("electron-version", executable/);
  assert.match(entry, /await phase\("actual-http-normal-operation"/);
  assert.match(entry, /await phase\("normal-failure-cancel-suites"/);
  assert.doesNotMatch(entry, /ignore-scripts|productionInstall\(|readInstallation\(|ELECTRON_OVERRIDE_DIST_PATH|frozen:\s*true/);
  assert.match(entry, /summary.completeQualification = false/);
});
test("public recorder executes local synthetic normal/failure/cancel and retains exit/stdio/group evidence", async () => {
  const home = mkdtempSync(join(tmpdir(), "mq-unit-"));
  const reports = join(home, "reports"); mkdirSync(reports);
  const env = environment(home, dirname(process.execPath));
  const options = { reports, executable: process.execPath, cwd: root, env, timeoutMs: 10000 };
  const fixture = join(root, "scripts/testing/patch-gate-child.mjs");
  try {
    const normal = await recordCommand({ ...options, name: "normal", argv: [fixture, "normal"] });
    assert.match(normal.stdout, /"event":"normal"/);
    await assert.rejects(recordCommand({ ...options, name: "failure", argv: [fixture, "nonzero"] }));
    const failure = JSON.parse(readFileSync(join(reports, "failure.json"), "utf8"));
    assert.equal(failure.outcome.ok, false); assert.equal(failure.outcome.exitCode, 7);
    assert.equal(failure.outcome.kind, "exit");
    const controller = new AbortController();
    await assert.rejects(recordCommand({ ...options, name: "cancel", argv: [fixture, "hang"], signal: controller.signal,
      onStdout: chunk => { if (chunk.includes("root-ready")) controller.abort(); } }));
    const cancel = JSON.parse(readFileSync(join(reports, "cancel.json"), "utf8"));
    assert.equal(cancel.outcome.kind, "cancelled");
    assert.equal(cancel.outcome.ownedGroupStopped, true);
    for (const name of ["normal", "failure", "cancel"]) {
      const saved = JSON.parse(readFileSync(join(reports, `${name}.json`), "utf8"));
      for (const key of ["exitAt", "closeAt", "groupGoneAt"]) assert.equal(typeof saved.outcome[key], "number");
      assert.deepEqual(saved.env, env); assert.equal(saved.executable.path, process.execPath);
      assert.equal(typeof saved.executable.sha256, "string");
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
