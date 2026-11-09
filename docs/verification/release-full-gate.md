# Release full regression gate

Status: **blocked / incomplete integration**, not a successful full regression.
The active macOS release workflow now requires `full-gate` before the job that
installs build dependencies, builds packages, uploads artifacts, creates tags or
creates a draft. Both checkouts explicitly select `github.sha`. The gate uses only
read permissions (`contents: read`, `actions: read`); the existing build job retains
its existing release permissions.

Run the consumer with Node 24:

```sh
node scripts/entropybot-release-gate.mjs
```

It requires a clean checkout whose HEAD exactly matches `GITHUB_SHA`, the expected
repository, and an authenticated GitHub Actions read token in `GH_TOKEN`. It does
not accept parent commits, equal trees, F1 check results, local JSON, environment
trust overrides, or a manually asserted successful report.

## Trust and current blocker

There is currently **no approved, tracked full-regression Actions producer**.
`APPROVED_PRODUCER_FILES` in the consumer is deliberately empty. Production exits
nonzero before making any HTTP request. No placeholder green workflow was added.
This intentionally freezes the release workflow; merge only with that behavior
understood. This is a reviewable consumer and release dependency, not completed F2.

The exported verifier permits injected producer digests and a mock fetch for focused
tests; the CLI supplies neither. Activation requires a separate reviewed source
change adding the real `.github/workflows/entropybot-full-gate.yml`, its runner and
all executable transitive producer sources to the SHA-256 trust map. Merely setting
an environment variable, adding a workflow with green echo steps, or uploading a
success artifact cannot provision that map. Pinning workflow bytes alone is not
sufficient if it calls unpinned local runner code. Reviewed source and dependencies
remain the trust boundary; this does not defend against a maintainer changing the
consumer itself or bypassing the workflow outside this release entry point.

Once provisioned, the consumer reads producer files at the exact final source SHA
from GitHub, checks their hashes, resolves the authoritative active workflow ID,
and selects its newest run for that SHA. It never falls back to an older green run.
The run must be from this repository and head repository, use push or manual
dispatch, be complete and successful on its first attempt, and have started within
24 hours. It reads attempt 1 jobs, rejects incomplete/truncated API responses, and
rechecks the run after verification, then reads the same SHA-filtered run listing
again. The newest run must still be the selected run, on attempt 1, completed and
successful; a newer run or changed attempt/state blocks with a concurrent-rerun
error. Both listing reads reject missing or truncated evidence. This hardening is
required before enablement and does not provision the empty trust root. Requests
are GET only, fixed to api.github.com, reject redirects, have 15-second deadlines,
and do not print credentials or response bodies.

The expected job set is exact: ten `main-vitest-01` through `main-vitest-10` jobs,
`broker-vitest`, `control-plane-vitest`, `electron-node`, `static-checks` and
`full-gate-verdict`. Every job must match run/SHA/attempt, and every recorded step
must complete successfully. Missing, duplicated, extra, skipped, pending or failed
jobs/steps block release. A green aggregate without those lanes is insufficient.

## Required producer work before activation

The authoritative producer must implement the external
`docs/release-completion-regression-plan.md` at the controller's final integrated
SHA; historical counts and F1's subset cannot be used as full evidence. That plan
is outside the application repository and is not executed by this consumer.

- Rediscover final-source tests with the actual configuration. Reconcile exact
  file coverage across all ten main shards, broker and control-plane; reject
  missing, extra, duplicated and unmapped files. Discover Node entries from the
  final tree, including the new `scripts/entropybot-release-gate.node-test.mjs`;
  the historical electron-plus-signing argv is no longer sufficient.
- Execute all thirteen bounded regression groups without filters, automatic
  retries or pass-with-no-tests. Require positive complete totals, passed equal
  total, zero failed/pending/skipped/todo, and exact Node argv plus full TAP totals.
- Execute the separate static/patch checks: diff check, deny-warning lint, both
  application typechecks, release identity and patch verify. Preserve their own
  exit/timeout evidence; static success cannot fill missing test coverage.
- Enforce synthetic HOME/config/profile and fake engines, no user credentials or
  real model calls, no host-only filter, bounded process supervision, lifecycle
  stop receipts and pre/post process evidence. Unknown resources keep evidence
  and directories. A job deadline or vanished outer process group is insufficient.
- Check the same clean source before/between/after groups. Produce explicit
  platform dispositions with target-platform evidence. Missing platforms or
  unresolved skip/todo remain non-green; there is no blanket allowlist.

The trusted `full-gate-verdict` job must validate original reports and receipts,
retain them as evidence, and expose these exact successful step names only after
checking the corresponding invariant:

1. `Exact final-source file coverage`
2. `Strict totals: no skip pending todo or retries`
3. `Fixture isolation and resource receipts`
4. `Platform dispositions complete`
5. `Clean unchanged source`

The consumer checks Actions provenance and verdict steps; it does **not** parse
Vitest/TAP reports or prove resource cleanup itself. Those semantics must be
implemented and independently reviewed in the pinned producer before activation.
An authenticated green step name by itself is not evidence of those semantics.

## Focused validation and handoff

Implementation owner F2 used isolated worktree `engineering-release-gate`, branch
`codex/engineering-release-gate`, baseline
`4d2c18fbd42d75d23cdc1af12409af0bf6e7c423`. Start observed on the actual clock:
2026-11-07T23:34:32Z. End and validation durations are recorded in the external
`private/engineering-foundation-evidence/f2/timing.json` and per-command JSON.
Implementation, rework and model-wait durations were not measured separately.

Focused command:

```sh
node --test scripts/entropybot-release-gate.node-test.mjs
```

Final focused run: **58 passed, 0 failed, 0 skipped, 0 todo**, command wall time
1.128275 seconds (2026-11-07T23:39:21.536948Z to 23:39:22.665619Z).
Focused deny-warning oxlint exited 0 in 0.073353 seconds; `git diff --check`
exited 0 in 0.024180 seconds. Full commands, exit codes and logs are in the
external evidence directory; initial 55-check results are retained separately.

Tests use synthetic API records and disposable Git repositories: complete record,
provenance mismatch, stale/future timestamps, failed/partial/skipped lanes, missing
strict verdicts, altered producer bytes, API failures/truncation, concurrent rerun,
and release dependency/source/shell mutations. Production CLI tests confirm local
success JSON and environment trust claims cannot bypass the empty trust root.
Existing dependencies are reused via the explicitly allowed node_modules symlink.
No full suite, F1 rerun, install-package build, CI dispatch, push, tag, publish,
real model call or remote request was performed.

Self-review: only release workflow, consumer, focused test and this document are
changed. No dependencies, product code, F1 files or engineering docs changed.
There are no new install hooks, background loops or deletion of unknown files.
Fixture cleanup removes only temporary directories created by the test. Remote
consumer behavior is mocked; real Actions/API and build ordering are not remotely
validated. Stable signing/notarization and the pre-existing build manifest's
`unverified-source` status remain separate unresolved release requirements.

Controller follow-up: independently review this release freeze, integrate
serially if accepted, implement/review the full producer and trust pins, then run
against the final integrated source with real Actions evidence under separate
authorization. Record lessons in engineering docs during controller integration;
this owner's write scope excludes those files.

### Concurrent-rerun consumer hardening

The selected run's unchanged detail response did not prove that the run listing
still selected it: a new same-SHA run could appear during verification. The final
listing recheck closes that observed gap while retaining the per-run recheck and
all provenance, job, truncation and trust checks. This is required-before-enable
consumer hardening only; F2 remains blocked with `APPROVED_PRODUCER_FILES` empty
and production still rejects before HTTP.

On baseline `7ce7c3b834df5df51fb2af605ebc6a53b0cc9d95`, Node 24.22.2 ran the
focused command above: **58 passed, 0 failed**. With the expanded tests against the
old consumer: **57 passed, 9 failed, 66 total**. Six concurrent-rerun cases actually
failed with missing expected rejection; the remaining failures detected the absent
final request and absent missing/truncated-final-list rejection. After the fix:
**66 passed, 0 failed, 0 skipped, 0 todo**. The stable case verifies both listing
URLs and that the final listing follows the detail recheck. Newer failed, queued
and successful runs, plus final-list attempt/status/conclusion changes, all reject.
Scoped deny-warning oxlint and `git diff --check` passed. All API evidence remains
synthetic; this does not validate real Actions or guarantee against changes after
the final API read. No producer, trust pins, dependencies or workflows changed.
