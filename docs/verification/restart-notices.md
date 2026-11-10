# Restart notices under the existing recovery policy

This bounded investigation starts at `fe504fb0358921910e5b463a02db14f222b85941`.
The older candidate `a7fa90ffe` remains blocked and is not an input to this work.
The original finding (no error on the old thread) did not reproduce as a missing
notice on this baseline. Preserve the current product implementation; this
change adds regression coverage and records the evidence, without changing
recovery, scheduling, retries, assignment fields, database schema or indexes.

## Reachable presentation paths

An ordinary person's running root is reconciled by `Runtime.open()` into a
queued one-time rerun. The runtime coordinator composes the existing restart
note. At actual dispatch `runRootTurn` in `server/index.ts` appends an activity
with `chat.notice.resumingAfterRestart`, then starts the turn in the original
bot and conversation. The room root and teammate branches already have their
own existing restart presentation. A queued recovery has not dispatched yet:
it does not receive the resuming activity until that dispatch happens.

The graceful shutdown entry deliberately leaves runtime-held roots to runtime
recovery. Its `chat.notice.restartInterrupted` activity is for busy work that
the runtime does not hold and the coordinator does not continue. Requiring an
error activity on every restarted ordinary root would conflict with the
existing successful recovery contract. A resuming notice acknowledges that a
recovery attempt was started; it does not certify that the request completed.

A twice-cut rerun and a cut root with recorded outward action keep their
existing failed status and interrupted outcome. Their existing terminal report
is shown in the original conversation. Neither a stop nor a restart establishes
that external actions were rolled back or were never accepted.

## Executable checks

`server/restart-notice.e2e.test.ts` launches real isolated servers with the
repository fake Claude engine, synthetic HOME and disposable data. It restarts
the same server data and reads the same original conversation, rather than
creating a replacement bot. User prompts contain no expected notice text.
The fake provider gates both the original attempt and the recovery attempt;
assertions read the real persisted runtime root before each interruption.

The seven cases cover:

- SIGKILL and SIGTERM separately: a running original root, exactly one recovery
  dispatch, the original root ID, two provider prompts, one persisted localized
  notice code, no notice in another thread, and no duplicate after repeated
  reads or a later startup following completion.
- SIGKILL and SIGTERM during the recovery attempt: the existing twice-cut
  failure, two provider prompts, one terminal report and no new attempt or
  duplicate report after another startup.
- A real capacity queue: two running conversations restart with capacity one.
  The second root is persistently queued with its rerun marker but has no
  resuming notice until the first conversation releases capacity.
- Completed, manual Stop, ordinary provider failure and needs-input controls
  under both signals. Their statuses/execution counts persist, no restart
  notice appears, and the input card still projects waiting-on-you, not busy.
  This control fixture uses a synthetic Chief identity so an unrelated Chief's
  normal incident retry/report does not add extra roots to the control set.

The server assertions compare persisted notices with `noticeTool` output.
`src/components/ToolActivity.notice.test.ts` renders that same factory output
through the real component in English and pt-BR, including advanced mode and
safe parameter projection. This uses static component rendering, not a browser
or Electron window. The first investigation probes also archived rendering of
actual HTTP-returned tool objects; final tests keep React imports in the
renderer suite to respect the separate strict server compilation boundary.

Run the complete `server/runtime-roots.e2e.test.ts` alongside the new suite.
Its T5, including `C-RERUN`, is unchanged; T11 retains outward-action evidence
and no-rerun assertions. Also run the full coordinator/runtime suites, chat
follow-up suites, chat notice/projection tests and existing stop-receipt e2e.
Use the size, route and verification-document guards, both strict TypeScript
projects and focused lint. No production code or locale strings change.

## Evidence and limitations

Private evidence is under the controller workspace's
`private/engineering-foundation-evidence/restart-notice-only/`. Each recorded
command has pre/post HEAD, tree, status and full tracked/untracked source hash
manifests, exact argv, UTC times, exit status, Node binary hash, recorded
dependency manifests/resolved root, logs, reports and fixture sidecar hashes.
The standalone runner has a 900-second command deadline. Commands run in the
background; filtered baseline checks are identified separately from full suites.
No existing failed or incomplete run is overwritten or counted as passing.

The first control probe failed because it overlooked existing Chief incident
retries; four recovery cases and the component suite already passed. The
fixture was corrected without changing product retry policy. A strict type
probe then rejected server imports of renderer TSX and unknown HTTP JSON types;
the server tests now use typed server records and the component suite owns
React projection. Both failures remain archived and are not product red cases.
Exact final counts, candidate identity and review handoff live with the private
command receipts rather than being inferred from these earlier probes.

No current missing-notice product fix is justified by this evidence. If a user
still observes the issue, capture the original thread, its runtime recovery
state, activity rows and renderer projection before proposing further changes.
The added signal tests cover ordinary direct roots and capacity queues; room,
teammate/waiting branches rely on existing coordinator/runtime coverage and
were inspected, not all newly exercised via real process crashes. The outward
process case is the existing graceful T11 fixture. Provider fakes are not live
providers; static rendering is not desktop reload evidence. Recorded dependency
manifests are not a full hash of the executable dependency tree. Local lifecycle
receipts apply to registered fixture resources, not arbitrary detached external
resources. No real user data, model, Chrome, Keychain, downloads, dependency
installation, package build, installation or push was used. Independent review
is required before controller integration.
