import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parse } from "yaml";
import { REPOSITORY, WORKFLOW, REQUIRED_JOBS, VERDICT_STEPS, validateRecord, verifyRemoteGate } from "./entropybot-release-gate.mjs";

const sha = "a".repeat(40);
const now = Date.parse("2026-11-08T01:00:00Z");
function fixture() {
  const run = {
    id: 123, workflow_id: 456, repository: { full_name: REPOSITORY }, head_repository: { full_name: REPOSITORY },
    head_sha: sha, path: WORKFLOW, event: "push", status: "completed", conclusion: "success", run_attempt: 1,
    run_started_at: "2026-11-08T00:00:00Z", updated_at: "2026-11-08T00:50:00Z",
  };
  const jobs = REQUIRED_JOBS.map(name => ({
    name, run_id: run.id, head_sha: sha, run_attempt: 1, status: "completed", conclusion: "success",
    steps: (name === "full-gate-verdict" ? VERDICT_STEPS : ["Execute full lane"]).map(name => ({ name, status: "completed", conclusion: "success" })),
  }));
  return { run, jobs, sha, now };
}

test("complete authoritative record has exact final source identity", () => {
  assert.deepEqual(validateRecord(fixture()), { sourceSha: sha, runId: 123, runAttempt: 1 });
});
const recordMutations = {
  "SHA mismatch": record => { record.run.head_sha = "b".repeat(40); },
  "tree/parent reuse": record => { record.sha = "b".repeat(40); },
  "foreign repository": record => { record.run.repository.full_name = "attacker/repo"; },
  "fork source": record => { record.run.head_repository.full_name = "attacker/repo"; },
  "F1 producer": record => { record.run.path = ".github/workflows/entropybot-ci.yml"; },
  "PR merge source": record => { record.run.event = "pull_request"; },
  "failed run": record => { record.run.conclusion = "failure"; },
  "pending run": record => { record.run.status = "in_progress"; },
  "rerun": record => { record.run.run_attempt = 2; },
  "stale": record => { record.now += 24 * 60 * 60 * 1000; },
  "future": record => { record.run.updated_at = "2027-01-01T00:00:00Z"; },
  "missing timestamp": record => { delete record.run.run_started_at; },
  "missing shard": record => { record.jobs.splice(2, 1); },
  "duplicate shard": record => { record.jobs[1] = structuredClone(record.jobs[0]); },
  "extra job": record => { record.jobs.push(structuredClone(record.jobs[0])); },
  "skipped platform": record => { record.jobs[0].conclusion = "skipped"; },
  "wrong job SHA": record => { record.jobs[0].head_sha = "b".repeat(40); },
  "other job attempt": record => { record.jobs[0].run_attempt = 2; },
  "other run job": record => { record.jobs[0].run_id++; },
  "empty steps": record => { record.jobs[0].steps = []; },
  "failed step masked by job success": record => { record.jobs[0].steps[0].conclusion = "failure"; },
  "skipped step masked by job success": record => { record.jobs[0].steps[0].conclusion = "skipped"; },
  "pending step": record => { record.jobs[0].steps[0].status = "in_progress"; },
};
for (const [name, mutate] of Object.entries(recordMutations)) {
  test(`reject ${name}`, () => {
    const record = fixture();
    mutate(record);
    assert.throws(() => validateRecord(record), /Release full gate blocked/);
  });
}
for (const name of VERDICT_STEPS) {
  test(`reject missing verdict: ${name}`, () => {
    const record = fixture();
    record.jobs.at(-1).steps = record.jobs.at(-1).steps.filter(step => step.name !== name);
    assert.throws(() => validateRecord(record), /strict verdict/);
  });
}

function remoteFixture() {
  const record = fixture();
  const source = "synthetic reviewed workflow/runner bytes";
  const hash = createHash("sha256").update(source).digest("hex");
  const producerFiles = { [WORKFLOW]: hash, "scripts/synthetic-supervisor.mjs": hash };
  const calls = [];
  const responses = [
    ...Object.keys(producerFiles).map(() => ({ encoding: "base64", content: Buffer.from(source).toString("base64") })),
    { id: 456, path: WORKFLOW, state: "active" },
    { total_count: 1, workflow_runs: [{ id: 123 }] },
    record.run,
    { total_count: record.jobs.length, jobs: record.jobs },
    record.run,
  ];
  return {
    record, responses, calls,
    options: {
      sha, now, token: "synthetic-token", producerFiles,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        assert.equal(init.method, "GET");
        assert.equal(init.redirect, "error");
        assert.equal(init.headers.Authorization, "Bearer synthetic-token");
        assert.ok(url.startsWith(`https://api.github.com/repos/${REPOSITORY}/`));
        return Response.json(responses.shift());
      },
    },
  };
}

test("authenticated GETs bind pinned producer bytes and attempt-specific jobs", async () => {
  const remote = remoteFixture();
  assert.equal((await verifyRemoteGate(remote.options)).runId, 123);
  assert.equal(remote.responses.length, 0);
  assert.ok(remote.calls.some(call => call.url.endsWith("/attempts/1/jobs?per_page=100")));
  assert.ok(remote.calls[0].url.endsWith(`?ref=${sha}`));
});

test("production trust root blocks before any network request", async () => {
  await assert.rejects(verifyRemoteGate({ sha, token: "synthetic-token", fetchImpl: () => assert.fail("must not fetch") }), /producer is not provisioned/);
});
const remoteMutations = {
  "altered producer": remote => { remote.responses[0].content = Buffer.from("echo success").toString("base64"); },
  "disabled workflow": remote => { remote.responses[2].state = "disabled_manually"; },
  "missing evidence": remote => { remote.responses[3] = { total_count: 0, workflow_runs: [] }; },
  "truncated run list": remote => { remote.responses[3].total_count = 101; },
  "truncated jobs": remote => { remote.responses[5].total_count++; },
  "wrong workflow id": remote => { remote.record.run.workflow_id++; },
  "changed run during read": remote => { remote.responses[6] = { ...remote.record.run, run_attempt: 2 }; },
  "latest run failed without fallback": remote => { remote.responses[3].workflow_runs.push({ id: 124 }); remote.responses[3].total_count++; },
};
for (const [name, mutate] of Object.entries(remoteMutations)) {
  test(`authenticated evidence rejects ${name}`, async () => {
    const remote = remoteFixture();
    mutate(remote);
    await assert.rejects(verifyRemoteGate(remote.options), /Release full gate blocked/);
  });
}
for (const status of [401, 403, 404, 500]) {
  test(`HTTP ${status} fails closed`, async () => {
    const remote = remoteFixture();
    remote.options.fetchImpl = async () => new Response(null, { status });
    await assert.rejects(verifyRemoteGate(remote.options), new RegExp(`HTTP ${status}`));
  });
}

function assertWorkflow(workflow) {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const gate = workflow.jobs["full-gate"];
  const build = workflow.jobs.build;
  assert.equal(build.needs, "full-gate");
  assert.equal(build.if, "github.repository == 'Ashersun1207/entropybot' && needs.full-gate.result == 'success'");
  assert.equal(build["continue-on-error"], undefined);
  assert.equal(gate["continue-on-error"], undefined);
  assert.equal(workflow.defaults, undefined);
  assert.equal(gate.defaults, undefined);
  assert.equal(gate.if, "github.repository == 'Ashersun1207/entropybot'");
  assert.equal(gate["timeout-minutes"], 5);
  assert.deepEqual(gate.permissions, { contents: "read", actions: "read" });
  const check = gate.steps.find(step => step.run === "node scripts/entropybot-release-gate.mjs");
  assert.ok(check);
  assert.equal(check.if, undefined);
  assert.equal(check.shell, undefined);
  assert.equal(check["working-directory"], undefined);
  assert.equal(check["continue-on-error"], undefined);
  assert.deepEqual(check.env, { GH_TOKEN: "${{ github.token }}" });
  for (const job of [gate, build]) {
    assert.equal(job.steps[0].uses, "actions/checkout@v4");
    assert.equal(job.steps[0].with.ref, "${{ github.sha }}");
  }
  assert.equal(gate.steps[0].with["persist-credentials"], false);
  assert.ok(build.steps.some(step => step.run === "pnpm package:entropybot:mac"));
  assert.ok(build.steps.some(step => step.name === "Create draft release"));
}
for (const mode of ["clean", "dirty", "different-sha"]) {
  test(`production CLI blocks ${mode} fixture despite local success and trust environment`, () => {
    const root = mkdtempSync(join(tmpdir(), "entropybot-release-gate-"));
    const env = {
      PATH: "/usr/bin:/bin", HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Synthetic", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Synthetic", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_TERMINAL_PROMPT: "0", GIT_TEMPLATE_DIR: "",
    };
    const git = args => {
      const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    try {
      git(["init", "--quiet"]);
      writeFileSync(join(root, "success.json"), JSON.stringify({ success: true, skipped: 0, todo: 0 }));
      git(["add", "success.json"]);
      git(["-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Synthetic release source"]);
      const head = git(["rev-parse", "HEAD"]);
      if (mode === "dirty") writeFileSync(join(root, "unknown.txt"), "synthetic drift");
      const result = spawnSync(process.execPath, [fileURLToPath(new URL("./entropybot-release-gate.mjs", import.meta.url))], {
        cwd: root, encoding: "utf8", env: {
          ...env, GITHUB_REPOSITORY: REPOSITORY, GITHUB_SHA: mode === "different-sha" ? sha : head,
          GH_TOKEN: "synthetic-token", APPROVED_PRODUCER_FILES: "success.json", RELEASE_FULL_GATE_SUCCESS: "true",
        }, timeout: 5000,
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, mode === "clean" ? /producer is not provisioned/ : mode === "dirty" ? /checkout is dirty/ : /checkout does not match/);
      assert.equal(result.stdout, "");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
const workflowText = readFileSync(new URL("../.github/workflows/entropybot-release.yml", import.meta.url), "utf8");
test("active release build and draft depend on strict source gate", () => assertWorkflow(parse(workflowText)));
const workflowMutations = {
  "dependency removed": workflow => { delete workflow.jobs.build.needs; },
  "failure allowed": workflow => { workflow.jobs.build.if = "always()"; },
  "gate failure ignored": workflow => { workflow.jobs["full-gate"]["continue-on-error"] = true; },
  "gate command removed": workflow => { workflow.jobs["full-gate"].steps.pop(); },
  "gate step skipped": workflow => { workflow.jobs["full-gate"].steps.at(-1).if = "false"; },
  "gate shell noop": workflow => { workflow.jobs["full-gate"].steps.at(-1).shell = "true {0}"; },
  "gate defaults noop": workflow => { workflow.defaults = { run: { shell: "true {0}" } }; },
  "gate working directory": workflow => { workflow.jobs["full-gate"].steps.at(-1)["working-directory"] = "other"; },
  "gate step failure ignored": workflow => { workflow.jobs["full-gate"].steps.at(-1)["continue-on-error"] = true; },
  "build source drift": workflow => { workflow.jobs.build.steps[0].with.ref = "main"; },
  "gate source drift": workflow => { workflow.jobs["full-gate"].steps[0].with.ref = "main"; },
};
for (const [name, mutate] of Object.entries(workflowMutations)) {
  test(`workflow mutation rejected: ${name}`, () => {
    const workflow = parse(workflowText);
    mutate(workflow);
    assert.throws(() => assertWorkflow(workflow));
  });
}
