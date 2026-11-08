# Protected manual collection dispatch

Baseline `a9238844935e3f39eda236f94f66c889f638154d`, branch `codex/collection-production-dispatch`, worktree `.worktrees/collection-production-dispatch`. This slice connects the existing collection, host, guarded HTTP reader and automation reports to production RoutineManager dispatch. It does not add a frontend editor, automated trigger, model execution or a second scheduler.

## API and admission

Create through the existing authenticated `POST /api/routines`, with the usual name, display prompt, bot and schedule, `enabled: false`, and a `collection` value:

```json
{
  "kind": "web-collection",
  "version": 1,
  "sources": [{ "url": "https://public-source.invalid/page" }],
  "limits": {
    "pages": 10,
    "bytes": 100000,
    "pageBytes": 10000,
    "attempts": 10,
    "durationMs": 30000
  }
}
```

The `.invalid` URL above is illustrative, not a working production source. Tests use their own synthetic resolver and loopback transport. The schedule remains required by the existing routine wire contract but stays disabled. Collection requires a local (`maus`) bot target without startup, checks, brief delivery, attachments or continuity. Enabling it, selecting cloud/room execution, invalid versions, nonfinite/out-of-range limits, credentials, inline HTML and client output paths inside the plan are rejected before a run is admitted. Bounds are 100 sources/pages/attempts, 1 MB per page, 10 MB cumulative reserved bytes and 24 hours of collection elapsed time. Sources contain only validated HTTP/S URLs, each at most 8192 characters. URL normalization strips fragments; collection retains the existing first-occurrence URL dedup semantics, reading each supplied page and writing one artifact with unique URLs.

Start only through `POST /api/routines/:id/run-protected`, using the existing `Idempotency-Key` and current `X-Entropybot-Manual-Context` from `/api/auth/session`. The ordinary `/run` route and confirmation-card execution refuse typed collection. Existing authentication, visibility, frozen-workspace and principal/context checks remain in place. The prompt is display metadata; it never selects an execution kind or reaches a model for a collection run.

Each admission deep-copies the typed plan into its run. Manual fingerprints include the plan, so an edited plan conflicts with an earlier key. Dispatch resolves the original HTTP request ID from the persisted request-to-run receipt, not a dispatch generation. A routine edit cannot alter an admitted run's sources or budgets. Malformed persisted collection plans never degrade into ordinary model execution: invalid routine definitions stay unloaded; invalid run snapshots fail loading closed.

## Execution and publication

`RoutineManager` selects its collection dependency explicitly. `createRoutineCollectionDispatch` supplies the existing guarded HTTP reader to `hostWebCollection`, which invokes unchanged `collectWeb`. Output is computed under the owned application data directory's private `collection-reports` child, with the existing realpath, permissions, exclusive artifact creation and exact-byte replay checks. No client output path is used.

The dispatcher owns an AbortController per active run; cancellation, timeout-stop and manager shutdown abort it. Reopened running collection runs requeue the same logical identity even after repeated process restarts. Collection's existing durable plan/deadline/read/page/artifact receipts govern recovery. A read reservation without a result remains unknown and is never sent again. Saved page results, attempts and bytes are reused cumulatively; completed artifacts are verified on replay. This requeue is recovery of admitted manual work, not startup admission of new collection work.

Publication reuses `automation-reports` and the existing message/command SQLite database. A stable command saves the inert summary in the execution thread; the usual report machinery holds it while its snapshotted destination is busy. A separate stable command commits the destination message and its command result in the same SQLite transaction. Publication resolves only after finding the matching destination message, never merely after noting `report.state: pending`. A message committed before an acknowledgement exception is recognized as published. Host publication reservations can reconcile only through this local idempotent publisher; existing callers without that explicit reconciliation callback retain unknown-outcome/no-resend behavior.

The reporting wait is abortable and bounded to 60 seconds per dispatch. A longer unavailable/busy destination fails the run rather than claiming publication; it is not an unlimited background queue. Read budgets/deadlines do not reset on restart. The reporting timeout is separate from the persisted collection deadline, permitting verification/publication of an already completed artifact after that deadline. Cancellation of a busy report drops its queued reply, including after reopen. A message already committed is not rolled back by a later stop. There is no general repair operation for corrupted artifacts, missing destinations or persistent storage failures.

## Executable evidence

Run from this worktree with the existing dependency symlink `node_modules -> ../engineering-foundation/node_modules`; no installation or dependency change is needed:

```sh
node node_modules/vitest/vitest.mjs run server/routine-collection-dispatch.e2e.test.ts server/routine-collection-publication.test.ts
```

The HTTP suite starts the real isolated verification server, creates routines via HTTP and calls the actual protected production endpoint. The dedicated test-only `collection-http-hooks.mjs` resolves only `collection-fixture.invalid` to a synthetic public address and maps that exact URL/port's socket to its own loopback page server. The actual production reader still validates the DNS answer, pins transport, enforces bytes/deadline and reads a real HTTP response. No production network bypass or test environment knob is added. The hook also offers a fixture-only process-death window after the real Store has committed a report message.

Coverage includes concurrent protected replay, one logical run/artifact and unique URL, original request ID/plan after SIGKILL/restart, edited-plan conflict, auth/context/header rejection before admission, forbidden automated configurations, cumulative attempts, cancellation, unknown read after process death without resend, no fake-provider launch, and a real SIGKILL immediately after durable report append with preservation of its message ID after recovery. The publication suite uses real Store/SQLite/RoutineManager and the guarded reader with injected synthetic transport: busy queues are not publication success; repeated reopen reconciles without another read; acknowledgement failure after append has one durable message; cancelled queued reports do not appear after flush/reopen. It also checks the original provider path for an ordinary routine.

Evidence root: `/Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/collection-production-dispatch/`. The owned `run.py` records argv, cwd, sanitized environment, UTC, pre/post HEAD/tree/status, tracked/untracked source hashes, runner identity, exit and logs. It uses Node 24.22.2, synthetic HOME, short TMPDIR and `OMB_EVAL_LIVE=0`. These are local source-content receipts, not F2 acceptance or remote CI evidence. Source hash sets are frozen within each execution; documentation is recorded separately. The final commit binding distinguishes precommit executions from checks actually rerun at a commit SHA.

Initial evidence is retained: `initial-types` passed; `initial-http` had three passes and one fixture failure from a wrong message-query route, corrected to `/api/threads/:id/messages`; `initial-checks` passed the existing reader/host/collection/report and size/docs suites. `publication-red` captured one actual adapter failure with three passes: a report committed before its acknowledgement threw was incorrectly settled as failed. The fix verifies the matching durable destination message before accepting/rethrowing that local publication error. `correction1-behavior` had 370 passes and one existing context-test failure: the added collection check duplicated a read-only routine lookup (six calls instead of three). The fix shares the original lookup, preserving the context barrier. `correction1-types` passed. These failures are implementation/fixture evidence for this slice; no preexisting product red baseline is claimed for newly introduced collection behavior.

`correction2-behavior` passed all 371 behavior tests plus size and six documentation assertions (378 passed, one documentation failure). It includes five new real HTTP cases, four new publication cases and seven unchanged manual HTTP cases. The README reachability assertion raced this document's creation/index edit during that command; its in-memory README did not contain the new link yet. That is a verification coordination error, not a production failure or a final green suite. Source hashes remained equal, but that runner revision excluded Markdown, so it did not detect the documentation race. The final runner includes Markdown hashes, Node version/binary hash and resolved dependency root; all files are frozen before final verification. `correction2-types`, `correction2-app-types` and scoped `correction2-lint` passed with matching pre/post source hashes. Final results are recorded in the handoff and corresponding additive evidence receipts.

## Maintenance, security and limits

Reviewed scope: strict source-only input, immutable run snapshot and stable request binding; explicit dispatch and no prompt parsing; guarded network reuse; private artifact root; cancellation; no unknown-read resend; transactional message commands; bounded local publication reconciliation. No dependencies, install scripts, egress policy, credentials, model tools, user configuration, Keychain or frontend state/harness changed. `server/index.ts` gains only an import and a dependency-wiring line. Existing size budgets remain unchanged. Fixtures own their roots and exact child handles; close uses bounded exit/close confirmation before root cleanup, and loopback connections are closed explicitly.

Evidence covers local process restart and SQLite's existing durability configuration, not power-loss persistence, file+database atomicity, arbitrary kernel/filesystem stalls, real public DNS/TLS/sites, provider quality, packaged Electron UI, installation or remote deployment. The isolated custom restart children have bounded root exit/close checks; this is not a claim that every possible detached descendant is covered by a new lifecycle mechanism. Collection never launches a model/provider child. Parent independent review and serial integration remain required. No push, package build, install or live-user operation occurred.
