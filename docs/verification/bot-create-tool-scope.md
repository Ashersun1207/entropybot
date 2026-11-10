# Tool selection at bot creation

`POST /api/bots` accepts `toolScope` and `computer` inside `settings`.
The creation resolver validates that object before creating a bot. A valid
scope is passed to `Store.createBot` before its first durable record. The
configured-bot client also sends its creation scope inside `settings`.

For example, an owner can create a bot with browser inventory excluded from
its first turn:

```http
POST /api/bots
Content-Type: application/json

{
  "name": "Browser-restricted helper",
  "useDefaults": false,
  "settings": {
    "computer": "browser",
    "toolScope": { "deny": ["mcp:browser:*"] }
  }
}
```

A model selection, when needed, is supplied as top-level `modelSelection`.
`PATCH /api/bots/:id` uses top-level `toolScope`; its shape differs from the
creation request. A patch is unnecessary to establish the creation scope.

## Compatibility and defaults

The creation resolver's legacy top-level aliases are `name`, `title`,
`description`, `modelSelection`, and `section`. Those aliases override their
nested counterparts. Top-level `toolScope` and `computer` are ignored by the
owner creation path; they do not override nested settings or saved defaults.
This qualification preserves that behavior and does not add aliases or reject
unknown top-level keys.

Saved `newBotDefaults.profile.toolScope` applies when omitted. Explicit nested
scope overrides it, nested `null` clears it, and `useDefaults: false` skips the
template while still applying explicit settings. Invalid nested scope returns
400 without changing the saved bots or their IDs. Client-only sessions receive
403 for creation permission attempts, including unsupported top-level fields.
Companion-marked creation requests also reject these permission fields in both
locations, including a top-level null beside a restrictive nested scope.

## Isolated regression

Run with Node 24 and the existing repository dependencies. The HTTP regression
requires explicit paths to existing browser assets; it never downloads them.
Without both paths that one test is skipped, which is not qualification evidence.

```sh
OMB_CREATE_SCOPE_BROWSER_BINARY=/absolute/path/to/agent-browser \
OMB_CREATE_SCOPE_BROWSER_CHROME=/absolute/path/to/chrome-headless-shell \
OMB_CREATE_SCOPE_EVIDENCE=/absolute/path/to/synthetic-evidence.json \
node node_modules/vitest/vitest.mjs run server/bot-create-tool-scope.e2e.test.ts
node node_modules/vitest/vitest.mjs run server/new-bot-defaults.test.ts server/new-bot-defaults.e2e.test.ts server/tool-scope.e2e.test.ts server/store.test.ts server/request-auth.test.ts server/drivers/openai-chat-tools.test.ts
```

The HTTP test launches the current checkout through `launchVerificationServer`
with a disposable home and a loopback OpenAI-compatible provider, using only a
synthetic API key. It captures actual provider request bodies and tool names.
The provider always returns text and requests no browser operation. The test
checks browser tools are present in healthy controls in the same fixture,
absent on a newly created deny bot's first send without a policy PATCH, and
absent on an unsent deny bot's first send after restarting the same data.
GET and raw synthetic `bots.json` both retain the scope. A separate owner
request with only top-level scope retains browser inventory, explicitly
qualifying the ignored-field behavior. Resource receipts must report stopped
with all registered resources confirmed, actual child close, provider close,
and fixture directory removal.

The driver regression in `server/drivers/openai-chat-tools.test.ts` deliberately
returns a forged `audit_write` call from a synthetic provider under restrictive
allow and deny scopes. A healthy permitted tool remains advertised, the blocked
tool is absent, and the actual dispatcher reports failure without an approval
request or a fixture write. This supplements inventory checks; it does not
execute a real browser operation.

## Evidence provenance and limits

The November 9 finding referred to `probe-scope.mjs`. Its retained final file
creates both bots without a `toolScope` argument and then patches the deny bot.
It does not establish a failed POST request. No tracked earlier version of
that script was found in the outer repository history. Historical files are
left unchanged; this qualification uses new requests against baseline
`ce4534e86710b5c61125133263e6471dae440f25`.

The first HTTP qualification run passed the healthy browser, deny-from-birth,
top-level owner control, defaults, and nested authorization checks, then failed
because the fixture expected a client-only top-level request to return 201.
The existing API authorization layer correctly returned 403 before creation.
The fixture expectation was corrected and its zero-residue assertion retained.
The failure and successful rerun remain separate evidence. It was not a product
permission bypass.

Evidence is stored outside the application repository under
`private/engineering-foundation-evidence/bot-create-tool-scope/`: runner,
pre/post source hashes, Node/dependency/asset identity, exact argv and UTC,
exit codes, logs, JSON reports and synthetic fixture sidecars. Baseline records
predate the asset-aware runner revision and do not retroactively bind that
revision. Later runs record the runner hash and both actual asset hashes.

This is a contract qualification with tests and documentation only. It does
not qualify real models, browser navigation, user profiles, a real companion
transport, Keychain, builds, installs, deployment, other platforms, or remote
CI. Companion HTTP checks exercise the route's companion marker and the
existing authentication tests cover the trust layer separately. Existing
preset, visibility and creation-author policy remain in place. Independent
review of the resulting tree is required before main integration.
