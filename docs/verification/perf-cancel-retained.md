# B1 follow-up: active cancellation and retained-engine second turn

Measured 2026-11-09 on `codex/b1-cancel-retained`, source HEAD `bbd2d26b10b8f170f28f7a2817731df51ee08bce`, tree `56b91dae472edbd761823c30b0207d6c22c551f4`. Sole writer: B1 follow-up measurement agent. This is ordinary product research, with no quality-optimization ledger or skill trial. No product source or existing tests changed.

Active Stop reached the client's matching interrupted terminal event in **24.2 ms median (n=5)**. All five cancelled fake processes exited. In five separate fresh fixtures, the second completed turn used the **same fake PID** as the first and reached prompt receipt in **16.5 ms**, then its first published text delta in **50.1 ms**. These are Node source-server and synthetic fake observations, not packaged-app or real-model latency.

## Machine, isolation and execution

| Fact | Value |
|---|---|
| OS | macOS 27.2, build 26B123 |
| CPU / memory | Apple M2 Pro, 12 logical CPUs; 17,179,869,184 bytes RAM |
| Node | `/Users/sun/.nvm/versions/node/v24.22.2/bin/node`, v24.22.2 |
| Wrapper UTC | 2026-11-09 03:49:22.475763–03:50:15.850196; 53.374 s; exit 0 |
| Timed runner UTC | 03:49:37.937–03:49:59.056; 21.119 s |
| Wrapper load average before → after (1/5/15 min) | 8.878 / 9.809 / 8.736 → 6.671 / 9.125 / 8.534 |
| Runner load average start → end | 7.877 / 9.540 / 8.658 → 6.671 / 9.125 / 8.534 |
| Dependencies | Existing local verified dependency directory, linked as `node_modules`; no installation or dependency changes |
| Outer temporary path | `TMPDIR=/private/tmp`; each fixture's own tmp below its short `/private/tmp/entropybot-verify-data-*` directory |
| Fixture | Existing `launchVerificationServer`, synthetic HOME/config/data, sealed engine PATH, repository fake Claude |
| Happy configuration | Tools `[]`; replies `["B1TOKEN synthetic answer","B1TOKEN synthetic answer"]`; cadence `7:10` |
| Cancellation configuration | Same configuration except mode `hang`; no release or finish gate configured |

Only this agent's measurement jobs ran serially; unrelated host activity was not controlled. Load was material and differs from the previous B1 batch. Hashing all sources/dependencies before timing warms caches. This is not a cache-cold or isolated-host benchmark. No package build, install, dependency installation, real provider, real model, browser, user profile/data or Keychain operation was requested. The fixture is not an OS network sandbox; no packet capture was performed.

Packaged Electron startup, renderer/input readiness, and application memory/RSS were not measured in this follow-up and remain unqualified by these results.

## Supported fake modes and deterministic precondition

Read `server/testing/fake-claude-cli.ts`, particularly its environment contract, `playTurn`, `hang` branch, `slow` branch and stdin handler. Relevant existing capabilities are:

- `happy`: scripted replies and optional `chars:ms` stream cadence.
- `hang`: writes the atomic prompt dump and emits init/replay, then holds the reply pending indefinitely unless `FAKE_CLAUDE_RELEASE` or `FAKE_CLAUDE_FINISH_GATE` is supplied and its file exists.
- `slow`: normally finishes after 800 ms, or deterministically waits for `FAKE_CLAUDE_SLOW_FINISH_GATE`. An ungated delay is unsuitable as proof that cancellation wins a race.
- Scripted tool `hold` values also exist, but would measure tool activity rather than this ordinary chat path. Failure modes such as `exit-early`, `malformed`, authentication/API errors and stale sessions were not used.

No new fake mode or test-only product hook was necessary. Every cancellation run first observed its own prompt dump and `turn.started`, checked that the fake PID was alive and that no terminal event had arrived, and only then sent Stop. With `hang` and no gate, the turn cannot finish naturally during the process snapshot or HTTP call. There was no sleep-based cancellation race and no tool execution.

## Definitions and product path

The committed [measurement runner](../../scripts/measure-b1-followup.mjs) imports the existing control-omb fixture and command implementation. `send` uses `runControlOmb(['send', '--url', fixtureURL, '--bot', starterID, '--text', 'hello synthetic baseline'])`. The returned fixture URL is always explicit. The SSE observer is connected before send; bot lookup and observer setup are outside send latency.

- **Send origin:** entry to the in-process `runControlOmb` call, excluding a separate CLI startup.
- **Prompt receipt proxy:** first observation of changed atomic fake prompt-dump mtime, nominally polled every 2 ms. It proves execution of `playTurn` in the fake; it does not timestamp the host's stdin write. Scheduling, filesystem observation and polling add uncertainty, not a hard ±2 ms bound. Only projected PID and MCP names are retained; raw prompt dumps with capability material stay in disposable fixture data.
- **First text:** first client-observed SSE `kind:runtime / content.delta` containing `B1TOKEN`, matched to this turn ID. No historical message, bot projection or transcript completion is used as a token event. The fake cadence and driver batching are included; this is neither a tokenizer token nor renderer paint.
- **Active Stop origin:** immediately before `fetch` POST to `/api/bots/{ID}/interrupt`, JSON `{threadId, turnId}` captured from this turn's runtime event. This is the exact route/method/body used by `src/lib/stop-turn.ts` when the product knows the active turn. It excludes UI click handling/debouncing and renderer transport setup. No process signal or fixture shutdown substitutes for Stop.
- **Cancelled terminal:** client receipt of the same turn's `turn.completed`, `ok:false`, `stopReason:interrupted`. This establishes local cancellation of that turn. The following task-pinned `wait --timeout 15` must also report `status:settled`; its current job `state` is `idle`, not a turn cancellation enum.
- **Process outcome:** PID liveness check and `ps` snapshot after wait. Absence establishes the recorded fake PID has exited by that observation, not the exact process-exit instant. The separately reported observation interval includes wait, liveness check and synchronous `ps` overhead.
- **Retained second turn:** same server process, data directory, starter bot and thread immediately after the first successful terminal/reply and settled wait, with no restart or intervening Stop. Both prompt dumps must name the same fake PID. Each pair starts a fresh fixture; n=5 denotes five independent pairs, not five turns on one retained process.
- **Settled Stop/no-op:** after the second completed turn, in-process `runControlOmb(['interrupt', '--url', fixtureURL, '--bot', starterID, '--task', threadID])`. Its acknowledgement includes control command preparation, unlike the direct active Stop HTTP origin. Both reach the existing product interrupt route; their acknowledgement numbers should not be treated as identical instrumentation spans.

Timing uses monotonic `performance.now()` in the observing runner; UTC binds execution windows. All 15 turns have per-run event files and result projections. Each successful happy turn additionally requires its own `ok:true / end_turn` terminal and scripted reply in returned messages. `wait.state` is job status at this baseline and cannot substitute for these checks.

## Results

Milliseconds throughout; spread = max − min. No p95 or population confidence claim is made from five samples.

| Metric | n | Median | Min–max | Spread |
|---|---:|---:|---:|---:|
| Active Stop → matching interrupted terminal SSE | 5 | 24.2 | 23.3–30.8 | 7.5 |
| Active Stop → HTTP acknowledgement | 5 | 5.3 | 4.6–9.6 | 5.0 |
| Active Stop → settled wait plus completed PID/process observation | 5 | 65.1 | 60.1–80.1 | 20.0 |
| Fresh first turn: send → acknowledgement | 5 | 30.4 | 28.0–38.0 | 10.0 |
| Fresh first turn: send → fake prompt receipt | 5 | 174.7 | 169.9–262.6 | 92.8 |
| Fresh first turn: send → first text delta | 5 | 207.9 | 204.4–297.5 | 93.0 |
| Retained second turn: send → acknowledgement | 5 | 10.6 | 9.8–16.9 | 7.1 |
| Retained second turn: send → fake prompt receipt | 5 | 16.5 | 15.1–21.4 | 6.3 |
| Retained second turn: send → first text delta | 5 | 50.1 | 48.8–55.5 | 6.7 |
| Already replied Stop/no-op → control acknowledgement | 5 | 3.6 | 3.4–4.1 | 0.7 |

Cancellation runs 1–5 had terminal intervals 24.453, 24.164, 23.304, 30.781 and 23.659 ms. All five Stop responses were HTTP 200 `{ok:true}`; all five turns settled with the matching interrupted terminal and no content delta. At the post-wait observation all five server PIDs remained alive and all five fake PIDs were absent. Active Stop therefore did not retain these busy fake processes. Settled Stop/no-op retained the idle fake PID in all five happy fixtures.

| Pair | First prompt | First text | Second prompt | Second text | Fake PID, both turns |
|---|---:|---:|---:|---:|---:|
| 1 | 169.857 | 204.413 | 16.494 | 50.097 | 26105 |
| 2 | 174.703 | 207.928 | 17.063 | 50.593 | 26136 |
| 3 | 176.971 | 211.648 | 16.421 | 48.876 | 26166 |
| 4 | 172.676 | 206.262 | 15.146 | 48.813 | 26201 |
| 5 | 262.645 | 297.453 | 21.419 | 55.492 | 26283 |

The [previous B1 report](perf-baseline.md) documented first-turn medians of 172.5 ms to prompt receipt and 208.5 ms to text on source `6d84641d92b8f4a19e045da00e5dcbaa6257f689`, under a different load. Those are historical comparison values, not new samples. The freshly collected first-turn medians here are 174.7 and 207.9 ms. No subtraction of old or new medians is used to claim a causal saving.

The five observed second turns have shorter intervals than their paired first turns, while preserving the fake PID. This proves reuse occurred and a lower total local interval was observed in these fixtures. Source inspection of `server/drivers/claude.ts` shows the eligible idle-session path writes the next prompt to the existing process, bypassing fresh spawn. However, this measurement does not independently time process creation, host preparation, filesystem/cache warming, permission/MCP configuration, stdin delivery or driver/SSE scheduling. Turn order, prior history, identity reuse and caches covary. It cannot attribute the whole difference to spawn avoidance, estimate an optimization's speedup, or determine real-model/network latency. The fake receives MCP names `agents`, `phone`, `data`, `ogb`; it does not mount those real tools.

## Evidence and reproducibility

Private raw evidence root: `/Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/b1-followup/`.

```sh
python3 /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/b1-followup/batch.py
python3 /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/b1-followup/summarize.py
python3 /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/b1-followup/verify-events.py
python3 /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/b1-followup/resource-audit.py
```

The wrapper's exact child argv is `[NODE, '--experimental-strip-types', ROOT + '/scripts/measure-b1-followup.mjs']`, cwd the assigned worktree. Its explicit environment contains only `PATH=NODE_DIRECTORY:/usr/bin:/bin:/usr/sbin:/sbin`, synthetic `HOME=EVIDENCE_ROOT/synthetic-runner-home`, `TMPDIR=/private/tmp`, `LANG=en_US.UTF-8`, and `OMB_VERIFICATION_EVIDENCE_DIR=EVIDENCE_ROOT`. Child server argv and complete synthetic child environment are saved per fixture in `results.json`; actual server/fake argv, PPID and PGID are in per-turn process snapshots. Child PATH is the Node directory with `OMB_TEST_SEALED_PATH=1`; HOME, XDG, HERMES_HOME and data paths are synthetic. No caller provider environment is inherited.

`batch-before.json` was written before spawning the runner and `batch-after.json` after exit. Both bind HEAD/tree, dirty/untracked status, argv, environment, machine/load, UTC and 78,342 SHA-256 entries: all tracked files, traversed installed dependency files including symlink targets, runner, wrapper and Node binary. All entries match. Dirty status at measurement was only the README index addition and new measurement runner, both explicitly hashed. This report was written afterwards; its documentation commit is not the measured source HEAD. The hash snapshots do not detect an edit followed by restoration between snapshots, and are not an authoritative CI receipt. OS utilities and Python standard library are not separately hashed.

`results.json`, `summary.json`, `event-audit.json`, `resource-audit.json`, `batch-timing.json` and `batch.log` hold aggregate evidence. `hang{1..5}-first-{events,result}.json` and `happy{1..5}-{first,second}-{events,result}.json` hold all 15 turn observations. Persistent `server-*.log` retain lifecycle/server output. Raw fake dumps were not copied out of the fixture. Event audit verifies exactly one matching terminal per turn, interrupted reasons and absence of text for cancellation, and first matching text timing for completed turns.

Authoritative counts: **10 fresh programmatic fixture launches/closes; 15 sends; 15 task-pinned waits; 5 active turn-scoped HTTP Stops; 5 settled control-omb interrupts; 5 interrupted terminals; 10 successful terminals; 5 same-PID pairs.** All 10 fixture directories were removed and no recorded server/fake PID remained after close. Final audit including unsuccessful attempts found **34 recorded owned PIDs and 17 fixture directories**, all absent at 03:50:42.269 UTC. These cover the observed normal fixture server/CLI process domain, including the fake's separate PGID; they do not prove absence of arbitrary unobserved/reparented descendants. Exact process-exit latency was not measured.

## Preserved unsuccessful attempts and review

Three unsuccessful executions are excluded from every authoritative table:

1. `failed-import-*`: 03:44:36.301888–03:44:40.261178 UTC, exit 1. Missing worktree `node_modules` caused `ERR_MODULE_NOT_FOUND` for `mdast-util-from-markdown` during import, before fixture creation. Fixed by linking the same existing dependency directory used by B1; no install or source repair. Before/after hashes matched (7,157 entries, no dependencies present).
2. `failed-wait-projection/`: 03:45:15.745186–03:46:08.192862, exit 1. One genuine held turn cancelled, but the probe incorrectly required `wait.state=cancelled`. It actually returned settled/idle with an interrupted terminal. The fixture was cleaned. This batch also has a README index hash difference because the documentation index was edited during execution; it is excluded, not rebound or hidden.
3. `failed-happy-job-state/`: 03:47:04.505042–03:47:57.221509, exit 1. Five held cancellations and one successful happy turn occurred; the probe still incorrectly required happy `wait.state=completed`. The new job projection returned idle despite the successful same-turn terminal and scripted text. All six fixtures were cleaned; 78,342 before/after hashes matched. Reading `scripts/mcp-server.ts` confirmed `state` is job state, while `status` describes settlement. Final runner asserts the actual matching runtime terminal/reply and task-pinned settled wait. No product behavior or existing assertion was changed.

These attempts add seven fixtures, seven sends/waits and six active Stops outside the authoritative batch. Their logs, manifests, per-turn projections and events remain. Failed runner versions were reconstructed afterwards and SHA-256 checked against each original pre-execution manifest using `reconstruct-failed-runners.py`; filenames explicitly mark them reconstructed, not original archived copies. The final runner and event audit provide the regression entry for these measurement-protocol mistakes. The final complete batch was rerun after freezing the runner and index.

Scope/maintenance/security review: additions are the measurement runner and report, plus the required one-line verification index link. Process launch/cleanup uses the existing fixture lifecycle; Stop uses the product route; data is synthetic; no external URL or credential is configured. Independent 15 s observation/request bounds and the wrapper's 180 s budget with TERM/20 s grace then root KILL prevent an unbounded happy-path measurement wait; the emergency root-KILL fallback alone is not a descendant cleanup guarantee. No product optimization, dependency/source/test alteration, package build/install, push, publication or integration occurred. Arithmetic, event provenance, resource audit, runner `node --check` and `git diff --check` passed. The existing documentation guard passed 1 file / 7 tests (`docs-check.log`); broad product tests are not claimed. Parent review and serial integration remain separate.
