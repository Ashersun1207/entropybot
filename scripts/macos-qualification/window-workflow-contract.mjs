import assert from "node:assert/strict";
import { workflowContract } from "./workflow-contract.mjs";

export function windowWorkflowContract(value) {
  assert.deepEqual(Object.keys(value).sort(), ["concurrency", "jobs", "name", "on", "permissions"]);
  assert.deepEqual(value.on, { push: { branches: ["codex/macos-window-readiness"] }, workflow_dispatch: null });
  assert.deepEqual(value.concurrency, { group: "macos-window-${{ github.ref }}", "cancel-in-progress": false });
  const job = value.jobs.qualify;
  assert.deepEqual(Object.keys(job).sort(), ["if", "runs-on", "steps", "timeout-minutes"]);
  assert.equal(job.if, "github.ref == 'refs/heads/codex/macos-window-readiness'");
  assert.equal(job["timeout-minutes"], 35);
  for (const step of job.steps) {
    const allowed = step.uses ? (step.if ? ["if", "name", "uses", "with"] : ["uses", "with"]) : ["name", "run", "shell"];
    assert.deepEqual(Object.keys(step).sort(), allowed.sort());
    if (step.shell) assert.equal(step.shell, "bash");
  }
  assert.deepEqual(job.steps[1].with, { "persist-credentials": false });
  assert.deepEqual(job.steps[4].with, { name: "macos-window-${{ github.run_id }}-${{ github.run_attempt }}", path: "${{ runner.temp }}/mac-qualification/", "if-no-files-found": "error", "retention-days": 7, "include-hidden-files": false });
  assert.doesNotMatch(job.steps[0].run, /secrets\.|TOKEN|curl|wget|\|\|/i);
  assert.match(job.steps[0].run, /test "\$\(\/usr\/bin\/uname -s\)" = Darwin/);
  assert.match(job.steps[0].run, /test '\$\{\{ runner.arch \}\}' = ARM64/);
  const command = `set -euo pipefail\nNODE="$(command -v node)"\n/usr/bin/env -i PATH="$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin" HOME="$RUNNER_TEMP" \\\n  "$NODE" scripts/macos-qualification/run.mjs \\\n  "$RUNNER_TEMP/mac-qualification" "$GITHUB_SHA" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" window\n`;
  assert.equal(job.steps[3].run, command);
  const normalized = structuredClone(value);
  normalized.on.push.branches = ["codex/macos-qualification"];
  normalized.jobs.qualify.if = "github.ref == 'refs/heads/codex/macos-qualification'";
  normalized.jobs.qualify["timeout-minutes"] = 360;
  workflowContract(normalized);
}
