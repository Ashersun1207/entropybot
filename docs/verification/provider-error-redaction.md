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
Masking occurs before truncation and tool-name extraction, including safe
machine-code suffixes and retained refusal metadata. Existing 402 trial-credit
and 429 rate/retry reasons remain. A one-character credential can mask
coincidental occurrences in upstream prose or codes; generated labels, statuses
and fixed content remain intact. Classification is captured separately before
presentation and carried on the error, so it does not depend on the sanitized
sentence. No globally held secret or new registration lifetime is introduced.
The existing turn-owned integration-secret list is passed into this boundary;
its ownership and contents are unchanged.

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

## Independent review R1: refusal provenance and classification

Independent security review `ses_e3d5e0593ffeDzKVrErItYReAo` returned
NEEDS-CHANGES on `1c42bc68f`; the earlier 482-test result remains historical
and did not cover these paths. Integration is held pending independent re-review.

The R1 red tests use the actual OpenAI-compatible driver and owned loopback HTTP.
An auth-shaped `tool_use_failed` bypassed fixed content through the retained raw
refusal object. A full configured `fixtureCredentialABCDEFGHIJKLMNOPQRSTUVWXYZ`
after 195 `a` characters was truncated to `fixtu` by the fallback before it could
be masked. Actual server activity rows persisted both leaks. These are missed
production readouts, not the unknown/partial-secret limitation. Separately,
configured key `a` remasked generated auth text and markers, causing the
mixed invalid-key/tools-unsupported HTTP400 response to make two requests;
configured `q7!` made one. Both must now make one request.

The shared error factory retains only sanitized refusal fields, including nested
metadata keys/values, before tool extraction or shortening. Recognized auth
failures do not enter tool-refusal retry/fallback presentation. Ordinary non-auth
refusals keep their existing three-attempt behavior and useful sanitized native
log fields. Existing Responses missing-scope negotiation still takes its explicit
route fallback; any emitted auth diagnostic keeps fixed content. Error provenance
contains only a frozen classification, never the raw body or credentials. Safe
messages pass through exception/final presentation without another key-based
rewrite. The original error classes, numeric size data and finite route-refusal
enums remain; nested exception causes are scrubbed. Local matching escapes
literal credentials, replaces overlapping values longest-first in one pass and
preserves complete local/shared redaction markers on repeated passes.

Audit covered HTTP and completion constructors; refusal message/type/code and
nested metadata; tool-name extraction and the 200-character fallback; HTTP
500-character message/suffix; route exhaustion's 300-character projection;
exception message/stack/cause; final 2,000-character runtime errors; native logs
and persisted activities. Raw bodies remain transient classification inputs;
only safe data reaches retained error payloads and presentation wrappers.

New receipts use the private `run-review-r1.py`, hashing all server sources,
called scripts, lock/package files, dependency entry points and Node binary
before and after the command. The earlier private runner omitted tracked server
e2e files from its source hash list. Original receipts are retained; the frozen
R1 red tests were repeated on `1c42bc68f` product bytes with the corrected runner
as `review-r1-red-bound`: **10 failed / 18 passed** across the two suites. All
in-progress files were restored byte-for-byte afterward, with a restoration
receipt. This is an overlapping repeat of the earlier separate driver
8-failed/17-passed and server 2-failed/1-passed runs, not additional cases.

The first R1 repair run, `review-r1-green-focused`, had 249 passed / 2 failed:
it omitted useful non-auth refusal log fields and blocked established Responses
missing-scope fallback. Both original assertions remain; restoring sanitized
metadata and explicit route precedence yielded 251 passed. Expanded boundary,
metadata, cause and idempotence checks then yielded 35 passed in the two focused
suites. Final committed-source receipts and counts are in the private R1 handoff;
these overlapping focused runs must not be added to the final selection.

The first committed R1 final run had 499 passed / 1 failed: the old one-character
`x` test checked the entire event JSON, and a generated event ID happened to
contain `x`. The diagnostic was correctly masked. The test now requires an
actual runtime error and checks its message, retaining key `x` and the existing
suffix assertion. No product source changed for this fixture correction; this
is a metadata-coincidence assertion error, separate from the genuine remasking
and fallback regressions above.

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
