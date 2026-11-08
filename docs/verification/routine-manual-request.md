# Durable manual routine HTTP requests

`POST /api/routines/:id/run` accepts an optional `Idempotency-Key`. Without it, every invocation retains the existing intentional new-run behavior. HTTP bodies remain ignored by this route; client-supplied bot, thread, actor or message fields never establish receipt authority.

The key must match `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`: 1–128 ASCII characters, starting with a letter or digit. Empty, malformed, oversized and duplicate headers return 400 before run mutation. Duplicate raw headers are rejected even when their values match. Validation errors do not echo the supplied key.

The server hashes the key together with the current authenticated principal and routine ID. Session callers use the existing stable person identity (verified email, or session identity when no email exists); local owner and verified companion-device principals have separate identities. Raw keys and bearer tokens are not stored in receipts. Existing authentication, scopes, visibility, bot access, move-freeze and current target existence are checked before receipt replay.

The receipt fingerprint binds the routine's execution definition, schedule, source and results destinations, and the caller's current scope/owner-started authority. Different keys, callers or routines allocate independent runs. An exact retry means the same bound current definition and authority; it returns the original run with the existing 201 response, including its current persisted status, without another scheduler wake or run allocation. Definition or authority mismatch returns 409. This deliberately includes automatic `limit_reset.schedule.at` retiming and automatic `enabled` changes at expiry: a retry across those definition changes refuses, retains the original identity and creates no replacement. A deleted or currently hidden routine remains a refusal, even when an old receipt exists.

HTTP receipts have explicit `origin: "http"`, no approval-card message/bot/thread context, and are committed with their run in the existing atomic `routines.json` transaction. Failed writes roll memory back and discard newly allocated results threads before any work is queued. The first commit fingerprints the definition after any normal results-thread allocation, so that allocation does not falsely invalidate an immediate retry. Internal package-install bookkeeping and changing health/scheduler counters are excluded from the execution definition.

Legacy card receipts retain their schema, matching rules, ownership projection, thread cleanup and startup reconciliation. HTTP receipts survive that reconciliation and server restarts without requiring a reachable card. The shared receipt lifecycle lives in `server/routine-request-receipts.ts`; storage, scheduling and transaction ownership remain in `RoutineManager`.

Persisted HTTP receipts containing card-only `messageId`, `botId`, `threadId` or `action` are corrupt, as are HTTP-shaped entries with missing origin/authority or malformed required fields. Loading throws `RoutineReceiptCorruptionError`, with code `routine_receipts_corrupt`, status metadata 503 and the fixed message `Saved HTTP routine receipts are inconsistent; repair routines.json before starting routines.` The manager constructor explicitly propagates this error through its outer loader catch. It does not return an empty writable manager, filter away the key, recover runs, queue work or overwrite the file. During server startup this stops startup; the status is error metadata, not a promised HTTP response from an offline server. Original file bytes and admitted identities remain available for repair.

Well-shaped receipts additionally compare the persisted authority field with current authority, independently of the fingerprint. Replay verifies that the referenced run exists, belongs to the requested routine, has `manual: true` and `triggerSource: "manual"`. Missing or inconsistent run association returns 409 with `The original manual run is unavailable`; authority mismatch returns 409 with `Idempotency key conflicts with the current routine definition`. These refusals do not replace the run, alter the receipt or write the file.

HTTP receipt history is bounded at **1000 entries**. A matching retry is still accepted at capacity; a new key receives 429. Entries are not silently evicted, and their original runs are protected from ordinary terminal-run pruning. There is no expiry/reset interface in this seam. If disk data has been externally altered so a receipt's run is unavailable, replay refuses with 409 and does not create replacement work. This retention bound limits admitted identities; active runs already follow the existing scheduler retention policy.

## Regression coverage

`server/routine-manual-request.e2e.test.ts` drives the production HTTP route and authenticated manager path against isolated fake-engine fixtures:

- Concurrent identical keys allocate one run; completed replay after a real server restart returns that run.
- No-header invocations allocate distinct runs; body spoofing cannot alter source/report metadata.
- Malformed/duplicate raw headers reject before mutation; a valid 128-character boundary key works.
- A real filesystem write failure starts no work, leaves no admitted run, and permits a subsequent successful retry.
- Verified paired callers, routine IDs and keys remain isolated; missing targets, invalid/revoked sessions, denied team access and hidden targets refuse before replay.
- Definition changes conflict; move freeze blocks even an already committed replay.

`server/routines.test.ts` additionally checks legacy-card/HTTP coexistence, reconciliation and reopen, trusted chat provenance, normal results allocation, package-stamped routine projections, transactional rollback and cleanup, malformed/unknown receipt variants, changed authority, protected completed-run retention and capacity refusal. `server/phones-member-routine.e2e.test.ts` now supplies explicit keys and replays on its existing real owner/guest run paths while retaining its phone-mount and denied-device-call assertions.

## Source-bound evidence

Baseline: `392f54255b4064f1fe4600a4b89ff14d22a6f074`. The first bounded A1b1 assessment was committed as `2bee2c5d5`; the parent then authorized focused lifecycle extraction. Pure extraction commit: `cf304a5c6`.

Evidence: `/Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/a1b1/`.

- Original `red.before.json`, `red.after.json`, `red.log`, `red.junit.xml` and archived test: real duplicate-key requests produced two runs, **1 failed test / 2 failed assertions**, exit 1. That unchanged red was not rerun for activity.
- `refactor/`: **347 tests passed** across routines, card requests, recovery and size guards; server typecheck and focused lint passed. Commands took 14.23 / 33.25 / 1.11 seconds respectively.
- `integration1/`: **464 tests passed** across 9 files, including the new real HTTP and existing owner/guest phone paths, card/manager/recovery/auth/visibility/access/size tests. Server typecheck and focused lint passed. Commands took 38.55 / 36.57 / 1.23 seconds respectively.
- Final source validation is recorded in `final/` and summarized in `handoff-a1b2.json`. This later batch is necessary because self-review removed internal package-install bookkeeping from the execution fingerprint and added its real-manager regression, move-freeze replay and valid-header-boundary assertions. Earlier results are not claimed as the final-source run.

`batch.py` records complete tracked/untracked source identities, HEAD/tree/status, wrapper and helper identities, dependency versions/hashes, exact argv, selected environment, UTC clocks, elapsed time, logs, JUnit counts and exit codes before/after every command. Source remains frozen during each batch. V1's available registry does not map these checks; neither its registry nor its runner was modified. The wrapper uses its existing source snapshot utility with controlled regular JSON evidence; these are local source-bound records, not an accepted V1 receipt or an F2 producer.

Reproduce a batch with `python3 <evidence>/batch.py final`; exact commands are in `<evidence>/final/commands.json`. Node is `/Users/sun/.nvm/versions/node/v24.22.2/bin/node`. Final commands include the targeted suites above, existing report-destination behavior, a real recovery restart case, the file-size guard, service typecheck and lint of all changed TypeScript files. Logs are retained rather than included here.

## Review and limits

Self-review preserved early authorization order and owner-started-run registration. Changed scope adds no network collection, UI, reports feature, second store/scheduler, dependencies, runner/CI configuration or grants. Source and report provenance are still derived from trusted routine/card state. Package-stamp projection mismatch was found during self-review, corrected before final acceptance, and covered through an actual stamped-manager run; no failing execution was hidden or reclassified.

Fixtures use synthetic homes/data, fake engines, short temporary paths and owned loopback endpoints. Awaited fixture shutdown is not proof of an OS-wide network sandbox or cleanup of arbitrary escaped processes. Atomicity inherits the existing owned-file transaction and single-server-writer model; this is not a distributed/multi-server receipt protocol. Existing interrupted-run recovery may resume the same run according to its existing policy; replay itself never creates a replacement run. No real credentials, providers, user data, package installation/build, application replacement, push, CI, publication or parent integration was performed.

Phase start was `2026-11-08T14:09:34Z`; per-command real clocks and final completion time are in the evidence. Model wait and inseparable implementation/model time are **unknown**. The parent performs independent read-only review and serial integration; local validation does not constitute acceptance or release.

## Independent review correction R1

Review of `39dd035c80cfd071ed05c83c9a239ed27748544b` found three persisted-state gaps: the HTTP loader accepted card-only fields, matching did not independently compare persisted authority, and replay did not validate the original run's routine/manual association. Synthetic persisted-file mutations and actual manager reopen reproduced these gaps on that exact production candidate. The source-frozen red batch `r1-red/` exited 1: **11 failed, 7 passed**, with 199 existing cases explicitly deselected by its HTTP-receipt test filter. It also confirmed existing missing-run refusal, exact replay at capacity, package projection, and conservative automatic-definition conflicts.

The correction rejects inconsistent HTTP shapes before they can be filtered away, propagates the fixed corruption error through the manager constructor, compares stored authority, and verifies run association before returning it. Tests retain exact mutated file bytes, original admitted identities and run lists, and assert no work starts. Capacity coverage now verifies an existing exact key succeeds with 1000 receipts while a new key still receives 429. Retiming/expiry coverage uses the actual scheduler methods and then reopens the persisted store, without changing production fingerprint policy.

Final correction evidence is in `r1-final/`, with commands in its `commands.json` and counts/timing in `handoff-r1.json`. Earlier 347/464/469 counts are historical and are not reported as validation of the correction. R1 phase began `2026-11-08T14:34:12Z`; actual execution clocks are recorded, model wait remains unknown. One production correction round was used; no integration, dependency, runner, CI, permission or size-budget changes were made.
