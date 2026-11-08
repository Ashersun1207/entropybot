# Manual routine request context protocol

A1b4 adds the backend protocol needed by a future safe manual-run client. The frontend implementation, UI messages, explicit clear/reconcile action and reload persistence remain outside this slice. A1b3's four StoreProvider red cases were preserved and were not repeated.

## Wire contract

Public `GET /.well-known/entropybot/environment` includes `capabilities.manualRoutineRequests: 1`. This advertises protocol support; it grants no permission. A future protected client must fail closed if the capability or authenticated context is absent, rather than assume an older server honors unfamiliar headers.

Authenticated `GET /api/auth/session` retains its existing fields and includes this additional field only for callers with the client scope who are not service-trust loopback callers:

```json
{"manualRoutineRequests":{"version":1,"contextId":"mr1_<64 lowercase hexadecimal characters>"}}
```

The example describes the shape; the angle-bracket placeholder is not a valid context ID. Exact validation is `^mr1_[a-f0-9]{64}$`.

The context is deterministic and non-secret. It binds persisted `ENVIRONMENT_ID`, the exact canonical principal used by HTTP manual receipts, and effective authority (sorted scopes and the existing `ownerStarted` decision). Session principals use the existing `personKey`: verified email normalized by that helper, or session identity when no email exists. Owner principals use the existing local/verified-companion distinction. Service trust is ineligible; eligible loopback trust is implicitly owner. The common `manualAuthority` function supplies both context and receipt derivation, preserving the existing receipt request IDs, authority hashes and fingerprints.

Context stability is conditional on those inputs remaining equal. New sessions with the same verified email retain the same person identity; independent non-email sessions do not. Workspace changes, principal changes, scope changes or owner-started changes produce different contexts. Tokens, cookies, stored credential hashes, transport selection and editable profile/label fields are not inputs. There is no new key, credential store, authentication bypass or grant.

A keyed `POST /api/routines/:id/run` may additionally send exactly one `X-Entropybot-Manual-Context` header with the context ID. The server validates both headers and compares the expected context against the request's actual authenticated environment/principal/authority before consulting the routine manager for allocation, admission or replay. The guard is synchronous with admission; the client preflight is not the enforcement boundary.

- A well-formed context that differs returns HTTP 409 with `code: "manual_context_mismatch"` and a fixed message. It creates no receipt or run and never rotates an identity or retries.
- Malformed or duplicate context headers, or context without a valid `Idempotency-Key`, return HTTP 400. Context parser errors use `code: "manual_context_invalid"`; invalid key syntax retains the existing key-validation response. Neither error echoes supplied context/key values.
- Authentication, scope, visibility, bot access, move freeze and target existence retain their existing gates and refusal precedence. Context never makes a hidden or denied routine accessible.
- Matching context plus the same key preserves concurrent coalescing and replay, including after process restart.
- No-context/no-key legacy requests retain intentional new-run semantics. Existing key-only requests retain their original replay semantics but do not protect against client context changes. Omitting the expected context is not a safe fallback for the future protected client.

## Verification and source evidence

Baseline: `389c6bc4b66eaa507b711c4738c2a2a46b6e3bde`. Checkout: `/Users/sun/Desktop/Codex/gorkbot/.worktrees/engineering-manual-run-client`, branch `codex/engineering-manual-run-client`; initially clean, sole writer.

Evidence: `/Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/a1b4/`. The reused source-receipt wrapper captures before/after HEAD/tree/dirty/content, wrapper/helper/dependency hashes, exact argv, selected sanitized environment, UTC clocks, elapsed time, exit, logs and JUnit artifacts. Each batch keeps source frozen. These are controlled regular JSON records, not V1 acceptance or an F2 producer; V1/its registry/original owner were untouched.

The baseline real HTTP red batch selected the two new protocol tests: 2 failed, 4 existing tests deselected, exit 1, 6.177 seconds. Missing advertised capability and missing authenticated context failed directly against production endpoints. The four earlier StoreProvider red cases were not run. The first corrected-source batch passed all 25 tests, server typecheck and lint, but its outer 60-second harness deadline interrupted the wrapper before the last diff check/summary. Those completed per-command records remain in `final/`. Receipt self-review also found that the inherited wrapper lacked runtime-binary hashes. `bound-final/` therefore repeats only the same targeted commands with Node/Python binary identities captured before and after; earlier records are not retrospectively claimed to contain runtime hashes. No product code correction was needed for this evidence repair.

The initial implementation batch had 24 passed / 1 failed (25 total); server typecheck and focused lint passed. The actual HTTP mismatch correctly returned 409, but the generic HTTP error-code allowlist dropped its fixed protocol code. One correction added only the two manual-context error codes to that allowlist. The failure and original logs are retained in `green/`; final results are recorded in the accompanying evidence handoff. Targeted coverage uses actual HTTP fixtures for native JSON, concurrent guarded replay, local and persisted-session process restart, preflight then principal switch, refusal without disk mutation, malformed/duplicate/missing-key headers, authorization and hidden/missing targets, and existing no-header/key-only compatibility. Unit coverage checks workspace, companion, principal and authority isolation, scope ordering, canonical verified-email identity, non-secret inputs, and guard rejection before manager access. Environment coverage retains durable environment identity tests. `bound-final/` passed 25 tests with runtime hashes, server typecheck, focused lint and the unchanged size guard (all exit 0). A final compatibility scan found the existing exact public-capability assertion in `remote-sessions.test.ts`; its expected protocol field and loopback session assertion were updated. `compat-final/` selects only those two affected tests and checks types/lint/diff after that test-only update. Counts from these separate commands are not a single suite total. The production code and all four previously passing test files are unchanged between these final batches.

## Review and limits

Self-review preserved existing receipt derivation and upstream authorization gates. The new error codes are explicitly admitted by the existing HTTP error-code allowlist. `server/index.ts` grows by two lines, remaining below its unchanged size budget; there is no code compression or unrelated extraction. Context is an equality guard over current authority, not a secret capability. It does not bind the routine definition itself; the existing receipt fingerprint still enforces that on replay. It does not make an unknown effect safe to discard.

Tests use isolated synthetic workspaces, fake engines and owned loopback endpoints. They are not an OS network sandbox. There is no frontend protection, reload recovery or installation claim. No real account, provider, user data, Keychain, dependency install, package/build, CI, push, publication or parent integration occurs. Model wait and inseparable implementation/model time remain unknown. The parent performs independent review and serial integration.
