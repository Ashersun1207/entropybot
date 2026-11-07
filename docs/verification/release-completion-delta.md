# Release completion: delta recovery and fixture lifecycle

Baseline: `2f063e4381b82e8ef0d635174a922f1db82f264c`. Development branch: `codex/release-completion-delta`, persistent worktree `.worktrees/release-completion-delta`. This work does not change versions, packages, installation, credentials or release publication.

## Recovery contract

A rejected native resume starts a replacement session with a bounded recovery window. Ordinary model-aware replay can retain more messages, but that selection must not silently expand the native fallback's 40-message window. Recovery text and the handed record must use the same selection, including its represented IDs and omitted boundary.

`beginTurn` now selects recovery separately. Initial and transcript-native replay retain their adaptive limits. The replacement is credited only when the provider acts, and only for the history actually represented in its recovery prompt. An earlier teammate result outside that window remains available when the ongoing assignment returns; a result already replayed is not offered twice.

The existing production e2e failed on the baseline: `ROUND_ONE_RESULT_TOKEN` occurred once in the recovery prompt where the test required zero. Its omitted/handed and later-return assertions remain intact. The failure and bounded related runs are recorded under the persistent evidence directory below.

## Managed fixture restarts

The affected Chief, room and delta tests use `VerificationServer.restart` rather than spawning an unregistered replacement server. Each replacement has its own IPC bootstrap identity, generation and lease.

- SIGTERM still requires the matching internal stop receipt, successful exit and actual close. Shutdown deadlines, invalid receipts and unknown CLI resources remain errors.
- An intentional SIGKILL first requests an identity-checked inventory over the fixture creator's IPC channel. The child seals its scope against new registered CLI creation before returning the inventory.
- The runner kills the server and the inventoried CLI process groups, waits for server exit/close and group disappearance, and records external-stop evidence before advancing the generation.
- Missing or invalid inventory, permission errors, unconfirmed groups and deadlines retain the directory and fail the stop; a new generation cannot start after an unknown stop.
- The supported confirmation domain is the fixture server and registered CLI process groups. PID/group reuse races, malicious detached descendants and arbitrary external services are not an absolute guarantee. Cross-platform execution is not established by the Darwin run.

The previously proposed `closeVerificationAfterExternalStop` from `47b5d025b` is not imported: no helper catches shutdown failures and deletes the data directory. `waitForExit` now rejects when escalation still does not produce close, instead of resolving from a deadline.

## Browser stand-ins

The saved-login and sign-in-code stand-ins previously answered `close` without changing the sessions returned by `session list`, so real shutdown waited for a browser the fixture permanently claimed was running. They now keep a per-session closed marker and report the actual simulated close transition. No browser assertion or production close check is removed. Local HTTP bridges close in a finally block; tool directories are removed only after the fixture confirms its stop.

The baseline login runs reproduced four shutdown-deadline failures. These remain genuine failures in the red log; they are not treated as successful cleanup.

## Evidence and bounded validation

Persistent source of truth:

`/Users/sun/Desktop/Codex/gorkbot/private/release-completion-evidence/delta`

Node 24.22.2, existing app node_modules, no dependency installation; explicit Vitest `--root . --configLoader native`. Test setup uses synthetic HOME/data. Default short TMPDIR is retained. `OMB_VERIFICATION_EVIDENCE_DIR` redirects fixture server logs to the persistent evidence tree without forwarding that setting to product children.

Recorded baseline failures:

- `baseline-recovery-red.log`: the specified replacement-session recovery e2e fails with token count 1 versus expected 0.
- `baseline-login-lifecycle.log`: saved-login (3 tests) and sign-in-code (1 test) fail with shutdown-deadline receipts.

Completed bounded checks so far:

- `round-1-unit.log`: delta/turn-context, verification lifecycle and cleanup: 4 files / 89 tests passed.
- `inventory-boundaries.log`: scope sealing and inventory identity/failure checks: 2 files / 17 tests passed.
- `runner-boundaries.log`: existing real process-tree and worker/bootstrap boundaries plus control tests: 2 files / 15 tests passed. The forced-stop negative case still preserves its fixture directory without claiming an internal receipt.
- Final server typecheck and focused lint passed; the file-size guard passed without increasing budgets.

`round-1-e2e.log`: all 5 affected e2e files / 92 tests passed in 400.98 seconds, with no skipped tests. This includes the original replacement recovery assertions and the existing rejected/failed replacement, deferred message, rewind, switch, Stop, SIGTERM/SIGKILL restart and browser sign-in cases. Server logs are retained in `round-1-servers/`.

After adding durable copies of intentional external-stop receipts:

- `final-lifecycle.log`: all 4 lifecycle/scope/cleanup files / 43 tests passed on final source.
- `final-recovery-and-restart.log`: the recovery regression and both Chief SIGTERM/SIGKILL restart cases passed (3 selected tests; 43 unselected tests are not counted as passed). All 46 delta cases had already passed in the full affected run.
- Final receipt copies are retained in `final-lifecycle/` and `final-servers/`; unknown-stop diagnostics are also copied to `unknown-stop-evidence/` while their original directories remain untouched.

The final commits are recorded in the external handoff. The commands are:

```sh
node node_modules/vitest/vitest.mjs run --root . --configLoader native --disableConsoleIntercept server/delta-context.e2e.test.ts server/room-coordination.e2e.test.ts server/long-running-chief.e2e.test.ts server/saved-login.e2e.test.ts server/sign-in-code.e2e.test.ts
node node_modules/vitest/vitest.mjs run --root . --configLoader native --disableConsoleIntercept scripts/testing/verification-lifecycle.test.ts scripts/testing/verification-external-stop.test.ts server/verification-process-scope.test.ts server/testing/cleanup.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit
node_modules/.bin/oxlint --deny-warnings <changed TypeScript files>
node node_modules/vitest/vitest.mjs run --root . --configLoader native scripts/testing/file-size-ratchet.test.ts
```

Run these with Node 24 on PATH and `OMB_VERIFICATION_EVIDENCE_DIR` set to the persistent evidence subdirectory. Counts from overlapping reruns are not added to imply independent coverage.

Maintenance review: no dependency, install hook, release/version, credential or authorization changes. The default product process still has no verification scope without the creator's IPC bootstrap. The new external-stop branch is available only to that authenticated fixture owner; it does not treat missing graceful receipts as success. Negative tests retain unknown-stop directories and diagnostics. This is a scoped review, not a whole-repository security assurance.

No full-repository regression, real models, real data, Keychain, installation, signing or publication is claimed here.
