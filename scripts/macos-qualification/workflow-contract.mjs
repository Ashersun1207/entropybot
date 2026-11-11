import assert from "node:assert/strict";

export function workflowContract(value) {
  assert.deepEqual(value.on.push.branches, ["codex/macos-qualification"]);
  assert.deepEqual(value.permissions, { contents: "read" });
  assert.equal(value.concurrency["cancel-in-progress"], false);
  assert.deepEqual(Object.keys(value.jobs), ["qualify"]);
  const job = value.jobs.qualify;
  assert.equal(job.steps.length, 5);
  assert.equal(job.if, "github.ref == 'refs/heads/codex/macos-qualification'");
  assert.equal(job["runs-on"], "macos-15");
  assert.equal(job["timeout-minutes"], 360);
  assert.equal(job["continue-on-error"], undefined);
  assert.deepEqual(job.steps.filter(step => step.uses).map(step => step.uses), [
    "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  ]);
  assert.equal(job.steps[1].with["persist-credentials"], false);
  assert.deepEqual(job.steps[2].with, { "node-version": "24.22.2", architecture: "arm64", "check-latest": false, token: "" });
  assert.match(job.steps[0].run, /test "\$\(\/usr\/bin\/uname -m\)" = arm64/);
  assert.match(job.steps[0].run, /test "\$GITHUB_RUN_ATTEMPT" = 1/);
  const command = job.steps[3];
  assert.equal(command.if, undefined);
  assert.equal(command["continue-on-error"], undefined);
  assert.match(command.run, /set -euo pipefail/);
  assert.match(command.run, /\/usr\/bin\/env -i PATH=/);
  assert.match(command.run, /"\$NODE" scripts\/macos-qualification\/run.mjs/);
  assert.doesNotMatch(command.run, /\|\|\s*true|secrets\.|TOKEN|NODE_OPTIONS|ignore-scripts|skip|echo /i);
  assert.equal(job.steps[4].if, "always()");
  assert.equal(job.steps[4].with.path, "${{ runner.temp }}/mac-qualification/");
}
