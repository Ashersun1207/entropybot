# OpenAI-compatible provider error redaction

This bounded product-security change addresses P2(1) in the outer project's
experience handoff. Its original synthetic provider echoed literal `sk-LEAK`
while the configured credential was `fixture-only`; it did not demonstrate
that a configured short credential bypassed the existing turn-final scrub.
The isolated server baseline here independently reproduced the persisted
`error: upstream HTTP 401: invalid api key sk-LEAK` activity (with the configured
`q7!` already masked). Helper failures also exposed configured credentials.

## Contract

HTTP 401/403 bodies use fixed content:
`Authentication required or permission denied. Check the provider credentials and access.`
The provider label and HTTP status remain; upstream authentication wording and
arbitrary machine codes are omitted. Recognized invalid-key/authentication or
permission errors inside HTTP 200 JSON/chat SSE and Responses failure events
use the same fixed content. Responses auth codes map to 401/403 instead of the
old generic 400. Raw bodies still drive existing route, key-rejection, request
size, tool-refusal and reasoning-replay classification before presentation.

Other diagnostics mask the request owner's exact configured credential without
a length/prefix floor, then apply the existing high-precision text redactor.
Masking occurs before truncation, including safe machine-code suffixes. Existing
402 trial-credit and 429 rate/retry reasons remain. A one-character credential
can also mask coincidental occurrences in prose or codes: confidentiality takes
precedence over retaining those characters. No globally held secret or new
registration lifetime is introduced. The existing turn-owned integration-secret
list now uses the same local helper; its ownership and contents are unchanged.

The shared HTTP/error path covers chat and Responses and both `sendTurn` and
`generateText`. Malformed HTTP-200 completion JSON gets a fixed protocol error,
since the native JSON parser can reveal a truncated credential in its source
preview. Other thrown error messages/stacks are scrubbed while preserving error
classes and cancellation. Missing helper credentials now fail locally, like
missing turn credentials.

## Synthetic verification

Run from this checkout with Node 24 and the approved dependency symlink:

```sh
node node_modules/vitest/vitest.mjs run server/drivers/provider-error-redaction.test.ts server/drivers/openai-responses.test.ts server/provider-error-redaction.e2e.test.ts
```

- `server/drivers/provider-error-redaction.test.ts` drives the production driver
  against loopback HTTP: exact short echo, configured short non-prefix and
  single-character credentials, long credential, JSON/text/malformed/empty HTTP
  bodies, JSON and SSE completion errors, parser previews, ordinary credit/retry
  details, missing credentials and simultaneous independent helper/turn clients.
  The concurrency control requires each client to preserve the other's unknown
  short canary; the shared text redactor stays unchanged before and after disposal.
- `server/drivers/openai-responses.test.ts` exercises real route negotiation into
  Responses, then both `error` and `response.failed` events. Its existing key
  rejection, rate-limit, idle timeout and Stop assertions remain.
- `server/provider-error-redaction.e2e.test.ts` launches the normal disposable
  verification server with explicit synthetic config, sends actual chat turns,
  checks HTTP message/activity rows for HTTP auth, SSE auth and ordinary 429
  errors, restarts the same fixture and re-reads the persisted rows. Both fixture
  and provider close in `finally`; no real provider or user credentials are used.

The source-bound private receipts live in the outer project's
`private/engineering-foundation-evidence/p2-provider-error-redaction/`.
`red-corrected` records 13 failed / 36 passed driver tests on the baseline;
`red-e2e` records the persisted short-echo failure. The original `red` run is also
retained: its SSE case incorrectly attempted to feed SSE into a non-streaming
helper; the corrected run tests SSE through the streaming turn instead.
`green-focused` records the first repair's five failures (three assertions from
one lost-code-suffix defect, a read-only DOMException message assignment, and
one old auth wording assertion); `green-focused-r1` records 50 passed. `related`
records 334 passed / one further old auth-wording assertion. The first committed
`final-related` run records 481 passed / one real regression: a mixed HTTP400
invalid-key/tools-unsupported error downgraded optional tools because the new
fixed sentence no longer matched the existing auth classifier. The corrected
fixed content includes `Authentication required`; the original one-request
assertion is preserved. Final receipts and
the handoff bind the corrected source, exact commands and counts; intermediate
results are not substituted for final checks.

## Maintenance and limits

The scope is the shared chat refusal helper, chat transport/runtime and Responses
status mapping, targeted tests, this note/index and engineering lessons. The
existing turn scrub is reused rather than duplicated; the chat runtime stays
within the unchanged size guard. No dependencies, install scripts, network
capabilities, UI, schema, memory/About me, quality tooling or ledgers change.
Security review found no added external destination, credential persistence,
permission expansion or background lifetime. Existing provider requests still
send their credential only through the normal Authorization header.

This is exact-value masking of known credentials, not detection of every unknown
secret. Unknown short strings outside recognized auth errors retain the global
redactor's precision floors. Encoded, transformed or partially echoed unknown
values are not generally detected. Successful model output is outside this
error-boundary contract. Fixed templates can coincidentally contain characters
from a one-character credential; the guarantee concerns upstream value echoes,
not eliminating every occurrence of that character in all metadata. No real
provider/model, Keychain, user data, desktop UI, build/install/release, push,
cross-platform or independent integration review is claimed.
