# Release full regression gate

Status: **blocked / incomplete integration**, not a successful full regression.
Installation is additionally blocked before the former Corepack install: see
[installation prerequisite](full-gate-installation.md). Historical frozen-install
claims below describe the older structural receipt, which no longer qualifies
any production lane.
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
The candidate producer below remains unapproved and cannot complete successfully.
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
- Execute all thirteen bounded regression groups without filters, retries or
  `passWithNoTests`. Require positive complete totals, zero failed and zero todo,
  and exact Node argv plus full TAP totals. Every discovered test must have a
  terminal result: passed or explicitly dispositioned skipped. Pending/incomplete,
  cancelled, unknown or unaccounted results block. Reconcile total = passed +
  skipped; skips never count as passes. Exact file and test coverage remains
  required, including skipped tests; dispositions cannot hide omitted execution.
- Execute the separate static/patch checks: diff check, deny-warning lint, both
  application typechecks, release identity and patch verify. Preserve their own
  exit/timeout evidence; static success cannot fill missing test coverage.
- Enforce synthetic HOME/config/profile and fake engines, no user credentials or
  real model calls, no host-only filter, bounded process supervision, lifecycle
  stop receipts and pre/post process evidence. Unknown resources keep evidence
  and directories. A job deadline or vanished outer process group is insufficient.
- Check the same clean source before/between/after groups. Skipped tests are
  allowed only through an explicit platform-disposition artifact bound to that
  final source and run. The producer must enumerate every skipped test by exact
  group, file and full test identity, with exactly one class
  (`executed-in-this-run` or `policy-prohibited`), a concrete reason and a
  target-platform evidence reference. The producer must reconcile
  artifact entries one-to-one with original per-test reports: undeclared skips,
  duplicate or extra entries, mismatched identities/counts/classes/reasons/evidence,
  missing references and unresolved evidence block. A blanket allowlist or a
  capability/env gate alone is insufficient. Execution exceptions require actual
  matrix execution in this same workflow run, attempt and final source. No
  externally supplied execution receipt, even controller-signed, is accepted.
  Policy-prohibited entries must reference the applicable prohibition and its
  target-platform acceptance disposition without claiming prohibited execution.
  The controller must review the artifact and cited evidence before accepting
  any run with skips as **accepted with dispositions**. A run whose only remaining
  exception is skipped tests is not **strict green**; an all-skipped run also
  cannot be strict green and is eligible only for that reviewed disposition
  status if every other requirement is met. Dispositions never convert skips
  into passes. Zero failed/todo, exact coverage, no retries/filters/`passWithNoTests`
  and clean unchanged source remain mandatory.

The trusted `full-gate-verdict` job must validate original reports and receipts,
retain them as evidence, and expose exactly these five successful step names,
each exactly once and with no extra verdict steps, only after checking the
corresponding invariant:

1. `Exact final-source file coverage`
2. `Strict totals: no failures or todos`
3. `Fixture isolation and resource receipts`
4. `Platform dispositions complete`
5. `Clean unchanged source`

The producer, not this consumer, enforces skip enumeration, exact report/artifact
reconciliation and controller-reviewed disposition acceptance before emitting
`Platform dispositions complete`. The consumer still only checks Actions
provenance and verdict steps; it does **not** parse the disposition artifact,
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

## Unapproved producer candidate (2026-11-11)

The `.github/workflows/entropybot-full-gate.yml` remains a **partial,
fail-closed implementation**, not activation-ready. The branch merged engineering
`a08fc3727`; the controller's subsequent same-run architecture decision
supersedes its externally supplied execution-receipt model. The trigger remains
`workflow_dispatch` only: pushing this branch cannot start it. It retains exactly
15 jobs. The verdict job has exactly the five named steps, including
`Strict totals: no failures or todos`, with no separate checkout, setup, download
or upload steps. Its first step uses the Node 24 GitHub script action to fetch
the exact SHA without persisted credentials, check provenance, download original
lane artifacts and run coverage validation. Each remaining step invokes its own
validator. The verdict and two matrix jobs add `actions: read` to
`contents: read`; the matrix jobs use it only to bind their numeric API job ID.
Real Actions syntax, generated service steps and API step-list compatibility still
need qualification before activation. Main lanes remain serial macOS shards.
The existing `broker-vitest` slot is a one-entry Linux matrix on ubuntu-24.04;
`control-plane-vitest` is a one-entry Windows matrix on windows-2025. Explicit
job names preserve exactly 15 IDs and 15 run instances. These two jobs run
independently and must supply their platform supplement plus normal group.
A missing or failed platform job blocks rather than authorizing an exclusion.

`scripts/full-gate/runner.mjs` uses the existing bounded POSIX supervisor and
HMAC-authenticated fixture/file leases. It discovers files through the actual
Vitest configuration and discovers all tracked Node test entries, including
scripts added after the historical plan. It stores command/source/report
receipts outside the checkout and retains temporary homes. Its constructed
child environment drops caller credentials, CI retries and host/subset filters,
sets the class-B browser/UI/CLI/mail paths explicitly and sets live eval to 0.
Setting opt-ins does not prove asset presence or fixture readiness.

`scripts/full-gate/core.mjs` and `scripts/full-gate/verdict.mjs` reconcile
`total = passed + skipped`, require positive totals, and reject failures, todos,
incomplete/pending results, retries and source drift. Vitest JSON per-test
identities and Node structured events enumerate skips by group/file/full name.
Node TAP totals are independently compared with structured-event totals. Original
report hashes and exact file coverage remain mandatory. Node event parsing is
covered by an actual disposable nested-suite fixture, with one passed and one
skipped assertion; it is not a full regression run.

`scripts/full-gate/dispositions.mjs` enforces one-to-one skip reconciliation.
Every skip needs exactly one valid class, concrete reason, target platform and
resolved evidence reference. Duplicate/extra/missing/mismatched entries or
references block. Execution dispositions resolve only to the platform artifacts
collected from this same workflow run. `scripts/full-gate/bootstrap.mjs` checks
the authoritative run detail, attempt-1 job set, matrix runner labels and
artifact run/SHA metadata before generating its own collection index. Each
artifact name must be exactly `full-gate-<job-name>`, map one-to-one to a distinct
API job, and have created_at within that job's started_at/completed_at window.
Duplicate IDs/names, missing artifacts, copied job mappings and out-of-window
creation reject. The collection persists that authoritative artifact/job map.
Matrix producers resolve their own numeric job ID with the attempt-1 API before
installation; every execution receipt must carry that exact ID, source/run and
attempt. Receipt start/finish must fall inside the cited API job window.
Times are compared as floored UTC epoch seconds because Actions timestamps may
have second precision. No extra clock-skew allowance is added; the next second
outside a job window rejects. Receipt internal ordering and controller-review
chronology are also retained at millisecond precision. The
controller bundle cannot supply that index or an execution receipt.
`scripts/full-gate/same-run.mjs` validates job/run/attempt/source/platform,
source-root cwd, dependency installation, sanitized environment and report bytes
before the existing command/receipt parser confirms the exact passed assertion.
Policy dispositions still resolve prohibition and controller acceptance records
without an execution claim. A valid signature authenticates review scope; it
cannot turn an external receipt into same-run evidence.
Any skip also requires an Ed25519 controller signature over the source/run-bound
bundle and review metadata. Only the controller may sign the decision
`accepted with dispositions`; skipped tests remain skipped and `strictGreen`
is false. With no skips, an empty exact artifact may qualify as strict green only
when every other invariant passes.

`scripts/full-gate/platform-declarations.json` contains 73 class-A and 4 class-C
historical classifications with exact test identities and source hashes. These
are unresolved declarations, not evidence or permission to accept a skip.
The 73 class-A cases and single CI-discovery case now require
`executed-in-this-run` matrix evidence; only the three live-account/model cases
remain `policy-prohibited`. New/unmatched skips get explicit unresolved
entries. The producer emits each lane's `platform-dispositions.json` inside its
retained artifact, before checking fixture leases. Historical classifications
never supply target execution or controller approval.

An optional manual input `disposition-artifact-id` downloads a controller-signed
review/policy bundle from this repository. It contains platform-dispositions.json
with sourceSha, runId, attempt, entries, evidence, records and controllerReview.
The signature covers canonical sorted-key JSON excluding only the signature.
The bundle's records may contain only policy-prohibition, policy-acceptance and
controller-review records (schemaVersion 1); execution-receipt records reject.
Execution evidence references must instead name `this-run:<job>:<receipt>` in
the separately collected matrix artifacts. Original reports remain beside their
producer's platform.json, named by SHA-256 plus .json or .jsonl. External report
callbacks and report files in the policy bundle cannot replace those bytes.

`scripts/full-gate/evidence-records.mjs` keeps command validation and the three
policy/review record validators. Execution receipts use schemaVersion 2 and are
accepted only through the same-run collector:

- `execution-receipt`: sourceSha and platform must match the final source and
  requested target. Its report contains sha256, format and root matching the
  cited original bytes, and assertion contains the exact group/file/fullName
  with status passed. Both source snapshots require that SHA, the same valid
  tree hash and clean true. Command records require explicit argv/cwd, a direct
  Node Vitest-run or Node-test command, exitCode 0, signal null, timedOut false
  and retries 0. Command validation parses the effective mode and entry position;
  finding a test filename or `run` anywhere in argv is insufficient. The first
  script must resolve to `node_modules/vitest/vitest.mjs` under the command cwd,
  immediately followed by `run`, or Node's effective mode must be `--test` with
  explicit literal `.node-test.mjs` entries including the cited assertion file.
  Only an optional import of the pinned verification lifecycle bootstrap may
  precede the entry/mode. Other pre-entry flags reject, including version/help,
  eval/print, syntax-check and test-only modes; unknown flags fail closed.
  Vitest accepts only the producer's config/runner/worker/JSON-output/shard and
  worker-bootstrap options, never positional filters. Node test options are
  limited to bounded concurrency and the known reporters/destinations, before
  all test entries. Flags after Node test files, arbitrary imports/reporters,
  duplicate entries and unsupported options reject. These intentionally narrow
  forms must be reviewed before supporting additional valid CLI variations.
  Valid startedAt/finishedAt timestamps must precede the controller review.
  The receipt must additionally identify a successful job in this run/attempt,
  and cwd/report root must equal that job's captured checkout root. The frozen
  installation receipt binds the final lock hash, Node identity and resolved
  Vitest entry hash. `scripts/full-gate/execution-paths.mjs` uses native realpath
  in the producing lane on cwd, report root, the installation entry, effective
  argv entries and every path component, before and after execution. Captures
  must agree and entry bytes must match the approved installation. Symlinked
  dependencies require the recorded approved target under this checkout's
  node_modules; escaping components reject. Node test entries instead bind
  their checked-out source file identity. The verdict validates the same-run
  captured identities rather than attempting to open another machine's paths.
  It also rejects dot/dot-dot, duplicate separators and other noncanonical argv
  aliases outright: lexical `resolve` must not collapse `escape/../...` into an
  apparently approved entry. Missing, mismatched or escaping realpath captures
  reject independently of an unchanged receipt.entry field. The execution environment is an
  explicit allowlist with an owned synthetic home: NODE_OPTIONS and unknown
  variables reject, as do Node override flags embedded in values. A CA override
  requires the source-approved mail fixture path and digest; none is approved.
- `policy-prohibition`: scope binds the exact test identity, final source and
  target platform; status is prohibited, prohibition text and matching reason
  are required, and date must be valid and not in the future.
- `policy-acceptance`: scope additionally binds this run; policyRef must resolve
  to the prohibition above. The controller id and keyId must match the bundle
  reviewer, with a dated accepted-with-dispositions decision after prohibition
  and no later than review. A nonempty string alone cannot stand in for either
  policy record. The evidence row's reference must name this acceptance record.
- `controller-review`: controllerReview.reference resolves this dated record,
  whose source/run, authenticated controller identity, acceptance decision and
  exact assertion/class/target scope must match the bundle. It authenticates
  the review scope without manufacturing execution provenance.

Independent review of `48899bec9` found that checking nonempty reference strings
and a report hash did not establish receipt provenance or resolve policy
prohibitions/acceptances. A valid synthetic signature could authenticate that
incomplete bundle. Before the fix, 175 existing focused tests passed while 33
new provenance rejection cases failed with missing expected rejection. The
record schema and resolver close those observed semantic gaps; release approval,
reviewer keys and resource acceptance remained blocked throughout. The new
receipt checks and real receipt-production boundary still need independent
re-review before activation.

The second review of `22bdb1058` found that the command check searched anywhere
in argv for a Vitest entry and `run` (or `--test`), accepting correctly signed
receipts for `node --version vitest.mjs run` and other commands that never ran
that test entry. Before the positional parser fix, the 256-test focused command
had 233 passes and 23 missing expected rejections; all original 221 tests still
passed. Re-signed cases now cover early-exit modes, misplaced entries/subcommands,
lookalike paths, help/version after `run`, Node file membership and selection
flags, plus legitimate Vitest and Node forms with approved bootstrap options.
That revision had 258 review-only pins and did not activate any approval root.
The subsequent review of `d9d128dc2` found NODE_OPTIONS and foreign-cwd/dependency
claims could still be accepted from signed external execution receipts. The
controller replaced that trust model: this candidate now rejects all execution
records in controller bundles and uses only same-run matrix artifacts. It has
261 candidate pins after adding the collector, platform runner and platform
config. The subsequent lane-boundary fix adds native filesystem capture and
brings the current candidate map to 262 pins. Reviewer keys, asset digests and
production release trust remain empty.

Review of `fd2b760aa` found that source/run labels alone did not bind a receipt
to a numeric API job/window, and lexical path resolution accepted symlink/dot-dot
aliases. Before the fix, 299 existing tests passed while 11 new rejection cases
failed; one added future-time case was already rejected (311 total). The new
numeric/time/artifact mapping and native-capture checks address those observed
gaps. Real symlink fixtures exercise direct and approved pnpm entries, foreign
cwd/report roots and absolute/relative symlink escapes. These remain local
synthetic checks, not actual platform-job evidence or independent approval.

`scripts/full-gate/platform.mjs` defines the in-workflow supplement: whole
platform files come from the source-hashed declarations via
`scripts/full-gate/platform-vitest.config.mjs`, with no test-name filters or
retries, plus the declared Node files and exact per-assertion receipts. It records
its frozen installation and sanitized child environment before execution. Linux
currently fails closed on missing capabilities or unqualified owned DISPLAY/Xvfb
and browser assets; Windows fails closed before test launch because containment
is unavailable. Even a behavioral pass remains blocked by the independent
resource-audit gap. The platform status stays blocked and no successful receipt
collection can be accepted until those qualifications are implemented/reviewed.

All local verification uses synthetic API/job/artifact records and fixtures;
no actual originating Actions runner or target OS was exercised in this task.
Real Linux/Windows executions must now occur in this same workflow/run/attempt;
external runs cannot fill that requirement. Independent review of the collector,
receipt production, dependency identities and controller review coordination
remains required. Missing input combines lane proposals and remains unresolved when
skips exist. No reviewer public keys are
provisioned in `scripts/full-gate/disposition-trust.json`; all skipped-run
acceptance therefore remains blocked. The production release trust map is a
separate empty approval root. Archive extraction rejects duplicate/traversal
paths, symlinks, special files and oversized content; artifact reads require
bounded regular files without following final-component symlinks.

The candidate deliberately also fails for unapproved/missing class-B assets,
unimplemented mail/CA qualification, or missing independent detached-resource
audit. `scripts/full-gate/preflight.mjs` now checks required asset presence and
source-approved SHA-256 digests (directory digests include their sorted trees),
rejects symlinks, probes isolated Python/Pillow and temporary-filesystem case
sensitivity/path length, and names unavailable Windows containment. No asset
hashes are provisioned. The mail fixture/CA qualification remains an explicit
named blocker even if a CA file exists. Browser paths point only to pre-provisioned
assets under `/opt/entropybot-full-gate`; no download fallback is invoked by the
producer. The mail requirements are loopback-only disposable Postfix/Dovecot,
synthetic accounts, ports 11993/11143/11465/11587 and an explicit fixture CA.
No mail fixture is started by this candidate. Pillow and short case-sensitive
storage remain required capabilities. Production cannot become green merely
by placing files at those paths.

`CANDIDATE_PRODUCER_FILES` exposes review-only SHA-256 pins from
`scripts/full-gate/candidate-pins.json`. `APPROVED_PRODUCER_FILES` stays empty;
the consumer still rejects before HTTP. `scripts/full-gate/trust.mjs` and
`scripts/full-gate/closure-inputs.mjs` cover explicit producer/config/static roots,
literal local imports and literal file URLs relative to import.meta.url, including
the verification server preload and message-search worker with their transitive
imports. `scripts/full-gate/source-policy.mjs` rejects any sibling generated
JavaScript worker fallback, including ignored files and dangling symlinks. Both
public source snapshots and closure discovery apply this policy, so the existing
before/between/after command snapshots enforce it without walking the source graph.
Tiny synthetic repositories may omit the server directory; an existing server
component must be a regular directory. Closure verification additionally requires
the TypeScript worker root. Product worker behavior is unchanged.

Literal local imports ending in .js accept exactly one regular candidate: that
JavaScript file, its .ts counterpart, or its .tsx counterpart. Coexisting candidates
reject as ambiguous even if all have pins, so generated bytes cannot silently take
precedence over reviewed source. Missing, symlinked and nonregular candidates reject.
The supported source substitution is .js to .ts/.tsx only: .mjs/.cjs imports and
literal executable URLs require exact filenames. No .js.ts fallback is supported.

Discovery includes every manifest named by the workspace packages list, executable
config files and TypeScript configs at the repository/workspace and two Cloudflare
project roots, Wrangler JSON/JSONC configs, their main entries and recursively all
regular files under configured migration directories. Literal config runner fields
also introduce dependencies. New inputs require new pins; missing roots, unsafe
paths, symlink components and nonregular files reject. Workspace patterns and
Wrangler TOML are unsupported and block until reviewed. JSONC accepts comments;
other unsupported syntax rejects. This does not evaluate configuration code.
The default CI retry runner is included as a config dependency; full-gate execution
continues to select its strict runner explicitly, with no retries enabled.

Review of `96817e8bd` reproduced acceptance of altered and deleted preload, worker,
Wrangler config, migration and docs workspace manifest through the public pin
verifier (262 pins), plus acceptance of an additional generated worker. The bounded
closure candidate had 305 pins; new tests also update parent pins before checking
new URL entries, imported children, config-derived main/migration inputs and new
workspace/config discovery. Independent R1 review of `9277b1ab4` found that the
ignored-worker check ran only during closure verification, while public source
snapshots still accepted an unchanged tracked hash. It also found missing .js
import suffix substitution. Before repair, public API tests reproduced four
failures (ignored regular/dangling worker acceptance and .ts/.tsx discovery rejection)
with 39 passes. R1 shares the narrow policy at both boundaries and adds supported
suffix resolution; the candidate now has 306 pins. Its evidence is retained under
the existing private evidence directory's review-r1 subdirectory. These fixtures
exercise observed coverage gaps; they do not establish arbitrary dynamic import
closure or platform execution.

Producer implementation/config pins identify reviewed verification machinery and
its known execution inputs. They do not independently pin every tested application
module or test: the clean final Git SHA/tree, tracked source byte snapshots and
frozen lockfile bind that larger application. Computed imports/URLs, arbitrary
configuration execution, package lifecycle hooks, dependency resolution and other
generated executable overrides still require independent qualification before
activation. Neither the literal walker nor 306 pins proves their complete closure.
The manifest is metadata, does not hash itself, and provisions no release trust.
Local guard qualification also found that installed Vitest 4.1.11 rejects the
producer's existing runner CLI option before test execution. Guards passed using
a private config with test.runner set to the original strict runner. Producer CLI
compatibility remains a separate unresolved qualification; this closure-only
candidate does not modify runner/platform execution or establish their usability.

Before activation: supply reviewed asset digests and compatible assets, finish
loopback mail/CA qualification and detached-resource auditing, obtain real
Linux/Windows executions inside this workflow and controller-reviewed
final-source/run dispositions, qualify full original-report parsing, implement
Windows containment, and qualify Linux owned DISPLAY/Xvfb and browser assets. Review transitive pins, test actual Actions
syntax/runner behavior, then obtain a real attempt-1 run at the controller's
final integrated SHA. Only a separate reviewed consumer source change may
provision production approval. Signing/notarization/release authorization remain
separate. This implementation does not claim F2 or release green.

Focused local validation uses Node 24, synthetic records and disposable Git
repositories only. Scoped TypeScript checks compile the custom TypeScript
runner only; they do not establish strict type checking of the MJS producer or
receipt validators. Those modules have behavioral tests and scoped lint.
Exact counts, failures, commands, pre/post hashes and logs are retained outside
the checkout in
`private/engineering-foundation-evidence/f2-full-gate-producer/`.

## Bounded POSIX resource observation prerequisite

`scripts/full-gate/resource-audit.mjs` now produces an independent, retained
`resource-audit.json` through the public `beginResourceAudit(...).finish()` path.
It reuses `listProcesses`, process start identities and `userDataDirOf` from
`server/browser/chrome/processes.ts`, and reads explicitly declared existing
`ProcessRegistry` files through bounded regular-file reads. It adds no lifecycle
manager, stop mechanism or process signals. The producer requires a canonical
owned synthetic home. The inventory has a 12-second asynchronous deadline per
observation (configurable up to 15 seconds), at most 64 declared registry files,
and the existing process-list subprocess has its own 10-second deadline. These
are not hard deadlines for blocking kernel/filesystem I/O; the Linux `/proc`
reader and source snapshot still have that pre-existing limitation.

The artifact binds source SHA/tree/content snapshots, run ID, attempt, group,
platform, home, exact declared registry paths, registry byte digests, observation
and production times, observed PID/PPID/start-time/arguments, issues and its
explicit blind spots. Only selected process rows are retained. Selection uses
explicit registry PIDs and absolute owned-home `--user-data-dir` arguments,
including previously observed PIDs at the final observation. It does not use a
process-table difference. Missing/malformed/timed-out inventory, missing start
identity, stale/reused identity, vanished declared registry, dirty/changed source
or unsupported platform remain unknown. A final matching process is residual.
An empty retained registry plus absence of all observed identities and marked
profiles can yield **clear-observed-domain**, always with `completeCleanup: false`.
PID disappearance alone never establishes full cleanup.

The main and platform runners invoke this same public producer before/after their
bounded commands and retain artifacts on command failure in `finally`. Main-lane
receipts bind the artifact hash; the verdict reads the original bounded bytes,
checks that hash, exact source/run/attempt/group and the observed-domain result.
The platform artifact is `platform-resource-audit.json`; early platform capability
rejection still occurs before commands, without fabricating an audit. Static
checks also retain the main audit through `finally`. Windows remains explicitly
unsupported before command launch. These paths do not read arbitrary fixture
homes or search the user's directories for registries.

**The full resource blocker remains unconditional.** The bounded durable-history
increment below adds declared records for capability-bound command runner and
verification-scope groups. Fixture lease success and that partial history do not
establish complete independent confirmation of every normal detached resource. An owned-home profile observation is useful for
normal marked resources and real detached synthetic processes, but cannot prove
all normal internal detached fixture resources have exited. It also cannot prove
absence of arbitrary malicious detached processes, unregistered/unmarked helpers,
changed arguments, noncanonical profile aliases, OS-hidden entries, PID reuse
within the POSIX start-time resolution, same-UID tampering, sockets/files or remote
resources. No directories are deleted on this audit's authority. Full acceptance
requires a separately reviewed complete inventory/confirmation chain for those
normal resources as well as the existing lease/exit/close guarantees.

`scripts/full-gate-resource-audit.node-test.mjs` exercises the public producer and
validator, including actual owned Node processes: a detached process surviving
its root, stale identity against a live unrelated control, normal exit with an
empty retained registry, missing/null/throwing/hanging inventory, missing identity,
registry loss, source drift, wrong binding and explicit Windows rejection. PID
reuse is modeled by a stale start identity against an actual live PID; the suite
does not force OS PID reuse. Controls outside the exact home boundary remain
alive; the audit never signals them. Only the synthetic fixture teardown signals
its own children. Original missing-module red-source proof and the subsequent
actual false-clear `/var` versus `/private/var` failure are retained. Canonical
fixture paths and rejection of noncanonical home inputs fix that observed gap;
noncanonical process-argument aliases remain an explicit blind spot.

Final frozen candidate commands, pre/post SHA/tree/status and file hashes, exact
argv/environment, UTC times, exits, logs and synthetic audit artifacts are retained
under `private/engineering-foundation-evidence/f2-posix-resource-audit/`. Focused
F2 Node suites, size/docs guards, scoped deny-warning lint, tools TypeScript and
the strict TypeScript custom runner are the validation scope; MJS strict typing,
a full regression, Linux/Windows execution and real Actions are not claimed.
No dependencies/lockfiles, trust/reviewer/asset approval roots, dispatch-only
workflow, 15 jobs, five verdict steps, skip reconciliation, external-receipt
rejection or 77 unresolved platform declarations change. Candidate pins only
record this prerequisite for review; controller integration remains separate.
Maintenance/security review of this bounded increment found no new download,
network, credential, installation, persistent service or unknown-process killing
path. The existing closure audit and its separate owner remain independent work.

## Installed Vitest CLI subset qualification (2026-11-11)

Vitest **4.1.11** rejects the producer's former `--runner` option before test
execution. The actual rejection is retained, including a repeat under Node
24.22.2. Earlier guards that did not use that option retain their original scope
and results. The production command builder now selects fixed main, broker and
control-plane full-gate config adapters; each imports its original project config
and overrides only `test.runner` through `strictConfig`. The existing platform
config already sets that runner. Product Vite configs are unchanged. Discovery
and execution share the same selected adapter. Main worker counts and all ten
shard values remain unchanged. Receipt command validation adds only those three
fixed config paths; its entry, bootstrap, environment and arbitrary-config
rejections remain in force. Historical accepted command forms remain a separate
validator compatibility surface, not newly qualified executions.

The new Node CLI smoke test copies the production builder, configs, runner and
bootstrap into an owned synthetic project and launches the installed executable.
Its 17 real Vitest invocations cover four discovery commands, four passing run
commands (15 synthetic assertions), four retry-sentinel failures, default and CI
retry runner controls that allow the sentinel, and three strict-policy failures
for config retry, name filtering and passWithNoTests. Positive tests require the
original synthetic setup, a Vite plugin's virtual module, and capability presence
inside the worker. Generated argv is passed to the same command validator used
by execution receipts; arbitrary config substitutions reject. A merge contract
asserts that only the runner changes, retaining include/exclude, setup, plugins,
aliases, sequence and existing policy values. Real original main/broker discovery
and their adapters have identical file sets: **2442 / 4** respectively. This is
file discovery, not execution of those suites.

The first two smoke attempts retained fixture failures: platform `mergeConfig`
merges base include patterns instead of replacing them, and the CI runner control
needed its actual source/dependency copied. Fixture corrections preserve that
existing discovery behavior. No second production CLI incompatibility was found;
`--execArgv` bootstrap is accepted and observed in actual workers. The focused F2,
resource and new CLI test command has **343 passed, zero failed/skipped/todo**.
Frozen candidate verification additionally covers original-config size/docs
guards, scoped lint, strict-runner TypeScript, tools TypeScript and diff checking.
Exact pre/post SHA/tree/status, tracked and executable dependency hashes, command
argv/environment/times/exits and logs are retained under the external
`private/engineering-foundation-evidence/f2-vitest-cli/` directory.

This qualifies only the exercised CLI/config/bootstrap subset. Synthetic project
plugins stand in for the real Cloudflare plugin; neither control-plane runtime,
Linux/Windows execution, Actions nor full producer execution is qualified.
The 269 candidate pins are review metadata on this baseline; the controller must
recompute them after combining the independent closure candidate. The dispatch-only
15 jobs, five verdict steps, 77 unresolved declarations, empty release trust,
reviewer/asset roots and unconditional full resource blockers remain. Scoped
maintenance/security review found no dependency, lockfile, workflow, network,
credential, install/build, product-config or unknown-process cleanup change.
Independent review is required before integration.

### CLI fixture and approved closure combination

The controller combined independently approved CLI and closure candidates at
`b12cfeccf`, with 313 review-only pins. Its combined run had 398 passes and one
failure: the synthetic main config's absolute runner literal was rejected by the
approved closure parser during hashes, before any inner Vitest launch. The clean
combination-fix checkout reproduces that failure. This does not invalidate either
candidate's earlier bounded checks or authorize relaxing path safety.

The fixture now writes a local runner literal relative to each synthetic project
root, which is also that original config's directory. Main uses the local scripts
path; broker/control-plane traverse within the owned checkout to the same CI
runner source. Both Vitest and the closure parser resolve those legitimate paths.
Production adapters and explicit strict-runner dependencies remain unchanged.
All source/dependency hashes, discovery and strict/default/CI controls remain.
When evidence is requested, each generated report is copied beside its command
record and bound by SHA-256 before the synthetic project is removed: the frozen
smoke retains 17 command records and 13 original JSON reports.

Final verification on the fixture-only candidate comprises all six combined
Node suites (399 tests, including 56 closure, 14 resource and two CLI tests),
eight original-config guards, scoped deny-warning lint, tools and strict-runner
TypeScript, pin verification and diff checking. Exact final outcomes, clean
source snapshots, executable dependency hashes, argv/environment/times/exits,
baseline failure and logs are retained externally under
`private/engineering-foundation-evidence/f2-cli-closure-combination/`.
All 313 pinned production inputs and the pin manifest remain byte-identical to
the combination baseline. Only the fixture and these bounded docs change.
No dependencies, closure parser, source policy, production code, workflow,
permissions, approval roots or full resource/platform blockers change. Scoped
maintenance/security review found only owned synthetic report retention and
relative config values, with no new network, credential or installation path.
The same CLI-subset limits apply; independent review and controller serial
integration remain required.

## Immutable action source candidate (2026-11-11)

This bounded candidate changes only the action identities in the existing full-gate
workflow. It remains dispatch-only with 15 jobs/instances and the same five verdict
steps, scripts, permissions and anchors. Installation policy and observed installation
receipts belong to a separate owner; this change does not qualify that boundary.
Release trust, reviewer keys, asset approval and the 77 unresolved declarations remain
unchanged. The earlier workflow-registration patch is stale after these byte changes;
the controller must regenerate it after independent approval and serial integration.

`scripts/full-gate/action-sources.json` is explicit candidate audit data, rooted in
`scripts/full-gate/trust.mjs`. The public closure now produces 314 candidate pins.
The catalog does not authorize a release or let environment variables select an action.
It records exact owner/repository/40-character commit, source URLs, raw action manifest,
Node runtime and main/post lifecycle, fetched source/package/lock/license metadata and
executable bundle SHA-256. All four are JavaScript actions with no composite transitive
uses or pre entry. Checkout has a post entry at the same bundle; setup-node has a
separate success-only cache-save post entry. The manifest runtime is Node20 for the
three v4 candidates and Node24 for github-script; installed Node24 is a separate input.

| Repository | Reviewed commit | Runtime | Executable paths |
|---|---|---|---|
| actions/checkout | 11d5960a326750d5838078e36cf38b85af677262 | node20 | dist/index.js (main/post) |
| actions/setup-node | 49933ea5288caeca8642d1e84afbd3f7d6820020 | node20 | dist/setup/index.js; dist/cache-save/index.js (post) |
| actions/upload-artifact | ea165f8d65b6e75b540449e92b4886f43607fa02 | node20 | dist/upload/index.js |
| actions/github-script | ed597411d8f924073f98dfc5c65a23a2325f34cd | node24 | dist/index.js |

Read-only requests used official GitHub repositories at these exact commits. The
external evidence directory `private/engineering-foundation-evidence/f2-actions-immutable/`
retains fetched bytes, HTTP status/URL/commit/size/SHA-256 records, exact-commit Git tree
metadata, Git blob identity comparisons, dependency/install-script inventory and selected
bundle boundary excerpts. Missing speculative license/bundle metadata paths returned
404 and remain recorded; successful fetched files match their exact-commit Git tree
blobs. No downloaded action code or native executable was run, built or installed.
Previously reported valid API signatures provide provenance metadata, not safety approval.

The review covered relevant first-party entry, input, authentication, Git/cleanup,
download/distribution, upload/search and dynamic-script paths, plus package/lock and
selected corresponding bundle code. Root action licenses are MIT; fetched upstream
Actions-library license metadata is retained, including upload's http-client record
whose classifier says `other` while its embedded text says MIT. This does not establish
all transitive licensing or the shipped Windows 7zr executable's licensing/safety.
Package/lock install scripts are inventory, not executed behavior: Actions runs checked-in
bundles directly. github-script's package version still says 7.0.1 despite the reviewed
v8 ref and Node24 manifest; commit/manifest/bundle identity governs this candidate.
No reproducible source-to-bundle rebuild or exhaustive dependency safety proof is claimed.

The relevant capabilities and residual limits are:

- Checkout uses the job token temporarily for Git/REST, removes auth with the existing
  `persist-credentials: false`, and has post cleanup. Its normal clean/reset/recreate
  path deletes workspace contents. Its additional v6-credential cleanup uses a string
  RUNNER_TEMP prefix check, without canonical containment proof; adversarial existing
  Git configuration and compromised runner state remain outside this bounded review.
- Setup-node can use hosted cache or download through the mutable actions/node-versions
  main manifest/release assets, with nodejs.org fallback; it extracts binaries, writes
  tool cache and changes PATH. Mirror/auth/cache inputs exist upstream but are not set
  here. The shipped Windows extractor is hashed only. The existing Node version `24`,
  hosted OS image, Git, shell, action runtime supplied by the runner, Corepack/pnpm,
  package lifecycle hooks, downloaded Electron and other assets are not frozen or
  qualified by immutable action references. The separate installation task owns its
  policy, environment and observed receipt repair.
- Upload uses a separate Actions runtime token and results/blob service, even with
  read-only repository-token permissions. It follows symlinks in the selected evidence
  directory and excludes hidden files by default. Optional same-name artifact deletion
  requires overwrite, which remains false. Artifact completeness and symlink-based
  boundary escape need separate qualification; this pin does not provide a filesystem
  sandbox or prove the entire artifact/Azure bundle safe.
- GitHub-script constructs an AsyncFunction and exposes require/exec/io and authenticated
  Octokit. It can execute workflow scripts with full Node capabilities. Existing matrix
  job lookup and verdict Git/bootstrap/artifact operations remain as before. No sandbox,
  platform execution or complete authenticated-network behavior is established locally.

No confirmed unexpected dangerous behavior was found in the bounded paths reviewed.
These capabilities and unproved boundaries must remain visible during independent review.

Before the patch, eight focused workflow rejection cases all failed against the actual
old contract with missing expected exceptions. The fixed contract reads the active YAML
and catalog, requires the reviewed exact repository/commit in each action position, and
checks every expanded `uses`. Nine catalog substitutions cover runtime, main/post/pre,
bundle, source URL, commit, composite uses and changed manifest lifecycle even after its
hash is recomputed. Existing workflow negative checks are preserved. The first focused
run failed its positive manifest-byte check because the catalog generator normalized
CRLF; the corrected generator preserves original bytes. That failed run is retained and
its negative-case passes are not used as proof. The corrected positive and negative
contract passes.

Frozen verification comprises all six combined Node suites (416 tests, including the
original 17 real Vitest CLI invocations and 13 retained original reports), eight original
config guards, scoped deny-warning lint, tools and strict-runner TypeScript, public pin
verification and diff checking. Pre/post source SHA/tree/status and hashes, dependency
identities, argv, sanitized environment, UTC times, exits and logs live in the external
evidence directory above. This is local synthetic validation on the bounded candidate;
it is not Actions execution, full regression, installation qualification or release
approval. Independent review and controller regeneration/combination checks remain
required before integration.

## Durable internal POSIX group history prerequisite (2026-11-11)

The main and applicable POSIX platform producers now create a capability with an
explicit source SHA/run/attempt/lane binding. `server/verification-group-history.ts`
records each capability-bound `GateCommandRunner` command group and each CLI group
registered by `VerificationProcessScope`, including real `spawnCli` calls inside
`VerificationLifecycle` servers. The creator passes the capability over the existing
INIT IPC channel; inner CLI/MCP children retain the existing clean bootstrap boundary.
Unbound capabilities preserve their prior behavior and do not claim this coverage.

Each record has an explicit `verification-process-group` kind, leader PID/PGID,
POSIX start identity from the existing Chrome process observer, creator PID/start
identity, launchedAt, gateNonce, source/run binding, creator label and lifecycle
status. A pending record is written as soon as the PID is available, before the
asynchronous start-identity observation. Failure to observe that identity stays
unknown. Records use the existing capability secret for HMAC-SHA256 and atomic
replacement of owner-only files in the canonical owned home's sibling
`verification-processes/` directory (0700). Nothing is added inside
`verification-leases/`; `assertGateLeases` is unchanged and still rejects extra
entries. Unknown is terminal; stopped cannot reopen pending and can degrade to
unknown. Stopped requires an actual process-list observation with no leader and
an ESRCH group-presence probe. Records are retained, never removed as cleanup.

`readGroupHistory` returns declared paths and authenticated parsed identities.
The audit reads declared files at both observations and discovers new files from
that owned directory, retaining the union so a previously observed deletion stays
unknown. The existing 64-file audit bound is retained; overflow fails unknown.
The additional registry kind requires a valid start identity, integer PID/PGID,
ISO launch time and an owned-home path. Original Chrome registry rows and their
profile selection retain their previous semantics. Group presence uses only
signal 0, never a terminating signal. A live leader or group is residual even if
an authenticated record falsely claims stopped; stale/reused identities and
unknown/malformed/tampered/missing history remain unknown. The widened artifact
domain explicitly names authenticated internal group history, includes group
observations and gateNonce, and keeps `completeCleanup: false`.

This is partial widening with all three unconditional resource blockers retained.
The verdict's former "audit not implemented" text now names the incomplete domain.
Unscoped `spawnCli` calls, other direct spawners, escaped/unregistered descendants,
server generations themselves (not detached CLI groups), OS-hidden resources,
same-UID record deletion/re-signing and observations between snapshots remain
unconfirmed. A short-lived leader may disappear before its start identity is
sampled and remain unknown. Two POSIX observations and signal-0 group checks do
not prove arbitrary tree containment, prevent same-second start-time collisions,
provide an OS sandbox or bound blocking kernel I/O. Windows and the existing
Linux platform qualifications remain blocked. Independent review must assess
coverage before any broader confirmation claim or blocker removal.

Regression entry: `scripts/full-gate-group-history.node-test.mjs`, with real owned
synthetic POSIX groups through the public history/audit, command runner and lifecycle
APIs. It covers a creator-surviving detached leader, stale identity against a live
PID, clean exit, forged/tampered MACs, terminal unknown, record deletion, false
stopped claims for both a live leader and an orphaned same-group descendant, strict
lease-directory rejection and unrelated surviving controls. Only fixture teardown
signals its own children after identity/argument guards. Existing gate/lifecycle/
scope suites remain required. Bootstrap staging now binds the supervisor's two
additional transitive sources; two manifest-tamper cases preserve that boundary.
The producer closure gains exactly one file and has 320 review-only pins.

Frozen verification runs on the clean committed candidate: all eight existing F2
Node suites plus the new suite (493 assertions), eight size/docs guards, the
existing 55 gate/lifecycle/scope assertions, scoped deny-warning lint, tools and
strict-runner TypeScript, public pin verification and diff checking. Exact outcomes,
argv/environment, pre/post SHA/tree/status, source and selected dependency hashes,
UTC times, logs, 17 CLI command records/13 original reports and install/bootstrap
fixtures are retained under the outer private evidence directory
`private/engineering-foundation-evidence/f2-durable-group-identity/`. The handoff
records actual final results; this document declares scope, not release approval.
The initial baseline had no durable group-history API; no historical performance
or vulnerability measurement is inferred. The controller owns the existing
quality ledger and independent review/serial integration.

Maintenance/security review is limited to the additive registry, IPC capability
transport, two spawn hooks, audit and staging source bindings. No dependencies,
lockfiles, workflow, trust/asset/reviewer approvals, network, installs, builds,
user data or terminating-signal algorithm change. Existing installed dependencies
are symlinked; no installation is attempted.
