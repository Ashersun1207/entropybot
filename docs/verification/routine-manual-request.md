# Manual routine HTTP request identity: blocked scope assessment

A1b1 is blocked on baseline `392f54255b4064f1fe4600a4b89ff14d22a6f074`, branch `codex/engineering-manual-run-identity`. No production implementation was made. The existing HTTP route still ignores `Idempotency-Key`. This document records a reproducible failure and the scope needed to implement the requested contract safely.

## Observed HTTP failure

An isolated `launchVerificationServer` fixture with the repository's fake Claude engine created a synthetic routine through the real API, then sent two concurrent `POST /api/routines/:id/run` requests with `Idempotency-Key: synthetic-retry-1`. Both returned successful responses, with different run IDs. `GET /api/routines` contained two runs for that routine.

The intended regression failed: **1 test failed, 2 assertions failed, 0 skipped, 0 todo**, exit 1. Its first assertion expected one run but received two; its second expected matching run IDs. The test was archived outside the checkout after the frozen run, so the blocked documentation commit does not introduce a permanently failing suite.

Evidence directory: `/Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/a1b1/`.

- `routine-manual-request.e2e.test.ts`: exact red test; restore to `server/` to reproduce.
- `run-bound.py`: execution wrapper using the existing V1 source snapshot implementation.
- `red.before.json`, `red.after.json`: HEAD/tree/status, complete tracked/untracked content identities, helper and dependency hashes, argv, selected environment, UTC clocks, elapsed time and exit code. Source snapshots compare equal.
- `red.log`, `red.junit.xml`: actual output and counts.

Command: `python3 /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/a1b1/run-bound.py`. It invokes Node **24.22.2** and `node_modules/vitest/vitest.mjs run server/routine-manual-request.e2e.test.ts --reporter=default --reporter=junit --outputFile.junit=<evidence>/red.junit.xml`. Measured command duration: **5.767 seconds**. V1's registry contains only `release-signing-unit`, so it was unsuitable for this regression and was not modified. This wrapper is local source binding, not a V1 accepted receipt or an F2 producer.

## Concrete implementation blockers

The manager currently has only approval-card request receipts:

- `server/routines.ts:153`: `RoutineRequestCommit` requires message, bot and thread identifiers. HTTP has no approval-card message or originating conversation.
- `server/routines.ts:732`: passing this request makes `newRun` use its thread as the source; the following assignment overwrites `run.sourceThreadId`. Synthetic context would change production provenance and potentially results-thread selection.
- `server/routine-load.ts:130`: receipt loading requires all card ownership fields. This file is outside the authorized edit set.
- `server/index.ts:8994`: startup reconciles receipts against unanswered, undismissed cards. A fabricated HTTP card receipt would be removed at startup.
- `server/routines.ts:1521`: `commitMutation` snapshots and rolls back routines, runs and card receipts, then saves them together. A safe HTTP identity must participate in this same atomic write and rollback lifecycle.

The decisive size constraint is executable in `scripts/testing/file-size-ratchet.test.ts`: `server/routines.ts` is **1567 lines**, capped at **1568**, leaving **one line**. A distinct typed HTTP receipt with load/save/rollback integration cannot be added as ordinary readable code within this allowance. Reusing card ownership would violate the requested source semantics; a separate store wrapped around `runNow` would violate atomicity. Extracting existing card receipt ownership, reconciliation and persistence to make space would exceed the authorized minimal manual-receipt adaptation. No code squeezing, blank-line deletion or budget increase was attempted. `server/index.ts` is 15697 lines against a 15711 cap; route plumbing alone is not the blocker.

The smallest next scope should permit a focused extraction of the manager's receipt lifecycle into a receipt helper, with an explicit HTTP-origin variant and unchanged approval-card behavior. Alternatively, explicitly permit a manager-owned HTTP receipt collection in the same `routines.json` transaction and enough focused extraction to satisfy the existing ratchet. Review the loader/reconciler scope as part of that choice. This is a scope proposal, not implemented code or a claim that every listed file must change.

## Authorization and compatibility review

The existing request authentication/scope gate runs before route dispatch. `server/index.ts:12772` applies current visibility and bot access, including hidden-target 404 behavior. `server/host/bot-access-gate.ts:65` checks actual session and author ownership. Move-freeze refusal is supplied by the existing route-module chain before this legacy route. Any future HTTP receipt lookup must remain behind these checks and verify the current target exists. The current manual route also records owner-started run IDs; a new adapter must retain that behavior without upgrading a guest replay to owner authority.

The future key policy must explicitly document ASCII pattern and length, reject duplicates from raw headers before mutation, bind the verified caller/routine/key and immutable definition/intention fingerprint, and return conflict for changed definitions. No key policy is advertised as supported by this blocked assessment. The route must not consume client bot/thread/actor fields as receipt authority.

No headers, grants, report destinations, source metadata, scheduler/store, dependencies, scripts, CI, UI, collection or report flows were changed. No packages were installed, no user data or keys were used, and no build, installation, push or publication occurred. The fixture's normal cleanup completed through its awaited `close`; this is not an OS-wide process or network sandbox proof.

There is no green implementation evidence. Concurrent retry, reopen/restart, completed replay, no-header compatibility, malformed/duplicate headers, definition conflict, actor isolation, hidden/missing/denied targets, persistence failure, owner-started semantics and report/source metadata regressions remain required once the scope is unblocked. Routine/auth/type/lint/size regression batches were not run because no production or retained test source changed; this document does not claim those checks passed.

Phase clocks are retained in the evidence: read-only assessment ended by `2026-11-08T14:03:55Z`; red execution has precise UTC start/end in its before/after records. Separate implementation time is not applicable; model wait and inseparable assessment/model time are **unknown**. No repair rounds were consumed. Final maintenance/security review found no new product attack surface because production source is unchanged; the unresolved durable HTTP identity requirement remains owned by the parent task.
