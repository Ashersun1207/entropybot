# Manual routine coordination across tabs

Baseline `ac389fc3adf857afe9239104ad7981328bd82d89`; implementation lives in `manual-run-multitab-coordination`. Integration and independent review are separate from this source verification.

## Contract

Every cooperating document in one origin/storage partition uses the native exclusive Web Lock `entropybot.manual-routine-intents.v1` for short synchronous ledger transactions. Reservation combines current-marker selection, capacity checking, load/filter/set/readback and owner-map updates. Confirmation combines exact-key/scope verification and confirmed persistence/map updates. Initial authoritative scope, settings flush, post-settings scope and the protected POST retain their original order; settings and HTTP never hold the ledger lock. Concurrent requests may send the same key, which the existing server receipt maps to one run. Different routines may dispatch concurrently without overwriting each other's ledger rows.

Acquisition has its own five-second monotonic deadline and abort signal, separate from the metadata and 30-second POST budgets. Expiry settles the caller and fences even a late native callback before transaction execution. Missing/null API, getter/method failure, rejection or failure to obtain a lock fails closed, with translated desktop/HTTPS guidance. There is no process-local or localStorage arbitration fallback. A failure before reservation does not create an unknown operation; an existing marker still exposes recovery. A failure after reservation retains its identity as unknown.

Explicit Retry (`acknowledgePriorRun=false`) captures the marker at action entry and only recovers that key/context. Missing, evicted or replaced identity cannot authorize a Retry POST. A joined subscriber also checks the actual completed operation's reserved marker and the current ledger against its captured identity before reporting success. A mismatch refuses that subscriber without changing the ledger or sending another POST; an independently authorized replacement may still complete its own request. Omitted acknowledgement still permits a new operation only after this owner reconciled the current marker; true remains an explicitly confirmed replacement, which does not cancel the original run. A late original response cannot overwrite that replacement. Two explicitly acknowledged new operations are intentional separate runs, not automatic duplicate recovery.

Ledger version 1, 32 entries, 32,000 input characters, per-owner inFlight/uncertain/completed maps and existing eviction eligibility remain. With 31 pending rows and two new routines, exactly one can reserve the remaining row; the other is refused before POST. Pending and unreconciled confirmed rows are not evicted. Cancellation uses its existing independent endpoint. Mount, reload and storage changes never trigger a resend.

Native capability is checked by API behavior, not guessed from the URL. Protected Run now is unavailable on ordinary insecure HTTP origins without native Web Locks; viewing/editing/cancellation remain usable. Locks do not coordinate different origins, host aliases, ports, profiles/partitions, or already-open older clients that ignore the protocol. This is not global server exactly-once across those boundaries.

## Executable checks

- `src/state/manual-run-coordination.test.ts`: capability failures, bounded acquisition, monotonic expiry, late callback refusal and transaction failure/release.
- `src/state/routine-run-intent.test.ts`: shared test coordinator, overlapping same-key requests, different routines, 31→32 capacity retention, missing/stale explicit Retry and failed confirmation coordination, plus original context/persistence/reload-owner contracts.
- `src/state/routine-run-intent.integration.test.ts`: production StoreProvider/EventDetails, settings barrier/subscribers, unsupported feedback and cancellation independent of lock waits, plus original late-response/replacement-provider cases.
- `scripts/testing/routine-run-multitab-ui.e2e.test.ts`: eleven real Chrome cases, two actual pages, production UI/state, actual preflights/settings and fake-engine server admissions. Covers same/different routine reservations, capacity, lost/confirmed recovery with reload and deliberate new run, acknowledged replacement with late response, missing/replaced recovery identity, native acquisition expiry/document-close release, real run cancellation during another page's lock wait, and actual insecure HTTP feedback.
- `scripts/testing/routine-run-reload-ui.e2e.test.ts`: three existing server-restart/browser-reload compatibility cases for the changed intent implementation.

Run browser checks only with an existing Chrome:

```sh
OMB_UI_E2E=1 node node_modules/vitest/vitest.mjs run scripts/testing/routine-run-multitab-ui.e2e.test.ts scripts/testing/routine-run-reload-ui.e2e.test.ts
```

Set `OMB_MULTITAB_EVIDENCE_DIR` and `OMB_RELOAD_EVIDENCE_DIR` to existing owned evidence directories to retain per-case JSON independently of the runner's passing-console suppression. Reports capture protected keys/context/run IDs, API runs where asserted, ledger snapshots and direct browser close/directory removal observations. They do not prove every OS descendant has exited.

The shared `src/testing/manual-run-locks.ts` fake exists only in tests: happy-dom's locks API is null. Unit/provider suites explicitly inject it; production never imports it. This fake is not cross-process evidence. Browser tests wrap the real native request only to mark when its synchronous callback holds the lock. A scheduling probe pauses the third native ledger getter only when no transaction is held, widening the original read/modify/write race. Native storage/set/readback and server admissions are real; this is a controlled schedule, not a natural race frequency claim. The fixed implementation executes this read while the native lock is held and does not enter the scheduling barrier.

## Evidence and failures

Private source-bound receipts/logs: `/Users/sun/Desktop/Codex/gorkbot/private/manual-run-multitab-implementation/`. The original read-only diagnostic under `private/manual-run-multitab-evidence/` is preserved unchanged.

The added client red run on baseline production code has three genuine assertion failures: absent Retry, changed Retry identity and missing native capability all incorrectly dispatch. The new browser regression on baseline intent has three genuine failures: two same-routine keys instead of one, one cross-routine row instead of two, and two capacity-bound POSTs instead of one. Name-filtered red runs deselect the other browser cases and do not constitute suite completion.

The first invocation failed before tests because this new worktree lacked node_modules; linked the already-installed engineering-foundation node_modules without installing anything. First green client batch passed 81 tests. First green browser batch had nine passes and one failure: coordination timeout was safely refused, but the existing UI classified every non-blocked ManualRunError as uncertain, showing Retry with no marker. The caller now classifies only unknown/changed as uncertainty, while stored-marker presence still restores Retry. Regression asserts Run now/no replacement control after a marker-free coordination failure. First app typecheck failed on missing `LockGrantedCallback<unknown>` generic arguments in test fixtures only; production types/strict were not weakened. Final committed counts and command receipts are in the private handoff; do not add overlapping runs together.

### Independent review correction R1

Review of `1bf8913b69047bfb9caeb29220b46625d7dd7353` found that an explicit Retry joining an existing provider operation bypassed the execute-path recovery checks. With marker A stored, an acknowledged replacement held behind settings and a joined Retry capturing A, both callers incorrectly received replacement B's result. Only the independently authorized replacement issued a POST; the defect was attribution and success notification, not a duplicate unauthorized request. An already-completed operation could likewise be joined after its Retry preflight stalled while the ledger disappeared or changed.

`r1-red-client` preserves six assertion failures on the reviewed production code: replacement/settings interleaving, disappearance, key/context/environment changes during joined preflight, and StoreProvider incorrectly calling the Retry subscriber's onStarted. The internal inFlight result now carries its reserved marker alongside the run, while the public API still returns RoutineRun. A joined explicit Retry checks that actual operation and the latest ledger before returning success. Positive controls retain same-identity coalescing across held settings and delayed preflight/phase confirmation. An additional control restores marker A after replacement B completes, proving that a current-ledger check alone cannot identify the joined operation.

Nine added unit/provider cases assert one producer POST, no Retry ledger write, correct rejection/settlement callbacks and retained details uncertainty. Prior 112-client/14-browser/35-guard counts belong only to the reviewed SHA; R1 commands/receipts and final committed counts are separate under the same private evidence root with an r1 prefix. Short transactions, native lock/deadline behavior, authentication/context checks, cancellation and the ledger schema/capacity are unchanged.

## Runtime and security limits

The product browser fixture uses Chrome, an owned profile/home, basic password store, mock Keychain, and the existing isolated fake engine. The insecure hostname is statically mapped to loopback and reverse-proxied only to the owned preview. No public sites, real models, user data/configuration or real Keychain are used. Background-network flags are not an OS egress sandbox. No dependencies, server routes/schema, installation scripts, permissions, builds, installs, pushes or automatic resend were added.

Independent standalone evidence at `private/manual-run-lock-runtime-evidence/QUALIFICATION.md` observed native lock semantics in Electron 43.7.9/Chromium 150 loopback HTTP and local self-signed HTTPS, and Chrome 156 local HTTPS. Its original overall command exited 1 after a transient descendant cleanup observation; semantic results and controller cleanup reconciliation must remain distinct. This does not qualify this ledger implementation through production Electron main/preload, the installed application, a package or public TLS. pt-BR human review remains an independent formal integration condition.
