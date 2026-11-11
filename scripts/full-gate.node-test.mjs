import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { parse } from "yaml";
import { GROUPS, STEPS, digest, exact, safeArgv, strictVitest, strictTap, validateReceipt, source, unchanged } from "./full-gate/core.mjs";
import { producerClosure, verifyPins } from "./full-gate/trust.mjs";
import { environment, ROOT } from "./full-gate/runner.mjs";
import { REQUIRED_JOBS, VERDICT_STEPS, verifyRemoteGate } from "./entropybot-release-gate.mjs";

const sha = "a".repeat(40);
const state = { sha, tree: "b".repeat(40), hash: "c".repeat(64) };
const report = () => ({ success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, numFailedTestSuites: 0, numPendingTestSuites: 0, numRuntimeErrorTestSuites: 0, testResults: [{ name: "/synthetic/test.ts", status: "passed", assertionResults: [{ fullName: "synthetic assertion", status: "passed", retryCount: 0 }] }] });
const receipt = () => ({ sha, attempt: "1", argv: ["node", "--test", "one.node-test.mjs"], exitCode: 0, timedOut: false, before: state, after: state, resources: { leasesVerified: true, ownedGroupStopped: true, processAudit: "confirmed" }, isolation: { syntheticHome: true, fakeEngines: true, live: "0" } });
const tap = "TAP version 13\nok 1 - synthetic\n1..1\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
test("strict synthetic reports and receipt accepted", () => {
  assert.deepEqual(strictVitest(report(), "/synthetic"), ["test.ts"]);
  assert.equal(strictTap(tap).tests, 1);
  validateReceipt(receipt(), sha);
});
for (const [name, change] of Object.entries({ missing: x => x.pop(), extra: x => x.push("c"), duplicate: x => x.push("a") })) {
  test(`coverage rejects ${name} file`, () => { const list = ["a", "b"]; change(list); assert.throws(() => exact(list, ["a", "b"], "test")); });
}
for (const option of ["--testNamePattern=a", "-t", "--passWithNoTests", "--retry=1", "--changed", "--exclude=one", "--test-name-pattern=x"]) {
  test(`reject forbidden argv ${option}`, () => assert.throws(() => safeArgv(["node", option])));
}
for (const [name, mutate] of Object.entries({
  skip: r => { r.testResults[0].assertionResults[0].status = "skipped"; },
  todo: r => { r.numTodoTests = 1; }, pending: r => { r.numPendingTests = 1; },
  retry: r => { r.testResults[0].assertionResults[0].retryCount = 1; },
  failure: r => { r.numFailedTests = 1; }, zero: r => { r.numTotalTests = 0; },
  incomplete: r => { delete r.numPendingTests; }, mismatch: r => { r.numTotalTests = r.numPassedTests = 2; },
})) test(`Vitest rejects ${name}`, () => { const r = report(); mutate(r); assert.throws(() => strictVitest(r, "/synthetic")); });
for (const key of ["fail", "cancelled", "skipped", "todo"]) test(`TAP rejects ${key}`, () => assert.throws(() => strictTap(tap.replace(`# ${key} 0`, `# ${key} 1`))));
test("TAP rejects missing and duplicate summary", () => { assert.throws(() => strictTap("")); assert.throws(() => strictTap(tap + "# tests 1\n")); });
for (const [name, mutate] of Object.entries({
  nonzero: r => { r.exitCode = 1; }, timeout: r => { r.timedOut = true; },
  retry: r => { r.attempt = "2"; }, wrongSHA: r => { r.sha = "d".repeat(40); },
  dirty: r => { r.after = { ...r.after, hash: "changed" }; },
  resources: r => { r.resources.processAudit = "unknown"; }, isolation: r => { r.isolation.syntheticHome = false; },
})) test(`receipt rejects ${name}`, () => { const r = receipt(); mutate(r); assert.throws(() => validateReceipt(r, sha)); });
test("child environment discards caller secrets and live/retry selectors", () => {
  const env = environment("/synthetic", "/bin");
  for (const key of ["CI", "GH_TOKEN", "OPENAI_API_KEY", "OMB_VITEST_E2E", "OMB_VITEST_SUBSET", "OMB_LIVE_MUSE", "OMB_JEV_LIVE_EVAL"]) assert.equal(env[key], undefined);
  assert.equal(env.HOME, "/synthetic"); assert.equal(env.OMB_EVAL_LIVE, "0"); assert.equal(env.OMB_UI_E2E, "1");
});
const actionCatalog = JSON.parse(readFileSync(join(ROOT, "scripts/full-gate/action-sources.json"), "utf8"));
const reviewedActions = {
  "actions/checkout": ["11d5960a326750d5838078e36cf38b85af677262", { using: "node20", main: "dist/index.js", post: "dist/index.js" }, { "dist/index.js": "ff743df9891fd49ffdf6e6bb11ad574bce26a13862ede59474201ef4c9ae029e" }],
  "actions/setup-node": ["49933ea5288caeca8642d1e84afbd3f7d6820020", { using: "node20", main: "dist/setup/index.js", post: "dist/cache-save/index.js", "post-if": "success()" }, { "dist/setup/index.js": "1aa014a3691d373745d38a1380aaea96148f4f6c33ea3d7e5fc8b2d305e328c2", "dist/cache-save/index.js": "81f20db56a0d37f2d1d012a3ac63934ba7f76591057d233c71e810e87152ec80" }],
  "actions/upload-artifact": ["ea165f8d65b6e75b540449e92b4886f43607fa02", { using: "node20", main: "dist/upload/index.js" }, { "dist/upload/index.js": "0165b8a75330f3228f2c7a234b4ff8a107b9139c2b519147f4c8e9fe99b262d8" }],
  "actions/github-script": ["ed597411d8f924073f98dfc5c65a23a2325f34cd", { using: "node24", main: "dist/index.js" }, { "dist/index.js": "4af8211e8a7ef1f8e03e03fab7fdbd204c1108713af5c18b3d48f04d194c9abe" }],
};
const actionUse = repository => `${repository}@${reviewedActions[repository][0]}`;
function catalogContract(catalog) {
  assert.equal(catalog.schemaVersion, 1);
  exact(catalog.actions.map(a => a.repository), Object.keys(reviewedActions), "reviewed action repositories");
  for (const action of catalog.actions) {
    const [commit, runs, bundles] = reviewedActions[action.repository];
    assert.equal(action.commit, commit);
    assert.equal(action.uses, actionUse(action.repository));
    assert.equal(action.commitUrl, `https://github.com/${action.repository}/commit/${commit}`);
    assert.deepEqual(action.runs, runs);
    const manifest = parse(action.manifest);
    assert.deepEqual(manifest.runs, runs);
    assert.deepEqual(action.transitiveUses, []);
    assert.equal(digest(action.manifest), action.files["action.yml"].sha256);
    assert.equal(Buffer.byteLength(action.manifest), action.files["action.yml"].bytes);
    for (const path of ["action.yml", "package.json", "package-lock.json", action.repository === "actions/github-script" ? "LICENSE.md" : "LICENSE", ...Object.values(runs).filter(v => v.startsWith("dist/"))]) assert.ok(action.files[path]);
    for (const [path, hash] of Object.entries(bundles)) assert.equal(action.files[path].sha256, hash);
    for (const [path, file] of Object.entries(action.files)) {
      assert.match(path, /^(?:src\/[^.][\w/.-]+\.ts|dist\/[\w/.-]+\.(?:js|json)|externals\/7zr\.exe|\.github\/[\w-]+\.json|\.licenses\/npm\/@actions\/[\w.-]+\.dep\.yml|action\.yml|package(?:-lock)?\.json|LICENSE(?:\.md)?)$/);
      assert.equal(file.url, `https://raw.githubusercontent.com/${action.repository}/${commit}/${path}`);
      assert.equal(file.status, 200); assert.ok(file.bytes > 0); assert.match(file.sha256, /^[a-f0-9]{64}$/);
    }
  }
}
function contract(workflow, catalog = actionCatalog) {
  catalogContract(catalog);
  const uses = new Set(catalog.actions.map(a => a.uses));
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(workflow.jobs).sort(), [...REQUIRED_JOBS].sort());
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(STEPS, VERDICT_STEPS);
  assert.equal(workflow.defaults, undefined);
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (["broker-vitest", "control-plane-vitest"].includes(name)) {
      assert.equal(job.name, name);
      assert.equal(job["runs-on"], "${{ matrix.os }}");
      assert.deepEqual(job.strategy, { "fail-fast": false, matrix: { include: [{ os: name === "broker-vitest" ? "ubuntu-24.04" : "windows-2025", platform: name === "broker-vitest" ? "linux" : "win32" }] } });
      assert.equal(job.needs, undefined);
    } else assert.equal(job["runs-on"], "macos-15");
    assert.equal(job.defaults, undefined); assert.equal(job["continue-on-error"], undefined);
    if (name === "full-gate-verdict") {
      assert.deepEqual(job.permissions, { contents: "read", actions: "read" });
      assert.deepEqual(job.steps.map(s => s.name), STEPS);
      assert.equal(job.steps[0].uses, actionUse("actions/github-script"));
      const script = job.steps[0].with.script;
      for (const required of ["context.sha", "wrong checkout SHA", "bootstrap provenance mismatch", "provenance(process.env)", "await bootstrap", "verdict('Exact final-source file coverage', directory)"]) assert.ok(script.includes(required));
    } else {
      if (["broker-vitest", "control-plane-vitest"].includes(name)) {
        assert.deepEqual(job.permissions, { contents: "read", actions: "read" });
        assert.ok(job.steps.some(s => s.name === "Bind numeric producer job identity" && s.uses === actionUse("actions/github-script") && s.with.script.includes("FULL_GATE_JOB_ID") && s.with.script.includes("listJobsForWorkflowRunAttempt")));
      } else assert.equal(job.permissions, undefined);
      assert.equal(job.steps[0].uses, actionUse("actions/checkout"));
      assert.equal(job.steps[1].uses, actionUse("actions/setup-node"));
      assert.equal(job.steps.at(-1).uses, actionUse("actions/upload-artifact"));
      assert.equal(job.steps[0].with.ref, "${{ github.sha }}");
      assert.equal(job.steps[0].with["persist-credentials"], false);
      assert.ok(job.steps.some(s => s.name === "Refuse provenance mismatch" && s.run.includes("provenance(process.env)")));
    }
    for (const step of job.steps) {
      if (step.uses !== undefined) {
        assert.match(step.uses, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
        assert.ok(uses.has(step.uses), `unreviewed action: ${step.uses}`);
      }
      assert.equal(step["continue-on-error"], undefined);
      assert.equal(step["working-directory"], undefined);
      assert.ok(step.shell === undefined || step.shell === "bash");
      assert.ok(step.if === undefined || step.if === "always()");
    }
    if (name !== "full-gate-verdict") {
      const installs = job.steps.filter(s => s.name === "Install locked dependencies in synthetic home");
      assert.equal(installs.length, 1);
      assert.equal(installs[0].shell, "bash");
      assert.equal(installs[0].run, "# No approved absolute Node/pnpm bootstrap exists. Do not start Node with inherited loader settings.\nbuiltin printf '%s\\n' 'Full gate installation blocked: pre-JavaScript bootstrap, toolchain approvals and lifecycle history unqualified.' >&2\nexit 1\n");
      assert.ok(job.steps.some(s => s.run === 'node scripts/full-gate/runner.mjs "$LANE"' && s.env.FULL_GATE_PLATFORM === "${{ matrix.platform }}"));
    } else for (const step of STEPS.slice(1)) assert.equal(job.steps.filter(s => s.name === step && s.run?.includes("scripts/full-gate/verdict.mjs")).length, 1);
  }
}
const workflowText = readFileSync(join(ROOT, ".github/workflows/entropybot-full-gate.yml"), "utf8");
test("workflow matches consumer and invokes each verdict invariant", () => contract(parse(workflowText)));
for (const [name, mutate] of Object.entries({
  runtime: a => { a.runs.using = "node24"; },
  main: a => { a.runs.main = "dist/other.js"; },
  post: a => { delete a.runs.post; },
  pre: a => { a.runs.pre = "dist/pre.js"; },
  bundle: a => { a.files["dist/index.js"].sha256 = "a".repeat(64); },
  source: a => { a.files["src/main.ts"].url = "https://example.invalid/main.ts"; },
  commit: a => { a.commit = "a".repeat(40); },
  composite: a => { a.transitiveUses.push("actions/checkout@v4"); },
  manifest: a => {
    const manifest = parse(a.manifest); manifest.runs.post = "dist/other.js";
    a.manifest = JSON.stringify(manifest);
    a.files["action.yml"].sha256 = digest(a.manifest);
    a.files["action.yml"].bytes = Buffer.byteLength(a.manifest);
  },
})) test(`active workflow catalog rejects ${name} source substitution`, () => {
  const catalog = structuredClone(actionCatalog); mutate(catalog.actions[0]);
  assert.throws(() => contract(parse(workflowText), catalog));
});
for (const [name, mutate] of Object.entries({
  mutableCheckout: w => { w.jobs[GROUPS[0]].steps[0].uses = "actions/checkout@v4"; },
  mutableSetup: w => { w.jobs[GROUPS[0]].steps[1].uses = "actions/setup-node@v4"; },
  mutableUpload: w => { w.jobs[GROUPS[0]].steps.at(-1).uses = "actions/upload-artifact@v4"; },
  mutableScript: w => { w.jobs["full-gate-verdict"].steps[0].uses = "actions/github-script@v8"; },
  shortActionSHA: w => { w.jobs[GROUPS[0]].steps[0].uses = "actions/checkout@11d5960"; },
  foreignActionRepository: w => { w.jobs[GROUPS[0]].steps[0].uses = "unapproved/checkout@11d5960a326750d5838078e36cf38b85af677262"; },
  unreviewedActionCommit: w => { w.jobs[GROUPS[0]].steps[0].uses = `actions/checkout@${"a".repeat(40)}`; },
  substitutedLifecycleAction: w => { w.jobs[GROUPS[0]].steps[0].uses = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020"; },
  job: w => { delete w.jobs[GROUPS[0]]; }, permissions: w => { w.permissions.contents = "write"; },
  sha: w => { w.jobs[GROUPS[0]].steps[0].with.ref = "main"; },
  noop: w => { w.jobs[GROUPS[0]].steps[4].shell = "true {0}"; },
  ignored: w => { w.jobs[GROUPS[0]]["continue-on-error"] = true; },
  verdict: w => { w.jobs["full-gate-verdict"].steps.splice(1, 1); },
  extraVerdict: w => { w.jobs["full-gate-verdict"].steps.push({ name: "extra", run: "true" }); },
  pushTrigger: w => { w.on.push = {}; },
  bootstrapBypass: w => { w.jobs["full-gate-verdict"].steps[0].with.script = "return true"; },
  mismatch: w => { w.jobs[GROUPS[0]].steps.splice(2, 1); },
  missingWindowsMatrix: w => { delete w.jobs["control-plane-vitest"].strategy; },
  extraMatrixInstance: w => { w.jobs["broker-vitest"].strategy.matrix.include.push({ os: "macos-15", platform: "darwin" }); },
  wrongMatrixPlatform: w => { w.jobs["broker-vitest"].strategy.matrix.include[0].platform = "darwin"; },
  missingNumericJobBinding: w => { w.jobs["broker-vitest"].steps.splice(3, 1); },
  unsafeInstall: w => { w.jobs[GROUPS[0]].steps.find(s => s.name === "Install locked dependencies in synthetic home").run = "corepack pnpm install --frozen-lockfile"; },
  installGreen: w => { w.jobs[GROUPS[0]].steps.find(s => s.name === "Install locked dependencies in synthetic home").run = "exit 0"; },
  installNodeBeforeGuard: w => { w.jobs[GROUPS[0]].steps.find(s => s.name === "Install locked dependencies in synthetic home").run = "node scripts/full-gate/platform.mjs record-install\nexit 1"; },
})) test(`workflow rejects ${name} mutation`, () => { const w = parse(workflowText); mutate(w); assert.throws(() => contract(w)); });
test("source rejects wrong SHA and dirty source in disposable repository", () => {
  const root = mkdtempSync(join(tmpdir(), "fg-source-"));
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
  try {
    git(["init", "--quiet"]); writeFileSync(join(root, "file"), "synthetic"); git(["add", "."]);
    git(["-c", "user.name=Synthetic", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture"]);
    const head = git(["rev-parse", "HEAD"]); const before = source(root, head); unchanged(before, source(root, head));
    assert.throws(() => source(root, sha), /wrong SHA/);
    writeFileSync(join(root, "file"), "drift"); assert.throws(() => source(root, head), /dirty source/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("candidate pins match executable closure; altered missing and extra sources reject", () => {
  const pins = JSON.parse(readFileSync(join(ROOT, "scripts/full-gate/candidate-pins.json"), "utf8"));
  assert.equal(verifyPins(ROOT, pins), producerClosure(ROOT).length);
  const root = mkdtempSync(join(tmpdir(), "fg-trust-"));
  try {
    for (const file of Object.keys(pins)) { mkdirSync(join(root, file, ".."), { recursive: true }); cpSync(join(ROOT, file), join(root, file)); }
    const file = "scripts/full-gate/core.mjs";
    writeFileSync(join(root, file), readFileSync(join(root, file), "utf8") + "\n");
    assert.throws(() => verifyPins(root, pins), /altered/);
    cpSync(join(ROOT, file), join(root, file)); rmSync(join(root, file)); assert.throws(() => verifyPins(root, pins));
    cpSync(join(ROOT, file), join(root, file)); writeFileSync(join(root, "scripts/full-gate/unpinned.mjs"), "export default 1;");
    assert.throws(() => verifyPins(root, pins), /missing or extra/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
for (const [name, values, message] of [
  ["repository", { GITHUB_REPOSITORY: "foreign/repository" }, /foreign repository/],
  ["attempt", { GITHUB_RUN_ATTEMPT: "2" }, /attempt mismatch/],
  ["source", { GITHUB_SHA: sha }, /wrong SHA/],
]) test(`public producer CLI refuses ${name} before execution`, () => {
  const result = spawnSync(process.execPath, ["scripts/full-gate/runner.mjs", "broker-vitest"], {
    cwd: ROOT, encoding: "utf8", timeout: 5000,
    env: { PATH: process.env.PATH, HOME: "/synthetic", GITHUB_REPOSITORY: "Ashersun1207/entropybot", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_RUN_ATTEMPT: "1", ...values },
  });
  assert.equal(result.status, 1); assert.match(result.stderr, message); assert.equal(result.stdout, "");
});
test("candidate implementation does not provision production trust", async () => {
  await assert.rejects(verifyRemoteGate({ sha, token: "synthetic", fetchImpl: () => assert.fail("HTTP forbidden") }), /not provisioned/);
});
