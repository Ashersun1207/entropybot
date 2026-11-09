# C1 chat preparation stage attribution

Measured 2026-11-09 on branch `codex/c1-prep-attribution`, baseline/measurement HEAD `8820d6ef3410f5706761ca9567f69e0089d88a65`, tree `e1dd4d3595df2565f7797d565f0babfb93393ddf`. Sole writer: assigned C1 measurement agent. Product source was unchanged before, during and after execution. This report and the owned measurement scripts are the only committed changes. No optimization or speedup is claimed.

**The largest newly delimited first-turn stage is the host's data-integration conditional: 53.568 ms median (36.156–143.333 ms, n=5).** It calls `dataEngine.unavailable()`, which synchronously loads and caches the DuckDB native binding, and then mints the data capability. The reused turn spends 0.017 ms in the same conditional. Driver `ensureCliVersion` takes 0.027 ms first / 0.004 ms second; it is not the missing ~110 ms. Successful version checks are already cached, including the version read by the startup snapshot.

The detailed batch's send → Node engine spawn-call entry is 117.281 ms median (99.163–234.546); its second-turn send → stdin-write entry is 17.313 ms (15.207–24.004). These reproduce the broad shape of [C1a](chat-preparation-attribution.md), whose corresponding medians were 110.602 / 16.101 ms. They are separate observations, not a subtraction of historical medians. An initial, coarser successful batch measured 105.203 / 16.600 ms; all samples and the later high outlier are retained.

## Ordered source path

The ordinary direct-chat path is in `server/index.ts`, not solely in the Claude driver. Reference line numbers below refer to the unmodified baseline.

1. The send API/control command reaches `startTurn` → `batchSaves` → `beginTurn` (7559 onward). Workspace/turn availability and bot identity precede the first host mark at `limitFailovers.restore` (7619). Admission then checks approval transitions, budget, busy/capacity, provider/model/tool scope and guest confinement; persists the user message, request lineage and dispatch claim; mints a generation and starts the watchdog. HTTP authentication/routing occurs before this host mark. No authorization is bypassed by the observer.
2. An immediately invoked async setup body (7817) reads `registry.engineRead`, calls `warmSummaries.beforeTurn` (7831), and awaits `compactConversation` (7832). Transcript/replay/session context, persona, skills and host integrations follow (7850–7978). The async body starts synchronously; setup launch → body entry is only 0.006 ms. Time across an `await` can include unrelated synchronous request work and microtask scheduling.
3. Workspace preparation (7979–8002) calls `ensureWorkspace` (creates private memory folder/seed via atomic write if absent), `beginMemoryTurn` (journal reconciliation), `botBox.lend`, `skillsHost.turnImports`, `ensureTaskWorkspaceWithSkills` (task folder and own/imported skill links), then renders skills/playbooks and pins task cwd. Helpers are in `server/workspace.ts`, `server/memory-journal.ts`, `server/skill-task-links.ts` and their imported skill helpers.
4. Surface selection/conditional computer setup (8003–8317) precedes peer/agents capability assembly, hooks, mentions/coordination strings, optional checkpoint, live setup mode, **data integration (8362–8366)**, CRM/email/device/browser checks, place recording, cancelled-handshake wait, fresh-claim/policy checks and agents bridge (8318–8424). `dataIntegration` (2423) calls `dataEngine.unavailable()` before minting a capability. `DataEngine.load()` (in `server/data/engine.ts`, 719 onward) uses `loadBinding` → `nativeRequire(directory)("@duckdb/node-api")` on first use and retains either binding or failure. This does not open a bot database or run a query.
5. `buildSystemPrompt` (8425–8468) evaluates its argument expressions too: memory projection, team notes, recent work, skills and other prompt parts. Then prompt byte counts are recorded and `autoRecallPrompt` (8471) calls `buildRecall` in `server/recall.ts`: query extraction, topic passages, memory retrieval/optional embedding, selection and conversation passages. Only synthetic fixture memory/history is present; no embedding provider is configured.
6. Final context/clock/recovery/limit checks lead to `savedSteps.dispatch.sendTurn` → `quickFallback.sendTurn` (8490–8517), provider wrappers (including engine-memory admission/context and engine-home context where enabled), then `ClaudeDriver.sendTurn` in `server/drivers/claude.ts` (972).
7. The driver awaits startup catalog completion; validates scope, managed credentials and busy state; chooses/checks permission mode; constructs the user message (attachment reads if images exist); allocates IDs/retry state/argv; creates environment; **awaits `ensureCliVersion` (1028)**; applies version/tool-policy flags; resolves model/injection; assembles MCP entries/project `.mcp.json` and gates (1063–1151); allocates an MCP temp directory; reads auth settings, refreshes hook-token file, merges tool-search/bot settings (1153–1183); canonicalizes cwd and hashes the complete launch contract (1184–1203).
8. **Only then** does the driver test session reuse (1205–1206). A matching session emits start and writes stdin (1207–1230). A fresh session splits the stable/volatile prompt, allocates/writes the private system prompt, awaits `createPermissionBroker` socket binding (1262–1307), writes MCP/settings private files (1313–1319), then calls `spawnCli` (1336). `server/procs.ts` resolves CLI, checks argv, selects engine home/box and calls Node `spawn`; stream handling/session registration precedes stdin write. The broker exists even in full-access mode because questions remain interactive.

`ensureCliVersion` returns immediately after a successful cached check (816–820). `snapshot` reads version, assigns `cliVersionChecked=true`, then reads help/auth (1924–1936). The host startup-read gate is already settled at measured dispatch. The near-zero timed ensure await is consistent with this path; caching it again would not address the measured delay. The observer does not record credentials or prompt bodies to establish this.

## External instrumentation and isolation

`scripts/c1-prep-stage/observer.mjs` is an external preload inserted only into the owned source server argv, ahead of the existing verification preload. Node 24 `registerHooks({load})` calls the original loader, then inserts calls to one private global timing function immediately before **unique, exact source anchors** in only `server/index.ts` and `server/drivers/claude.ts`. The final hook adds 30 host and 20 driver points. A missing/duplicate anchor throws before fixture readiness; it cannot silently measure a different location. No checkout source is edited, and no application module/function/export is replaced. This is module-load instrumentation of the in-memory module text, not an observer of unmodified executable instructions.

Each point appends a stage name, PID and `process.hrtime.bigint()` timestamp to a private in-memory array. It does not add an await, modify expressions, branch results, returns, permissions, protocol messages, app logs or application outputs. The array is written to a separate private JSONL on server exit, outside the turn spans. The preload also retains C1a-style external Node spawn/stdin wrappers; original calls/receiver/arguments/return values are forwarded. It removes its own import from `process.execArgv` so child proxy argv are unaffected. The only extra environment key is the owned observer log destination. Hook/code loading occurs before timed sends. Timing calls, allocation, changed code/JIT layout and spawn wrappers can perturb scheduling; **total overhead is unknown**, with no observer-disabled control or correction.

The runner uses existing `launchVerificationServer` and `runControlOmb`. Parent HOME is a new evidence-owned empty directory; each fixture has its own disposable synthetic HOME/config/data and sealed fake-engine PATH. Outer TMPDIR is `/private/tmp`; fixture TMPDIR is its short private data `tmp` directory, following L17. Only repository fake Claude is configured: `happy`, tools `[]`, two identical `B1TOKEN synthetic answer` replies, cadence `7:10`; input is `hello synthetic baseline`. Model is `claude-sonnet-5`, permission mode `bypassPermissions`. No actual MCP server is mounted by the fake. The observed configuration names `agents`, `phone`, `data`, `ogb` prove assembly, not tool initialization by a real engine.

No model/provider/user data/Keychain access was requested; no real account, browser or desktop is configured. All control requests target the returned owned loopback URL. This fixture is not an OS network sandbox. Dependencies are the pre-existing tree at `.worktrees/local-build-a49b96f-verified/node_modules`, linked locally after the initial missing-dependency failure; no install, dependency/lockfile change or download occurred.

Send origin is entry to the runner's in-process `runControlOmb(['send', ...])`, after selecting the starter and opening that turn's SSE connection. Receipt remains the fake prompt-dump mtime proxy polled nominally every 2 ms; first text is a new client-observed runtime `content.delta` carrying the marker. Polling uncertainty is not bounded by 2 ms. Spawn entry and stdin entry precede their original calls; neither proves engine readiness or write completion.

## Detailed stage results

All values are ms, **n=5 first and n=5 second**, detailed batch `attempt3`; spread=max−min. Every row has independently recorded start/end boundaries. Rows within each of the following two tables are serial, except the explicitly labelled aggregate rows. A boundary timestamp belongs to both adjacent spans; median components need not sum to a median total. Values below 0.001 ms round to zero, not zero instructions.

| Host stage | First median | First min–max | Spread | Second median | Second min–max | Spread |
|---|---:|---:|---:|---:|---:|---:|
| Send → host admission boundary (client/HTTP/auth/routing, early beginTurn combined) | 7.475 | 6.831–13.645 | 6.814 | 2.749 | 2.620–5.053 | 2.433 |
| Admission, persistence, request/claim → setup launch | 11.255 | 10.708–11.837 | 1.129 | 2.024 | 1.331–3.862 | 2.531 |
| Setup launch → async body entry | 0.006 | 0.004–0.007 | 0.003 | 0.002 | 0.002–0.004 | 0.002 |
| Startup engine-read await | 0.025 | 0.024–0.027 | 0.002 | 0.004 | 0.002–0.006 | 0.004 |
| Readiness branch residual | 0.002 | 0.002–0.002 | 0.000 | 0.001 | 0.000–0.001 | 0.000 |
| Warm-summary call → continuation (includes scheduling) | 4.822 | 4.224–5.069 | 0.845 | 5.931 | 5.462–6.878 | 1.416 |
| Compaction call → context setup | 0.897 | 0.848–0.998 | 0.150 | 0.644 | 0.528–0.790 | 0.262 |
| Transcript/context/persona | 1.505 | 1.394–1.682 | 0.288 | 0.839 | 0.621–1.042 | 0.421 |
| Host integrations/skills selection | 0.678 | 0.578–0.706 | 0.128 | 0.194 | 0.150–0.311 | 0.161 |
| Ensure bot workspace | 8.489 | 7.098–8.617 | 1.519 | 0.031 | 0.021–0.042 | 0.021 |
| Memory-turn begin and box lending | 0.515 | 0.457–2.346 | 1.889 | 0.282 | 0.170–0.379 | 0.209 |
| Task workspace and skill links, including turnImports arguments | 6.286 | 5.413–9.818 | 4.405 | 0.390 | 0.358–0.522 | 0.164 |
| Skill rendering/playbooks/task pin | 5.511 | 5.347–7.487 | 2.140 | 0.015 | 0.013–0.019 | 0.007 |
| Surface selection/preparation | 0.305 | 0.285–0.332 | 0.047 | 0.038 | 0.027–0.048 | 0.021 |
| Peer lookup/agents condition | 0.036 | 0.034–0.048 | 0.015 | 0.003 | 0.003–0.004 | 0.001 |
| Agents integration assembly | 0.526 | 0.375–0.619 | 0.244 | 0.094 | 0.064–0.327 | 0.263 |
| Hooks integration conditional | 0.041 | 0.035–0.051 | 0.016 | 0.010 | 0.008–0.010 | 0.002 |
| Mentions/coordination/prompt strings | 0.339 | 0.319–0.356 | 0.037 | 0.025 | 0.023–0.037 | 0.014 |
| Checkpoint conditional | 0.001 | 0.000–0.001 | 0.000 | 0.000 | 0.000–0.001 | 0.000 |
| Live bot/setup mode | 0.075 | 0.069–0.088 | 0.020 | 0.004 | 0.004–0.005 | 0.001 |
| Data integration conditional (availability/load + capability) | 53.568 | 36.156–143.333 | 107.177 | 0.017 | 0.016–0.025 | 0.009 |
| CRM/email/device checks | 0.588 | 0.529–0.672 | 0.143 | 0.077 | 0.052–0.150 | 0.098 |
| Browser conditional | 0.247 | 0.224–0.319 | 0.095 | 0.052 | 0.048–0.068 | 0.020 |
| Auto pin/place recording | 0.041 | 0.035–0.050 | 0.015 | 0.005 | 0.004–0.006 | 0.002 |
| Cancelled-handshake await and fresh-claim check | 0.037 | 0.033–0.040 | 0.007 | 0.006 | 0.005–0.009 | 0.004 |
| Prompt kind/coordination checks | 0.015 | 0.012–0.019 | 0.008 | 0.003 | 0.003–0.006 | 0.003 |
| Agents bridge/confinement filter | 0.198 | 0.170–0.229 | 0.059 | 0.055 | 0.047–0.062 | 0.015 |
| System prompt, including argument evaluation/memory projection | 7.170 | 6.615–9.169 | 2.554 | 0.744 | 0.689–0.928 | 0.239 |
| Prompt-byte bookkeeping and recall await | 3.035 | 2.502–5.786 | 3.284 | 0.808 | 0.658–1.742 | 1.084 |
| Final context/clock/limit checks → dispatch call | 2.677 | 2.250–6.689 | 4.439 | 0.522 | 0.483–1.433 | 0.950 |
| Dispatch argument evaluation/wrappers → driver entry | 1.158 | 1.027–3.305 | 2.278 | 0.092 | 0.081–0.315 | 0.234 |

| Driver/launch stage | First median | First min–max | Spread | Second median | Second min–max | Spread |
|---|---:|---:|---:|---:|---:|---:|
| Startup model-catalog await | 0.001 | 0.001–0.011 | 0.010 | 0.001 | 0.000–0.007 | 0.007 |
| Scope/managed-auth/busy checks | 0.026 | 0.024–0.203 | 0.179 | 0.010 | 0.006–0.014 | 0.007 |
| Permission mode/host-control check | 0.001 | 0.001–0.004 | 0.003 | 0.001 | 0.001–0.001 | 0.001 |
| User-message construction | 0.019 | 0.018–0.102 | 0.084 | 0.003 | 0.003–0.007 | 0.005 |
| IDs/retry/argv/environment | 0.062 | 0.056–0.223 | 0.167 | 0.071 | 0.061–0.151 | 0.089 |
| ensureCliVersion await | 0.027 | 0.026–0.102 | 0.075 | 0.004 | 0.003–0.009 | 0.006 |
| Version flags/tool policy | 0.036 | 0.033–1.689 | 1.656 | 0.013 | 0.010–0.024 | 0.013 |
| Model resolution await | 0.018 | 0.017–0.078 | 0.060 | 0.006 | 0.004–0.013 | 0.009 |
| Model injection/argv | 0.002 | 0.002–0.018 | 0.016 | 0.002 | 0.002–0.004 | 0.002 |
| MCP/project config/gates/temp allocation | 0.261 | 0.239–1.786 | 1.548 | 0.160 | 0.145–0.432 | 0.287 |
| Environment/auth/settings/hooks/tool-search assembly | 0.747 | 0.692–2.832 | 2.140 | 0.241 | 0.234–0.288 | 0.054 |
| Cwd canonicalization/launch-contract hashing | 0.138 | 0.129–0.512 | 0.383 | 0.098 | 0.080–0.113 | 0.033 |
| Reuse decision → fresh branch | 0.001 | 0.001–0.006 | 0.005 | — | — | — |
| Fresh prompt split/cleanup closure | 0.011 | 0.011–0.062 | 0.051 | — | — | — |
| System prompt temp allocation/write | 0.248 | 0.209–0.628 | 0.419 | — | — | — |
| Permission broker bind await | 0.506 | 0.456–0.974 | 0.517 | — | — | — |
| MCP/settings file writes/final flags | 0.184 | 0.166–0.267 | 0.101 | — | — | — |
| Launch try boundary | 0.000 | 0.000–0.001 | 0.000 | — | — | — |
| spawnCli resolution/boxing → Node spawn entry | 0.035 | 0.033–0.063 | 0.030 | — | — | — |
| **Aggregate: send → Node spawn entry** | **117.281** | **99.163–234.546** | **135.383** | — | — | — |
| **Aggregate: send → stdin-write entry** | **120.771** | **102.133–248.121** | **145.988** | **17.313** | **15.207–24.004** | **8.797** |
| Aggregate: reuse decision → reused stdin-write | — | — | — | 0.314 | 0.249–0.421 | 0.172 |

The 143.333 ms data-branch sample belongs to fixture 4 and is retained. The tables attribute intervals in the current run, not the exact historical C1a samples. The detailed host capability aggregate was 55.602 ms (38.369–145.439), now split above. Workspace aggregate was 19.914 ms (18.537–28.154). Raw individual boundaries and every coarse/detailed aggregate are in `summary.json`; do not add those aggregates to the serial rows.

## What remains inseparable and the concrete C1 candidate

- The data conditional includes the availability method, native require/module loading, its cache update, capability minting and normal scheduling. There are no independent marks inside `DataEngine.load`, CJS package evaluation or the native loader. **53.568 ms is the branch cost, not a pure dlopen/CPU duration.** Source shows first availability loads the binding; this report does not apportion JS loading versus native relocation versus scheduler/disk delay. The second turn's same branch is already cached.
- Prompt construction includes all evaluated helper arguments; memory projection, recent-work rendering and skills indexing are not individually timed. The recall row includes prompt-byte bookkeeping and the await; FTS/topic/embedding/conversation substeps are not individually timed. The synthetic memory/history size is tiny, so these figures cannot predict populated-user recall cost.
- Workspace row boundaries separate bot workspace, memory journal/box lending, task workspace/skill links and rendering/pin; they do not split filesystem calls, fsync, imported-skill argument work or Store persistence within those rows. These create/check actual private fixture files and launch identity; they are not demonstrated redundant.
- HTTP authentication/client command/routing/early beginTurn remain one front interval. Admission combines budget/model/scope/approval checks with message persistence and claim bookkeeping. Driver credential/scope and permission checks are separately bounded, but there is no pure end-to-end authorization CPU figure. Scope/credential/generation checks must remain fresh regardless of speed.
- The warm-summary await includes caller suspension and request/microtask work. `beforeTurn` can immediately return `none` when there is no pending summary; **4.822 ms does not demonstrate 4.822 ms of summary computation or an intentional timer**. Neither this nor other await spans separates scheduler delay from callee work. No actual summary/model execution was requested. The setup IIFE and cancelled-handshake wait have separate explicit spans; no unexplained fixed 100 ms dispatch timer appears.
- Spawn → prompt receipt remains C1a's combined fake Node startup/import/pipe/readline/dump/observer interval. There is no real engine-ready marker, real MCP mount or tool initialization measurement here.

**Next C1 implementation candidate:** move the eager data availability/native-binding load out of ordinary chat preparation, toward actual data capability use (or a separate readiness phase), while retaining equivalent availability reporting, tool selection, failure handling, scope, credentials, cancellation and same-session contract identity. In this no-data conversation, the host nevertheless executed a measured 53.568 ms data-preparation branch. That is an identifiable optional preparation dependency; loading a data binding is not intrinsically necessary to deliver this chat's prompt. It is necessary somewhere when data functionality is actually used.

There is **no proven removable millisecond total**: no alternate implementation or control was run, and changing when availability is established can change tool advertisement/failure semantics. The measured branch is a target cost, not a promised 53.568 ms saving. It already caches successful/failed loads; adding another steady-state cache is not the proposal. CLI version checking is also already cached, and the measured ensure call is negligible. MCP driver assembly and broker binding are sub-millisecond medians here; deferring arbitrary tools, sharing processes across identities or weakening permissions is not justified. Workspace creation/persistence is required on a fresh profile under the current contract; potential consolidation needs separate call/behavior evidence. Engine reuse already works and is not a new C1 optimization.

The external module hook successfully delimited these stages, so no in-tree timing points were necessary. If a follow-up needs finer decomposition, the minimal additional external marks would surround `DataEngine.load`/`loadBinding`, individual prompt helper evaluation and the warm-summary callee's immediate-return path; no source change is required by the present loader method. This report stops at the documented boundaries rather than assigning unmeasured internal costs.

## Provenance, exact commands and counts

Evidence root: `/Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/c1-prep/` (private, not committed). Machine: Apple M2 Pro, 12 logical CPUs, 17,179,869,184 bytes RAM; macOS 27.2 build 26B123. Node `/Users/sun/.nvm/versions/node/v24.22.2/bin/node`, v24.22.2. Fixtures ran serially; this agent ran no overlapping heavy task. Other machine activity was uncontrolled. Before-run hashing warms filesystem caches; fresh fixture does not mean OS-cache-cold.

| Batch | UTC start–end, 2026-11-09 | Wrapper wall s | Runner window UTC | Exit | Load avg 1/5/15, before → after |
|---|---|---:|---|---:|---|
| attempt1, setup failure | 09:24:14.928–09:24:18.631 | 3.702 | Import failed before fixture launch | 1 | Recorded in manifests |
| attempt2, coarse successful | 09:25:00.405–09:25:45.707 | 45.302 | 09:25:19.424–09:25:32.368 | 0 | 7.922/6.849/4.960 → 6.190/6.516/4.903 |
| attempt3, detailed authoritative | 09:26:53.253–09:27:39.103 | 45.849 | 09:27:11.211–09:27:24.905 | 0 | 3.869/5.738/4.750 → 6.928/6.300/4.995 |

Exact batch commands, cwd the assigned worktree:

```sh
python3 scripts/c1-prep-stage/batch.py /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/c1-prep/attempt1
python3 scripts/c1-prep-stage/batch.py /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/c1-prep/attempt2
python3 scripts/c1-prep-stage/batch.py /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/c1-prep/attempt3
```

After attempt1, the existing dependency tree was linked with:

```sh
ln -s /Users/sun/Desktop/Codex/gorkbot/.worktrees/local-build-a49b96f-verified/node_modules node_modules
```

Attempt2 and attempt3 are **distinct measurement batches**, not pooled n=10. Each has 5 fresh fixtures, 10 sends, 10 completed waits, 10 SSE observers and 5 awaited closes. Total successful work: 10 fresh fixtures / 20 turns / 10 closes. Attempt3 supplies the table's n=5 per side. Attempt1 has zero fixtures/turns; launcher imports failed because this new worktree lacked `node_modules` (`ERR_MODULE_NOT_FOUND: mdast-util-from-markdown`). Its full log, 7,160-entry matching manifests and original runner snapshot are retained. This was environment setup failure, not product behavior. The existing dependency symlink resolved it without installing anything. Attempt3 was a deliberate refinement of the coarse attribution, not a retry of a failed product test.

Each wrapper launches exactly `[NODE, '--experimental-strip-types', ROOT + '/scripts/c1-prep-stage/runner.mjs']`, cwd `ROOT`, with only `PATH=Node24-directory:/usr/bin:/bin:/usr/sbin:/sbin`, `TMPDIR=/private/tmp`, synthetic `HOME=OUT/runner-home`, `OMB_VERIFICATION_EVIDENCE_DIR=OUT`, `LANG=en_US.UTF-8`. Child server's exact injected argv and sealed environment are in `results.json` → `injected`; these include the original fixture verification preload and IPC lifecycle. Each turn records exact `sendArgv` and `waitArgv`, using `send --url OWNED_URL --bot STARTER_ID --text 'hello synthetic baseline'` and `wait --url OWNED_URL --bot STARTER_ID --timeout 20`. No Stop, restart, startup/idle/RSS benchmark, B1/F1 rerun, build/install, push or live-model call occurred.

Before launching each runner, the complete `batch-before.json` was written; after exit, `batch-after.json` recorded final code and hashes. Both successful batches have **78,345 matching SHA-256 entries each**, covering tracked source, existing dependency files including traversed symlink targets, Node binary and the three then-existing measurement scripts. HEAD/tree/status matched before/after each batch. Status explicitly lists the owned untracked runner directory; the dependency symlink is ignored. No product source or tracked baseline file changed. The summarizer was added to the owned scripts after measurements; it is bound separately by SHA-256 in resource audits, not retroactively included in the measurement manifests. `runner-snapshot/` in each batch preserves its exact executed scripts, including the coarse hook before refinement. System utilities/Python stdlib are not inventoried individually. These are local measurement receipts, not F2 release authorization.

Postprocessing commands actually used:

```sh
python3 /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/c1-prep/summarize.py /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/c1-prep/attempt2
python3 /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/c1-prep/summarize.py /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/c1-prep/attempt3
```

The first call used the coarse summarizer; the second added detailed subspans without changing any measured evidence. The final owned version, `scripts/c1-prep-stage/summarize.py`, additionally checks five samples for every present stage and paired argv/cwd equality, and labels the warm-summary interval explicitly as including scheduling. Final verification ran this owned version on both batches (exact commands/logs in evidence-root `verification.json`). The summarizer validates same engine PID, first-only spawn/fresh branch, second-only reuse branch, stage uniqueness/order, cleanup and before/after hash equality. `summary.json` retains every per-run boundary; ten `runN-{first,second}-events.json`, five `observer-N.jsonl`, `results.json`, persistent server logs and manifests retain the independent observations.

Detailed batch PID pairs: server/engine 53875/53910, 53915/53944, 53953/53982, 53987/54074, 54106/54149. Within each fixture the same engine PID handled both replies, one streaming spawn occurred on the first turn and zero on the second, with the explicit `driver.reuse` mark on each second turn. All 10 waits reported settled/completed and all 10 fresh SSE observers found the marker. The same bot, cwd, fake argv and server instance are retained in raw results. No real engine quality or billing claim follows from fake usage fields.

Measured wrapper execution window including gaps: 09:24:14.928–09:27:39.103 UTC (204.175 s). Sum of wrapper walls: 94.853 s. Reading, instrumentation authoring and report writing outside those windows were not separately timed; model waiting is unknown.

## Cleanup, validation and scope review

Every acquired fixture was closed through the existing lifecycle, then recorded owned server/engine PIDs were checked absent and private data directory checked removed. Final per-batch `final-owned-resource-audit.json` rechecked all 10 recorded PIDs and five directories in each successful batch: none remained. Attempt1 failed before creating a fixture. The empty synthetic runner HOME is deliberately retained in evidence. This confirms the observed normal fixture domain, not arbitrary unobserved/reparented descendants; no process-name kill or broad temp deletion was used. Raw fake prompt/config dumps with capability material were left in the lifecycle-owned fixture and removed; only PID/argv/cwd/MCP-name projections were retained.

Scope maintenance/security review: external hooks only in owned fixtures; source anchors fail closed; only timing names/PIDs/clocks are buffered; synthetic environment and original fixture IPC/permission checks remain intact. No added network destination, dependency, permission, credential export, product protocol, install hook or background service. No runtime instrumentation is enabled by application code. Removing the owned preload removes all measurement points.

Validation: both successful batches passed runner completion/cleanup assertions and postprocessing checks; source hash equality was established independently per batch. Node syntax checks for both `.mjs` files, Python AST checks for both `.py` files and `git diff --check` are the appropriate scope checks. Product/type/full CI suites were not repeated for unchanged product source. The verification-doc index test requires every new recipe to be linked from `docs/verification/README.md`; this assignment explicitly permits only this report and owned scripts, so the index remains an **integration follow-up outside this commit's allowed file scope**. No passing whole-docs-gate claim is made. Independent parent review, index linkage and integration remain pending.
