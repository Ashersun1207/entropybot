# Manual web collection module qualification

This module implements the fixed collect → canonical URL dedup → private local JSON report sequence. It is callable by a manual RoutineManager run's existing dispatch dependency; production HTTP/UI wiring is outside this slice. It does not deliver the complete A1 end-user workflow. There is no network transport, model, browser, download, package, scheduler, saved-step recipe, or new durable database/table.

## Caller contract

Call `collectWeb` with an existing manual run's stable `routineId`/`id`, its durable request ID, an immutable plan version and sources, and an existing private output directory. Ordinary HTTP manual-run requests do not currently supply durable request identity. The fixture supplies `RoutineManager.runNow`'s existing durable request commit, so duplicate confirmations resolve to the same logical run. A caller must preserve that identity across routine retry; dispatch generation is unsuitable. A new legitimate collection needs a new run identity.

The injected reader is read-only and returns text from synthetic inline HTML or an independently bounded reader. No HTML is executed or interpreted. The report is inert JSON containing literal text. The reader must constrain its own allocation/transport response to `pageBytes`, respect cancellation, and avoid secrets. The module bounds returned UTF-8 bytes, attempts, pages, total reserved bytes, and absolute elapsed deadline. It cannot prevent a misbehaving injected implementation from allocating memory or continuing an accepted operation after cancellation.

Canonical identity uses WHATWG HTTP/S URL normalization, retains query values and ordering, strips fragments, and rejects username/password and other schemes. First occurrence wins, in input order. Three input pages are read even when two share an identity. This is URL identity dedup, with no content or semantic dedup. URLs and text must be public/synthetic and contain no credentials (including secret query parameters); query values cannot be classified safely by this module.

Only an existing realpath-equal directory with no group/other permissions is accepted. The caller exclusively owns the directory and must prevent concurrent replacement of it or its parents. The output filename is a hash of routine/run identity, and its content embeds the plan/input/request/root binding. Arbitrary paths cannot be supplied. Exclusive create, nonblocking no-follow reads, regular-file/single-link checks, exact content comparison, and content hash prevent adopting conflicting third-party files. Nonblocking open allows validation to reject a substituted FIFO before any read, including when no FIFO writer exists. Existing originals, conflicting files, and symlink targets are retained. There is no general repair/delete action.

## Recovery and budgets

The existing commands/message SQLite receipt store is the only durable checkpoint source. Immutable receipts hold the plan binding/deadline, each read reservation, each returned page, and report completion. No files are written inside `runCommand`'s synchronous database transaction. File writes and SQLite commits are explicitly separate:

- A reservation without a page result is an unknown read outcome. Resume refuses to resend, including after a reader exception, byte overflow, deadline, cancellation, or a crash immediately after reservation. This conservative refusal may also cover a call that never began. Human reconciliation/new authorized run is needed; there is no automatic retry policy.
- A page result committed before the next dispatch is reused after reopening SQLite. Attempts and actual bytes are recomputed from durable page receipts. Before each new read, one attempt and a full `pageBytes` allowance must fit the remaining cumulative budgets. This conservative reservation can reject a small eventual page if its maximum would not fit. Unknown reservations block all further dispatch, so their reserved budget is never silently reset.
- Artifact bytes are created exclusively and synced, then the directory is synced, then a completion receipt is stored. A matching artifact without completion is verified and adopted. A partial/conflicting artifact is retained and rejected. There is no claim of file+DB atomicity or transparent repair after a partial write.
- A completion receipt does not make output immutable. Every successful replay validates the report path and exact bytes again; changed, missing, hard-linked, or symlinked output is an error. No replacement occurs.
- Cancellation before publication prevents subsequent phases. Cancellation after artifact creation can leave that artifact for verified recovery; cancellation after the completion receipt does not undo completion. Accepted reader effects cannot be rolled back. Late reader results after a bounded wait cannot write a checkpoint through this invocation.

## Evidence and limitations

Evidence is under `/Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/a1a/`. `run-evidence.py` records before/after HEAD/tree/status/diff, source and executed-helper hashes, Node binary/version, dependency location/lock hash, sanitized environment, exact argv/cwd, UTC timestamps, exit status, and logs. These are source-content-bound precommit executions; the documentation/commit metadata may change afterward. No red baseline is claimed for this entirely new module.

The initial execution retained 280 passing tests and one failing new fixture. Root cause: the fixture supplied a non-SHA256 fingerprint accepted in memory but deliberately rejected by the existing RoutineManager receipt loader on reopen. The fixture now supplies the required 64-character SHA-256; no core validation was changed. The initial receipt's 2,723 hash entries are identical before and after execution. That initial source differs from the final candidate; the receipts do not support the earlier claim of source changes within that run. Later checks qualify deadline propagation and bounded reader waiting. Old receipts remain unchanged.

The adjacent integration suite uses real temporary files, the actual command SQLite database, RoutineManager dispatch dependencies, and a Runtime TurnRunner adapter with a file-backed runtime store. It reopens RoutineManager for durable request identity and reopens command SQLite around precise injected page/artifact/completion crash windows. Those window tests invoke the product module directly: they do not prove a production host dispatch adapter or reopen the runtime manager at every window. Hooks only interrupt phase boundaries; durable receipt/file behavior is real. Runtime's report callback is not wired to a person-facing message here, so exactly-once chat reporting is not claimed. Existing commands/routines/runtime regressions are targeted compatibility evidence, not an HTTP/UI or packaged-app qualification.

Self-review covers the three-file scope: no dependency/upstream/install changes, no provider/network calls, process spawning, credential access, deletion, privilege expansion, or arbitrary artifact overwrite in the product module. The test fixtures delete only their own temporary roots. The remaining integration work belongs to the parent: production stable request/run identity plumbing, host lifecycle/crash recovery, person-facing report publication through an existing idempotent receipt, and independent acceptance. Engineering lessons/maintenance source files were intentionally outside this writer's allowed scope; this document records the fixture failure for parent aggregation.

## Executed checks

All commands used `/Users/sun/.nvm/versions/node/v24.22.2/bin/node` from this worktree, with synthetic HOME, short `/private/tmp` TMPDIR, no inherited provider/config environment, and `OMB_EVAL_LIVE=0`. Exact argv and source/helper hashes are in each JSON receipt.

| Evidence prefix | UTC on 2026-11-08 | Result |
| --- | --- | --- |
| `initial-0` | 09:03:41–09:03:50 | 280 pass, 1 fixture failure; all 2,723 pre/post hash entries match; this initial source differs from the final candidate |
| `correction1-0` | 09:04:28–09:04:37 | `vitest run server/web-collection.test.ts server/commands.test.ts server/routines.test.ts server/runtime/runtime.test.ts`: 281 pass (20 new, 261 existing) |
| `correction1-1`, `correction1-2` | 09:04:37–09:05:06 | `tsc -p tsconfig.server.json`; `oxlint --deny-warnings server/web-collection.ts server/web-collection.test.ts`: both exit 0 |
| `correction2-0` | 09:05:51–09:05:53 | Final product/test source: `vitest run server/web-collection.test.ts`, 22 pass |
| `correction2-1`, `correction2-2` | 09:05:54–09:06:25 | Final product/test source: same server typecheck and scoped lint, both exit 0 |
| `review-0`, `review-1` | 09:06:30–09:06:33 | `vitest run scripts/testing/file-size-ratchet.test.ts`: 1 pass; `git diff --cached --check`: exit 0 |

For the original `a6c63b992` candidate, the distinct combined count is 284: 22 new integration cases, 261 existing regressions, and 1 size guard. This is a composite count, not one all-green invocation. The existing regressions ran before the final completed-deadline replay adjustment and two added tests; they were not repeated afterward because no existing code changed. Product/test content is unchanged after `correction2`; only this documentation's qualification results were updated before commit. These are precommit source-bound checks, not tests rerun on the final commit SHA. Validation wall-clock span was 2m52s (first pre-run receipt to last post-run receipt); model waiting and full session elapsed time were not instrumented.

## R1 independent-review correction

Review of `a6c63b992` identified a blocking FIFO open: `O_RDONLY | O_NOFOLLOW` waits for a writer before `fstat` can reject the artifact. The JavaScript thread cannot process cancellation or deadline timers during that synchronous wait. Artifact verification now also uses `O_NONBLOCK`, retaining no-follow, regular-file/single-link checks, exact content validation, and exclusive creation. Both replay without a completion receipt and replay with a completion receipt reject the FIFO as an artifact conflict without reading it or changing it.

Two isolated child regressions first create a real synthetic report with command SQLite receipts, retain the original report under `.original`, substitute a FIFO at the stable report path, close/reopen command SQLite, and replay the same identity. The parent kills and awaits the child at a four-second bound if validation hangs; `mkfifo` itself has a one-second subprocess timeout. No potentially blocking FIFO open runs in the Vitest thread. Parent assertions validate the FIFO, original report hash, and single reader call before checking the child outcome. Logs retain exact synthetic report content, hash, and paths before fixture cleanup; only fixture-owned directories are removed after child close. These POSIX FIFO cases explicitly skip Windows, where this fixture cannot create a POSIX FIFO. Both executed on macOS with no skips in the final suite.

A third regression holds the first reader Promise pending, invokes the same workflow concurrently, verifies refusal with the unknown-outcome receipt and exactly one reader call, releases the original reader, and verifies stable completion after SQLite reopen.

This is separately scoped R1 correction round **1 of at most 2**, following the two original development rounds. Product/test content was frozen throughout every batch, including negative captures. All recorded pre/post hash entries match within each R1 batch. Old evidence is unchanged; new prefixes are additive:

| Evidence prefix | UTC on 2026-11-08 | Result |
| --- | --- | --- |
| `r1-negative-0` | 09:11:40–09:11:50 | `vitest run server/web-collection.test.ts -t FIFO`: 2 expected failures at the child timeout, both reached replay; 23 cases filtered out |
| `r1-negative-artifacts-0` | 09:12:19–09:12:29 | Same negative capture, repeated only to retain report content/paths in logs: 2 expected timeout failures; 23 filtered out |
| `r1-fix1-0` | 09:12:47–09:12:49 | `vitest run server/web-collection.test.ts`: **25 passed, 0 skipped**, including both FIFO cases and pending concurrency |
| `r1-fix1-1` | 09:12:50–09:13:20 | `tsc -p tsconfig.server.json`: exit 0 |
| `r1-fix1-2` | 09:13:21 | `oxlint --deny-warnings server/web-collection.ts server/web-collection.test.ts`: exit 0 |

R1 validation span through lint was 1m42s, excluding prior implementation and uninstrumented model wait. Documentation was corrected and expanded separately from product/test content; committed source hashes are compared to the R1 test/typecheck/lint pre/post receipts in an additive final binding file. The unchanged 261 existing regressions and broader suites were not rerun for this one-flag product fix. The earlier 284 composite count remains historical, not qualification of this new commit.

Self-review confirms the sole product behavior change is nonblocking artifact open. Test subprocesses execute only Node and the host's `mkfifo` against synthetic fixtures; there is no provider/network/user-data access, dependency change, or production permission expansion. Nonblocking FIFO rejection is not a general guarantee against all OS/filesystem I/O stalls. Existing SQLite `synchronous=NORMAL` and these process-reopen tests do not prove power-loss durability or file+DB atomicity. Production HTTP/UI, host recovery wiring, and person-facing reporting remain outside this module's qualification. The review defect, root cause, regression entry, correction, and limits are recorded here for parent aggregation; engineering source documents remain outside this writer's scope.
