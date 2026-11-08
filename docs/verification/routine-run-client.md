# Manual routine client: bounded assessment

Status: **blocked before production implementation**. Baseline `6b1993a64204d3f26a5ada897746425653957dcb`, branch `codex/engineering-manual-run-client`, sole-writer checkout `/Users/sun/Desktop/Codex/gorkbot/.worktrees/engineering-manual-run-client`. The initial working tree was clean. This slice does not establish client idempotency, durable reload recovery, or a safe fallback for older servers.

## Verified production path

`src/state/store.tsx` dispatches `runRoutine` after `waitForExecutionSettings`, then sends an unkeyed POST and calls `onStarted` with the unvalidated response's `run`. Its callbacks settle once per dispatched action, but simultaneous actions issue separate requests. `src/state/api.ts` converts undecodable response JSON to `{}`. Thus HTTP success alone currently calls `onStarted(undefined)`.

All inspected UI callers use that action:

- `RoutineCalendarPage.tsx` guards duplicate local clicks with a ref, holds its busy state through settings flush and POST, and releases it in `onSettled`.
- `components/automations/actions.ts` resolves its promise in `onStarted` and rejects in `onError`; a store-level coalescer must notify every subscribing caller.
- `CloudSetup.tsx` uses `onStarted`/`onError` to update its ready panel. It has no independent durable request identity.

No UI entrypoint was changed. Approval-card flows and the existing backend no-key contract were left intact.

## Concrete blockers and proposed scope

The task requires returning a blocker before adding backend/shared/locale fields or broader trusted identity plumbing. Three observed gaps require that decision:

1. **No capability negotiation.** `server/environment.ts` advertises capabilities, but no manual-run idempotency capability exists. `server/index.ts`'s `/api/auth/session` response also lacks one. Optional headers are not proof that a server honors them. A successful run response on a legacy server cannot establish retry safety; a lost response gives even less evidence. Guessing from the product version or silently sending keys to older servers would violate the requested compatibility boundary.
2. **Public identity does not describe every backend principal.** `server/routine-manual-request.ts:43` separates authenticated session `personKey`, local owner, and companion-device owner identities. The `/api/auth/session` loopback response exposes `kind`, scopes, environment ID and trust, but no companion identity. `readSessionState()` drops even the existing environment ID, and falls back to loopback for unrecognized successful JSON. It is not an adequate fail-closed context decoder for this operation. Neither configured profile/email nor a routine-ID map repairs that gap.
3. **A preflight read cannot bind a later POST.** The existing run route derives the principal at request time. If cookies or the target change between preflight/settings flush and POST, reusing an old key under the newly derived principal can create a different receipt/run. A frontend comparison after the response cannot undo that mutation. No existing expected-context guard is present in this seam.

Proposed minimal follow-up scope, subject to parent authorization and independent review:

- Add a versioned manual-run capability and an opaque non-secret context identity to the authenticated session response. Bind the context to environment/workspace and exactly the principal used by manual receipts, including companion-device identity. Do not expose tokens or credential hashes, and do not use editable profile fields as authority.
- Let an opt-in keyed run carry its expected context; reject a mismatch before allocation, receipt admission or replay. Keep no-key behavior and approval-card contracts unchanged. Exact field/header names and hash construction need backend ownership review; this document does not establish a wire contract.
- Add strict client decoding and context lifecycle plumbing in `src/lib/session.ts` plus the appropriate startup/session owner. The store must capture scope before awaiting settings, validate it at dispatch, retain unresolved old intents across context changes, and refuse to send them to a new context. Missing capability/context must explicitly block this protected path.
- Then add one small helper owned by StoreProvider: coalesce subscribers, keep one key through transport/timeout/invalid-response failures, validate native run association/manual provenance before confirming, and rotate only after confirmed success or an explicit clear-intent action. Preserve ApiError status/body for 409/429/401; never auto-requeue or rotate on those refusals.

Reload support remains **unverified**. The inspected session-ended marker stores only a sign-out flag, not a safely scoped unresolved manual intent. A provider-local map would lose an unknown effect on unmount/reload. Any follow-up must either use an explicitly reviewed safe pending-intent mechanism or block/reconcile before another manual start; no durable behavior is claimed here. New user-visible blocked/reconcile/explicit-clear behavior may also require locale strings, which were outside this slice's authorization.

## Executed red evidence

Evidence directory: `/Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/a1b3/`.

`blocked-red/` records a real production StoreProvider dispatch with synthetic fetch responses, using the repository's existing `renderToStaticMarkup` capture pattern from `task-write-recovery.test.ts`. It does not replace the action with a fake helper. Server rendering deliberately avoids live snapshot/event effects; this is not a mounted happy-dom UI lifecycle proof.

One targeted Vitest command ran under Node `24.22.2`: **4 tests failed, exit 1**, elapsed wrapper time **2.603 seconds**. The failures demonstrate:

- Both explicit attempts after synthetic response loss send no `Idempotency-Key`.
- An empty successful response calls the success callback with `undefined`.
- A successful response naming another routine calls the success callback.
- Two simultaneous dispatches issue two POSTs, although both settlement callbacks fire.

The unchanged red test is archived as `routine-run-intent.integration.test.ts` in the evidence directory rather than committed as an always-failing product suite. To reproduce, copy that file into `src/state/` at the baseline and run the exact argv in `blocked-red/commands.json`. It uses fake responses only; no request reaches a real account or server.

The reused `a1b1/batch.py` wrapper was copied with only its checkout root changed. It records before/after source content, HEAD/tree/status, wrapper/helper/dependency hashes, argv, selected sanitized environment, UTC clocks, exit, log and JUnit artifacts. The batch reports `sourceUnchanged: true`. These are controlled regular local JSON records, not V1 acceptance or an F2 producer. V1, its registry and its original owner were untouched. The inherited `/tmp` setting did not launch a server/socket fixture in this dispatch-only check.

No green implementation claim is made. Settings-flush ordering, mounted UI callbacks, valid native response acceptance, 409/429/401 policy, context changes, unmount and reload still need implementation and final-source behavioral coverage after resolving the protocol scope. No full/backend/performance suites were rerun; production type/lint/size checks were not warranted for this documentation-only delivery.

## Review and handoff

Self-review checked the actual three callers, settings barrier, ApiError decoding, startup/session-ended lifecycle, environment advertisement, session response and backend receipt-principal derivation. No dependency, permission, network, persistence, backend, shared, locale, CI, release, engineering-document or size-budget changes were made. No real data, credentials, Keychain, package installation, build, push, application replacement or parent integration occurred.

Execution UTC start/end and source identities are in the before/after records; end `2026-11-08T14:55:36.989601Z`. Implementation/model wait time is unknown. No correction rounds were used. The parent owns scope authorization, independent review and serial integration. This assessment should not be integrated or reported as completed client protection.
