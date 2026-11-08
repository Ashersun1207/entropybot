# C1a paired chat preparation attribution

Measured 2026-11-08 in sole-writer worktree `.worktrees/engineering-chat-attribution`, branch `codex/engineering-chat-attribution`, clean HEAD `0b5e21b81c254c48135b868d3a9fd9f21f2e3484`, tree `664717633b1db05450fd7d0c51c93e08c2af070c`. This is a bounded measurement, with no product optimization. Only this new report is committed. Compared with B1's measured `6d84641d92b8f4a19e045da00e5dcbaa6257f689`, the checkout changes only `docs/engineering/MAINTENANCE.md` and `docs/verification/perf-baseline.md`; product source is identical.

**The engine was already reused on all five second turns.** Within each fresh fixture, the same bot, conversation, model, permissions, configuration, workspace, fake PID, launch argv and session ID were retained. Median send → prompt receipt was **181.0 ms first / 18.5 ms second**; send → published text was **215.2 / 53.1 ms**. These are paired first-versus-second observations on existing behavior, not a change-versus-baseline improvement. No unrelated B1 medians were subtracted, and no live-provider gain is claimed.

## Conditions and boundaries

- Apple M2 Pro, 12 logical CPUs, 16 GiB RAM (17,179,869,184 bytes); macOS 27.2 build 26B123. Node `/Users/sun/.nvm/versions/node/v24.22.2/bin/node`, v24.22.2. Existing `node_modules` symlink; no installation or dependency changes.
- Authoritative load averages (1/5/15 min), before → after: 5.081 / 5.790 / 5.335 → 7.736 / 6.302 / 5.528. Fixtures ran serially; this agent ran no overlapping heavy task. Parent was restricted to light documentation; other machine activity was uncontrolled. Source/dependency hashing warms filesystem caches. A fresh fixture is a fresh process/profile, not OS-cache-cold execution.
- Existing `launchVerificationServer` lifecycle: disposable HOME/config/data, sealed PATH, repository fake Claude only; short outer `TMPDIR=/tmp`, with fixture-owned short temp directories. No UI/package/app launch, real provider, user configuration/data, credentials, Keychain, external services or real tools. This is not an OS network sandbox.
- Same B1 synthetic input `hello synthetic baseline`, fake `happy`, tool calls `[]`, reply `B1TOKEN synthetic answer`, cadence `7:10`. Authoritative `FAKE_CLAUDE_REPLIES` contains **two identical replies**, because the fake consumes the array sequentially. All pairs use `claude-sonnet-5` and `bypassPermissions` within the isolated fixture. MCP configuration names remain `agents`, `phone`, `data`, `ogb`; names prove configuration assembly, not connections or mounted tool initialization.
- Send origin is entry to in-process `runControlOmb(['send', '--url', fixtureURL, '--bot', starterID, '--text', 'hello synthetic baseline'])`, after bot lookup and opening a new SSE subscription for that turn. Acknowledgement is return from that command, not engine delivery. `wait --url fixtureURL --bot starterID --timeout 20` must report `settled` / `completed` and the scripted answer. All 10 authoritative turns did so. No restart, Stop, or idle benchmark was run.
- Receipt uses B1's atomic fake prompt-dump mtime change, polled every nominal 2 ms. It proves execution reached the dump inside `playTurn`, not exact kernel delivery or host write completion. Scheduling/polling uncertainty is not bounded by 2 ms. First text is a new client-observed SSE `kind: runtime`, `event.type: content.delta` carrying the marker after send origin, not historical transcript text, model-token timing or renderer paint. Each fresh observer's frames and exact first match are retained and checked.

## Observed phases

A narrowly external preload, injected only into the owned source server's argv, wraps Node's `child_process.spawn` for the streaming fake-engine argument shape and that child's stdin `write`. It records spawn-call entry, spawn return, Node's `spawn` event, stdin-write entry, and first observation of each stdout `system/init` with session ID. The runner retains B1's independent prompt-dump and SSE observations. No source file, protocol payload, return value, permission or tool configuration is changed. Clock readings use `process.hrtime.bigint()` in server and runner on this host.

The stdin-write timestamp precedes the underlying call; it is not write completion. The Node `spawn` event means OS process creation was reported, not engine readiness. The fake emits `system/init` **after receiving the prompt** (`server/testing/fake-claude-cli.ts`, `playTurn`), so an independent pre-prompt ready boundary is **unobservable here**. Write and spawn-event order can overlap: on first turns the write begins before the asynchronous spawn event is observed. Those spans must not be added as independent serial stages. Independent prompt polling and stdout observation can also see receipt/init in either order.

All figures below are milliseconds, n = 5 per side; spread = max − min. Each row is calculated from its own samples. Medians of component spans need not add to an aggregate median.

| Boundary | First median | First min–max | Spread | Second median | Second min–max | Spread |
|---|---:|---:|---:|---:|---:|---:|
| Send → acknowledgement | 28.627 | 26.978–38.389 | 11.411 | 12.594 | 11.182–13.283 | 2.101 |
| Send → spawn-call entry | 110.602 | 102.520–198.372 | 95.852 | — | No engine spawn | — |
| Spawn call → Node spawn event | 4.080 | 3.408–4.415 | 1.007 | — | No engine spawn | — |
| Spawn call → stdin-write entry | 3.816 | 3.164–4.077 | 0.914 | — | No engine spawn | — |
| Send → stdin-write entry | 114.324 | 106.598–202.188 | 95.591 | 16.101 | 14.682–17.217 | 2.535 |
| Acknowledgement → stdin-write entry | 85.697 | 79.619–163.799 | 84.179 | 3.503 | 3.375–3.944 | 0.568 |
| Stdin-write entry → prompt receipt proxy | 70.112 | 66.675–70.884 | 4.208 | 1.863 | 1.808–3.162 | 1.354 |
| Stdin-write entry → stdout init observed | 69.406 | 65.647–71.142 | 5.494 | 1.394 | 1.238–1.824 | 0.586 |
| Send → prompt receipt proxy | 181.000 | 175.136–272.701 | 97.565 | 18.487 | 16.490–20.379 | 3.888 |
| Send → published client text | 215.201 | 209.057–307.617 | 98.560 | 53.075 | 52.148–53.909 | 1.761 |
| Prompt receipt proxy → client text | 34.818 | 33.921–35.940 | 2.019 | 34.935 | 33.530–35.658 | 2.127 |
| Stdout init observed → client text | 35.230 | 34.629–36.022 | 1.393 | 35.398 | 35.034–36.118 | 1.083 |

First-turn preparation includes a substantial interval **before spawn is called**, plus a separate interval after stdin-write entry while the new fake process starts and consumes its input. The latter combines runtime startup, script loading, scheduling, pipe/readline delivery, fake prompt/dump work and observer delay; it is not pure Node startup. The second turn avoids process creation and reaches the existing engine promptly. Post-receipt scripted output/event latency is similar on both sides. The first fixture's pre-spawn interval was higher than the other four and is included, not discarded.

Prompt construction, recall, permissions, MCP-config creation, CLI version checks and dispatch scheduling do not have independently delimited causal spans in this observer. Their individual costs, actual tool/mount startup, and the cause of the first fixture's larger pre-spawn interval remain **unobservable/unattributed**. Source inspection shows preparation occurs before the reuse check in `server/drivers/claude.ts` (including `ensureCliVersion` and configuration assembly); it does not establish that any such operation accounts for a measured duration.

## Pair evidence and reuse

First / second entries below are per-fixture values. Full argv, bot/thread identity, cwd, event frames and session IDs are in `attempt2/results.json`, `observer.jsonl` and process snapshots before first turn, between turns and after second turn. The server PID also remains unchanged within each pair. Each pair has exactly one observed engine spawn before first text and zero during the second turn; both init frames carry the same session ID. Fake dump PID/argv/cwd agree across turns. No retention assumption is based only on idle state or a session-file match.

| Fixture | Server PID | Engine PID first = second | Session ID first = second | Ack ms | Receipt ms | Client text ms |
|---|---:|---:|---|---:|---:|---:|
| 1 | 44729 | 45088 | `173cb3ec-8bc2-482f-8542-cb73b1102657` | 38.389 / 13.283 | 272.701 / 18.522 | 307.617 / 53.746 |
| 2 | 45095 | 45187 | `61555eef-abbe-4bed-8d0d-ddf582dc3a6c` | 35.080 / 12.594 | 196.230 / 18.487 | 232.170 / 53.075 |
| 3 | 45196 | 45232 | `5f27c05f-6de2-4c71-80fd-5d9311795a23` | 27.713 / 11.182 | 178.013 / 16.490 | 212.831 / 52.148 |
| 4 | 45239 | 45275 | `708d16fb-fbfd-4e13-ba8b-7cb5f995fc0a` | 28.627 / 13.273 | 181.000 / 20.379 | 215.201 / 53.909 |
| 5 | 45280 | 45310 | `eeef9f4c-4008-413a-8ca3-1883a2ba8e85` | 26.978 / 12.489 | 175.136 / 17.958 | 209.057 / 52.893 |

| Within-pair first − second difference, ms | n | Median | Min–max | Spread |
|---|---:|---:|---:|---:|
| Send → acknowledgement | 5 | 16.531 | 14.489–25.106 | 10.617 |
| Send → receipt | 5 | 161.523 | 157.178–254.179 | 97.001 |
| Send → client text | 5 | 161.292 | 156.164–253.870 | 97.707 |
| Receipt → client text | 5 | -0.309 | -1.014–1.352 | 2.366 |

These are paired differences, not differences of unrelated medians. Order is deliberately first then second; process reuse, first-use caches and prior conversation state co-vary. This is not a randomized experiment isolating reuse as the sole cause. The report supports the existing same-process fast path, not a new optimization's benefit.

## Provenance, failure and time accounting

Evidence root: `/Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/c1a/`. Both batches are preserved separately, including failed observations. Exact commands, from the assigned worktree:

```sh
python3 /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/c1a/batch.py
python3 /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/c1a/attempt2/batch.py
python3 /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/c1a/attempt2/summarize.py
```

The first command's files were moved intact into `attempt1/` after it finished; its manifests retain the original execution paths and its original runner/wrapper/preload contents remain preserved there. They are not rebound to attempt2. The second command is the only retry. Wrappers use `[NODE, '--experimental-strip-types', OUT + '/runner.mjs']`, cwd as above, and only explicit `PATH=Node24-directory:/usr/bin:/bin:/usr/sbin:/sbin`, `TMPDIR=/tmp`, `OMB_VERIFICATION_EVIDENCE_DIR=OUT`, `LANG=en_US.UTF-8`. Per-server actual injected argv and sealed child environment are recorded in `results.json` under `injected`; `childArgv` alone is the uninstrumented helper template. No ambient user secrets are inherited.

| Batch | Wrapper UTC start–end (2026-11-08) | Wrapper wall s | Runner UTC start–end | Runner s | Exit |
|---|---|---:|---|---:|---:|
| Attempt 1, excluded | 08:51:17.862–08:51:51.112 | 33.250 | 08:51:35.081–08:51:38.221 | 3.140 | 1 |
| Attempt 2, authoritative | 08:52:47.292–08:53:31.420 | 44.128 | 08:53:02.888–08:53:15.549 | 12.661 | 0 |

Instrumented execution window including diagnosis/retry gap: **133.558 s**, from 08:51:17.862 to 08:53:31.420 UTC, below 15 minutes. Wrapper wall totals are 77.378 s; runner windows total 15.801 s. Before/after hashing and wrapper work are outside reported turn spans. Reading/preparation/report writing were not separately timed; model waiting time is unknown. There were no B1/F1 reruns, startup/idle/resource benchmark repetitions or active Stop measurements.

Attempt 1 completed its first turn but the second fake reply fell back to `hello from fake claude` because only one scripted reply was supplied; marker observation failed (`missing observations`). Its spawn target predicate also failed to recognize the resolved fake executable, leaving no spawn records. Root causes are external runner configuration/observer matching, not a product failure. The retry supplies two identical replies and matches streaming CLI arguments (`--input-format`, `stream-json`). `attempt1/batch.log`, both SSE files, manifests and `owned-resource-audit.json` retain the failure. No failed sample is included in the authoritative statistics or reconstructed after the fact. Both recorded owned PIDs 43578/43612 were absent and that fixture directory removed in the audit.

Each batch wrote `batch-before.json` completely **before runner launch**, then `batch-after.json` after exit. Both bind the exact HEAD/tree, clean status including untracked files, command/cwd, secret-free env, Node version, machine/load, UTC, log path and exit (null before execution), plus **77,837 SHA-256 entries** each. Coverage follows B1: all tracked repository files, traversed dependencies including symlink targets, Node binary, runner, wrapper, and the additional external observer. Before/after hash maps match exactly within each batch, and HEAD/tree/status are identical and clean. Hashes were not retroactively added to a measurement. The report commit is documentation only and is not the measured HEAD. System utilities/Python standard library are not individually inventoried.

Key authoritative evidence: `attempt2/{batch-before.json,batch-after.json,batch-timing.json,batch.log,runner.mjs,batch.py,observer.mjs,observer.jsonl,results.json,summary.json,summarize.py}`, ten `runN-{first,second}-events.json` files, and persistent `server-*.log` files. Raw fake dumps with temporary capability material were not retained outside the fixture; only PID/argv/cwd and MCP names were projected. Fake usage/cost fields are synthetic protocol constants, not actual incurred cost.

## Overhead, cleanup and decision

Observer record-writing wall time across eight records per server was 0.817–0.940 ms total (including spawn/init/write/close records). This is a partial direct overhead counter: it excludes wrappers, buffering/JSON parsing on stdout, scheduling perturbation, final cost record and any interactions with product listeners. No observer-disabled control was run, so total overhead is **unknown** and no overhead correction is subtracted. The preload observes stdout before the product's listener, adding some latency. SSE handling and dump polling also perturb the runner, as in B1. Process snapshots and source hashing occur outside timed turns. Higher first-fixture load/noise is retained.

Existing lifecycle close was awaited for every fixture. Post-close snapshots found neither recorded server nor engine PID, and each owned data directory was removed. The evidence-root `final-owned-resource-audit.json` at 08:55:37.915 UTC covers these ten PIDs plus both failed-attempt PIDs and all six data directories; none remain. It also records the summarizer's SHA-256. This confirms the observed normal fixture ownership domain, not arbitrary unobserved or reparented descendants; no process-name killing or arbitrary cleanup was used.

**Next implementation candidate: not justified by this evidence.** Same-identity reuse already works; individual pre-spawn operations and their necessity have not been causally timed. A specific MCP deferral, preparation cache or broader process-sharing change would be speculative. Any further C1 work should first obtain narrower evidence for a concrete operation while preserving bot/thread, workspace, permission, auth/version and cancellation contracts. No product modification is proposed here.

Self-review checks exact source/clean binding, matched manifests, ten successful new text events and completed waits, paired identity/argv/cwd/session/PID equality, one/zero spawn counts, arithmetic and cleanup evidence. Scope maintenance/security review found only the permitted new Markdown file in Git; all instrumentation is external, synthetic and limited to owned fixtures. No dependency/install/script-product/CI/engineering-document change, build, install, release, remote CI, push, model-routing or key change. Broader weekly review remains with the parent. `git diff --check` and exact staged scope review apply to this report; product suites were not rerun. Independent parent review and integration remain pending.
