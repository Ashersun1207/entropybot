# Optional Connected Apps outage isolation

Scope: `codex/optional-connectors-isolation`, baseline `f7a890d7586cc52d34bb602779593fd884d6b326`. Fix identity is the commit containing this document. No deployment, build, installation, real model call, live configuration/data or Keychain access.

## Actual failure boundary

`mountChatTools` starts MCP clients concurrently, then consumes the results in configuration order. Previously every built-in rejection was thrown, including optional `composio` and `own_apps`. `ChatMcpClient` turns upstream RPC error frames into the sanitized `McpRequestRefused`; this reaches the chat runtime before its first model request. Existing custom-server skip notices did not apply to these built-ins.

Only those two optional mounts now reuse the existing skip/close path with a constant reason. Their entire unavailable tool group is absent. Required agents/computer mounts, schema checks, invalid selection/configuration, cancellation and errors during tool execution retain their previous failure behavior. Grants, approval, budgets and retries are unchanged.

Preparation was traced through `team-connections-host.appsIntegrations` → `composio.mcpIntegration` → `connectedServiceSlugs`. The inventory network failure already returns matching cached slugs or an empty list; `appsConnected` also handles inventory failures. The allowlist is serialized before that read and remains present. No preparation catch was added: arbitrary preparation/policy failures still propagate. This is tested against the actual Composio module with a loopback inventory failure, plus the host's propagation contract. The reported remote broker outage was supplied by the controller and was not re-probed here.

## Regression and validation

Use Node v24.22.2. `node_modules` is an ignored symlink through `../ci-gate-cleanup/node_modules`; its underlying checkout and this checkout have identical `pnpm-lock.yaml` SHA-256 `b1d200592b36e631d7633bbecc433d15beed9c931fec54b833131f1f20fd2648`. No dependency installation or dependency edits.

The new OpenAI-compatible tests launch loopback HTTP and real stdio MCP fixture processes in disposable directories, using only synthetic credentials. They cover both optional bridge identities at initialize and tools/list; the retained healthy tool actually writes its synthetic receipt and the fake model returns a completed assistant reply. Assertions cover omitted unavailable tools, a skipped notice with no upstream secret/URL canary, no runtime error, required agents failure, invalid policy, and cancellation before any model request. The mount regression additionally checks failed-process exit, retained healthy built-ins, excluded-tool rejection and approval still required.

Evidence root on this machine:

`/private/var/folders/3_/4wcgrlpj1cx98_dychpdms240000gn/T/opencode/optional-connectors-evidence/`

Each `run.py` invocation records exact argv, UTC start/end, HEAD/tree/status and tracked/untracked file hashes before and after execution, with output in the matching `.log`. These are local provenance records, not an authoritative CI or V1 accepted receipt.

- `red-all-mount-phases`: original production code, four new outage tests fail; three cancellation/required/policy controls pass. Its 124 filtered tests are not counted as full-suite validation.
- `green-focused`: the foreground tool's 60-second cutoff interrupted the suite, leaving no after receipt; not counted as passed.
- `green-focused-serial`: 358 pass, one fixture setup failure. The synthetic broker token did not match the existing 64-character hex requirement; only that fixture was corrected.
- `green-final`: eight complete files / 359 tests passed, no skips. JUnit report retained. A final assistant-text assertion was then added; `committed-tests` reruns the same complete set on the committed candidate.
- `lint-final` / `types-final`: scoped oxlint with `--deny-warnings` and `tsc -p tsconfig.server.json --noEmit` pass. Final committed equivalents use `committed-lint` / `committed-types`.

Exact regression selection (the final run adds default and JUnit reporters):

```sh
node_modules/.bin/vitest run --maxWorkers 1 \
  server/drivers/openai-chat-tools.test.ts \
  server/drivers/chat-mcp-tools.test.ts \
  server/composio.test.ts server/host/team-connections-host.test.ts \
  server/agents-bridge-gates.test.ts server/connector-advertisement.test.ts \
  server/connector-verdict.test.ts scripts/testing/file-size-ratchet.test.ts
```

## Review and limits

Focused maintenance/security review: production change is limited to the rejected built-in mount branch. It adds no network destination, process command, environment variable, credential access, persisted state, dependency, grant or workflow. The existing failed client is closed; skipped reasons are constant. Existing required mounts and schema/policy validation remain fail-closed. Tool execution errors remain uncertain and are not automatically retried. Source size guard is included without budget changes. Independent review and serial integration belong to the controller.

This proves the synthetic Chat Completions path, including the existing OpenAI-compatible driver used for this protocol. It does not prove real Magpie/Composio recovery, UI or installed-app behavior, other engine runtimes, full patch-gate/whole-repository CI, or all cross-platform process cleanup. Existing startup timeouts remain unchanged, so an unresponsive optional service can still delay a turn until its startup budget expires. No claim that the upstream service has been restored.

The development-quality finish script is run from an evidence-local copy with pending independent review and unknown cost/escape/rescue measurements, so it cannot overwrite another owner's outer ledger. Its case and decision are handed to the controller for serial recording; they do not authorize integration or deployment.
