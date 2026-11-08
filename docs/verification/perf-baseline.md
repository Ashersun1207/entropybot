# B1 local source-server performance baseline

Measured on 2026-11-08 against `6d84641d92b8f4a19e045da00e5dcbaa6257f689`, tree `9898f9ebadca42b3eb9dda7e17b67fa002877061`, branch `codex/engineering-perf-baseline`. Sole writer: B1 measurement agent. No product source, dependency, test or engineering-document changes. Only this report is committed; runners and raw evidence remain outside the repository.

On this machine the complete source CLI fixture launch took **1.787 s median**; a first scripted turn reached the fake engine in **172.5 ms**, and its first published text delta in **208.5 ms**. The settled server and retained fake-engine child occupied **318.50–318.52 MiB summed RSS**. These are local source-server observations, not packaged Electron or real-model measurements.

## Machine and conditions

| Fact | Observed value |
|---|---|
| macOS | 27.2, build 26B123 |
| CPU | Apple M2 Pro, 12 logical CPUs |
| RAM | 17,179,869,184 bytes (16 GiB) |
| Authoritative Node | `/Users/sun/.nvm/versions/node/v24.22.2/bin/node`, v24.22.2 |
| Main batch load average, start → end (1/5/15 min) | 4.878 / 4.995 / 4.597 → 6.281 / 5.360 / 4.754 |
| CLI batch load average, start → end | 5.836 / 5.309 / 4.746 → 5.534 / 5.272 / 4.746 |
| Dependencies | Existing verified `node_modules` symlink; no installation |
| Fixture | Disposable HOME/config/data; sealed engine PATH; repository fake Claude only |
| Fake configuration | `happy`, no tools (`[]`), reply `B1TOKEN synthetic answer`, streaming cadence `7:10` |

The shell initially selected Node v22.22.0. That complete preliminary batch is retained at the evidence root but **excluded from every result below**, because the project requires Node 24+. No product failure was encountered. Both authoritative batches explicitly selected the already-installed Node 24; no dependencies were added. Other machine activity was not controlled, and load averages were material. Hashing sources/dependencies before each batch also warms filesystem caches.

## Definitions and measurement boundaries

- **Cold fixture / fresh profile:** a new server process and new empty temporary data directory. This is not a reboot, disk-cache flush, or true OS-cache-cold measurement.
- **Full CLI ready:** wall time from spawning `node --experimental-strip-types scripts/control-omb.ts launch` until its complete printed JSON has `ok: true`. The existing launcher has received `/api/health` with `app: entropybot`, checked exactly one starter bot, and successfully renamed it to `Fixture Starter`. This includes Node startup, launcher imports, fixture creation and readiness polling. It means the headless fixture is ready to accept a turn; it is not renderer input readiness.
- **Programmatic fresh ready:** `launchVerificationServer()` call to return; the runner prints its returned info. Same launcher and readiness checks, excluding initial runner/launcher imports. Do not subtract medians to infer import cost: these were separate batches.
- **Warm restart ready:** `session.restart()` call to return using the same data/config/port, after an existing completed turn. Includes stopping the prior server and its engine, spawning the replacement and waiting for health. Restart does not repeat starter validation/rename. It is a restart wall time, not pure spawn time or a retained engine's second-turn measurement.
- **Send origin:** entry to in-process `runControlOmb(['send', ...])`, after selecting the starter and opening the SSE observer. This includes the normal headless command's local/API preparation, but excludes CLI process boot, observer connection and bot-list lookup. Ready-to-send automation setup was not separately timed.
- **Dispatch proxy:** first observation of the fake engine's atomic prompt-dump mtime change, polled every 2 ms. It proves receipt of the prompt in `playTurn`, not the exact host write instant. Parsing/spawn/IPC work before that observation is included in local preparation. Polling and scheduling add uncertainty; 2 ms is a nominal interval, not a hard error bound.
- **First scripted token:** first client-observed SSE frame containing the answer marker. All 10 authoritative first matches were `kind: runtime`, `event.type: content.delta`, carrying the synthetic answer. Driver batching coalesced the fake's chunks; this is first published assistant text, not a model tokenizer token or renderer paint. Recorded events substantiate that no historical answer was mistaken for the first delta.
- Health polling is nominally 150 ms, so startup precision is limited by polling/scheduling despite finer clock resolution. Timing uses monotonic `performance.now()`; UTC records bind execution windows.

## Results

All latency values are milliseconds. Spread is max minus min. Each turn had to reach `wait.status = settled`, `state = completed`, and contain the scripted reply; all 10 authoritative turns did so.

| Metric | n | Median | Min–max | Spread | Notes |
|---|---:|---:|---:|---:|---|
| Full CLI fresh-profile launch → printed ready | 5 | 1787.3 | 1778.2–2305.9 | 527.7 | Includes launcher process boot |
| Programmatic fresh-profile launch → ready | 5 | 1464.8 | 1463.0–1782.5 | 319.6 | Excludes initial runner imports |
| Same-profile warm restart → health ready | 5 | 1185.4 | 1184.2–1191.3 | 7.1 | Includes prior process stop |
| Fresh server: send → send acknowledgement | 5 | 28.1 | 27.3–36.7 | 9.4 | Acceptance, not engine dispatch |
| Fresh server: send → fake prompt receipt | 5 | 172.5 | 170.5–196.5 | 26.0 | Local preparation + fake process startup/receipt |
| Fresh server: send → first text delta | 5 | 208.5 | 205.3–231.0 | 25.7 | Scripted fake output |
| Fresh server: prompt receipt → first text delta | 5 | 34.8 | 34.1–36.2 | 2.1 | Fake execution + host batching/SSE, inseparable |
| Restarted server: send → acknowledgement | 5 | 19.1 | 18.9–19.6 | 0.7 | Same synthetic conversation |
| Restarted server: send → fake prompt receipt | 5 | 176.9 | 167.5–200.6 | 33.1 | Fake engine newly spawned after restart |
| Restarted server: send → first text delta | 5 | 210.4 | 201.9–233.7 | 31.8 | Same script, no real model |
| Restarted server: prompt receipt → first text delta | 5 | 34.4 | 33.1–36.0 | 2.9 | No separate model-latency attribution |
| Settled-turn Stop/no-op → acknowledgement | 5 | 4.9 | 4.2–5.5 | 1.3 | Both owned processes sleeping in following snapshot |
| Fixture close → lifecycle completion | 5 | 47.8 | 46.3–48.6 | 2.3 | Existing owned-resource shutdown and directory removal |
| Fixture close → observed owned PIDs absent | 5 | 80.7 | 78.4–82.8 | 4.4 | Includes post-close `ps` observation overhead; upper bound |
| Full CLI SIGINT → launcher close | 5 | 53.3 | 50.6–56.4 | 5.8 | All launcher exits code 0 |

The no-op keeps the idle engine available; it does not promise process exit. No exact transition-to-sleep timestamp was captured. The subsequent states establish no runnable owned child at that observation, while the independently timed close establishes observed exit. Active in-flight cancellation latency was not measured.

## Idle process tree and cleanup

After the first completed turn, wait 10 seconds, then take three process snapshots at 08:38:59.541, 08:39:04.591 and 08:39:09.633 UTC (about 5 seconds apart). These are repeated samples of one fixture, not three independent cold launches. `ps %cpu` is the OS-reported decaying/lifetime estimate, not a dedicated interval CPU counter. Zero is the displayed precision, not proof of zero instructions.

| Process / ownership | n | RSS median MiB | RSS min–max MiB | Spread MiB | CPU median / min–max | State |
|---|---:|---:|---:|---:|---|---|
| Source server PID 27089, PPID 27087 | 3 | 254.016 | 254.016–254.031 | 0.016 | 0.0% / 0.0–0.0% | `S` |
| Fake engine PID 27116, PPID 27089, PGID 27116 | 3 | 64.484 | 64.484–64.484 | 0.000 | 0.0% / 0.0–0.0% | `Ss` |
| Sum of server subtree RSS | 3 | 318.500 | 318.500–318.516 | 0.016 | Both displayed 0.0% | 2 Node processes |

No additional server descendants appeared in these settled samples. The external Node measurement runner (PID 27087), Python provenance wrapper, shell, and unrelated machine processes are excluded. Summed RSS can count shared pages more than once and is neither unique physical memory nor file/install size. Electron main/renderer/GPU/browser processes were not launched or estimated; packaged-app RSS and startup remain unknown.

Each run records PID/PPID/PGID/command snapshots before no-op, after no-op, before restart, after restart and before close. All five post-close snapshots found none of the recorded old-server/old-engine/final-server/final-engine PIDs remaining; all five fixture directories were removed by the existing lifecycle. The fake engine's independent PGID is visible, so this does not rely only on the outer process group disappearing. The lifecycle additionally checks its registered resource shutdown before deleting the directory. A final untimed resource audit across all batches found none of 60 recorded owned PIDs and none of 15 fixture directories remaining (`final-owned-resource-audit.json`). These establish the observed normal fixture process domain, not arbitrary unobserved/reparented descendants or failure-path cleanup.

## Tool initialization and the next candidate

The fake engine received MCP configuration names `agents`, `phone`, `data`, `ogb` on all measured turns. This demonstrates configuration assembly, not actual MCP subprocess connections or native capability initialization: the fake does not mount real tools. No browser binary/desktop/provider was supplied. There is no independent timing span for mount initialization in the existing observed logs; **tool/mount cost and mounted-vs-unmounted difference are not observable in this baseline**. No toggle comparison was fabricated.

**Rank 1 next candidate: reduce local preparation before prompt delivery on the ordinary-chat path (C1), testing reuse only within the same bot/engine/permission/workspace identity.** The measured first-turn preparation is 172.5 ms median, while the post-receipt fake/event portion is 34.8 ms. Restarted profiles still spend 176.9 ms before prompt receipt, so merely retaining files did not remove this interval. This identifies a measured interval for investigation, not a proven redundant operation, cache hit rate, or promised speedup. Stage attribution and a retained-process second turn are still needed before selecting a concrete implementation. Full source startup is larger in absolute time, but its applicability to the packaged app is unproven; these results do not justify a desktop-shell replacement or a specific MCP deferral.

## Provenance, commands and timing

Evidence root: `/Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/b1/` (private, not committed).

| Batch | Evidence directory | Wrapper UTC start–end | Wall s | Timed runner UTC start–end | Runner s | Exit |
|---|---|---|---:|---|---:|---:|
| Preliminary, Node 22; excluded | root | 08:36:35.372–08:37:49.101 | 73.728 | 08:36:52.982–08:37:34.432 | 41.450 | 0 |
| Authoritative main, Node 24 | `node24/` | 08:38:32.714–08:39:40.839 | 68.125 | 08:38:47.304–08:39:26.560 | 39.256 | 0 |
| Authoritative CLI, Node 24 | `node24-cli/` | 08:39:40.909–08:40:20.353 | 39.443 | 08:39:55.060–08:40:04.932 | 9.872 | 0 |

All times are 2026-11-08 UTC. Instrumented execution window: **08:36:35.372–08:40:20.353 (224.981 s elapsed including the inter-batch diagnosis gap)**. Reading/preparing before that window and report writing afterwards were not separately timed. Model/agent waiting time is unknown. Main Node 24 subphase sums: fresh starts 7.640 s; warm restarts 5.933 s; no-op acknowledgements 0.024 s; close calls 0.238 s (post-close observations inclusive 0.403 s). Idle settling/sampling intentionally occupied about 20 s. Runner remainder includes synthetic turns, observer setup, API reads, snapshots and JSON output. Wrapper overhead includes before/after hashing; it is outside reported latency intervals.

For each batch, `batch-before.json` was fully written **before launching the timed runner**; `batch-after.json` was written after runner exit. Each contains HEAD, committed tree SHA, clean dirty/untracked state, exact top-level argv, cwd, secret-free explicit environment, UTC boundaries, exit status (null before execution), log path, machine facts and **77,835 SHA-256 entries**. Coverage is a superset of repository source imports: all tracked files, traversed dependency files including symlink targets, the external runner/wrapper and selected Node binary. Every before/after hash map matched exactly. Built-in Node code is bound by the Node binary; system utilities/Python standard library are not separately inventoried. No earlier measurement was retro-hashed or rebound to a later commit. The report commit changes documentation only and is not the measured HEAD.

Commands executed (from the specified worktree):

```sh
python3 /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/b1/batch.py
python3 /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/b1/node24/batch.py
python3 /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/b1/node24-cli/batch.py
python3 /Users/sun/Desktop/Codex/gorkbot/private/engineering-foundation-evidence/b1/summarize.py
```

The two Node 24 wrappers ran serially in one background shell. Each wrapper launches `[NODE, --experimental-strip-types, EVIDENCE_DIR/runner.mjs]` with only explicit PATH, short `TMPDIR=/tmp`, evidence directory and LANG. Short temp paths follow L17; fixture logs go directly to evidence and real data/config/Keychain are not used. The lifecycle supplies its existing verification preload. Random fixture paths, child environment and argv template are in main `results.json`; process snapshots contain actual server/fake argv. The CLI runner executes `[NODE, --experimental-strip-types, scripts/control-omb.ts, launch]`, reads the existing printed JSON and sends SIGINT to that exact launcher PID.

Authoritative counts: 5 programmatic fresh launches, 5 same-profile restarts, 10 `send`, 10 `wait`, 5 idle `interrupt`, 5 lifecycle closes, 5 separate full CLI launches/SIGINT closes, and 3 settled idle samples. The preliminary batch repeats only the main sequence under Node 22 and is retained separately. There were no failed-command retries. Each turn uses `send --url FIXTURE --bot STARTER_ID --text 'hello synthetic baseline'`, then `wait --url FIXTURE --bot STARTER_ID --timeout 20`; Stop uses `interrupt --url FIXTURE --bot STARTER_ID`, through `runControlOmb` in process. All targets are the returned fixture URL and starter ID.

Key evidence: per-batch `batch-before.json`, `batch-after.json`, `batch.log`, `batch-timing.json`, `runner.mjs`, `batch.py`; main `results.json` and ten `runN-{cold,warm}-events.json`; CLI `cli-results.json`; persistent `server-*.log`; root `summary.json` and `summarize.py`. Raw fake prompt dumps/configuration with runtime capability material were not copied out of disposable fixture directories; only MCP server names were retained in result projections. Synthetic usage/cost fields in raw wait results are fake protocol constants, not incurred cost or real model performance.

## Limits and review

Unresolved: true cache-cold start; same-runtime retained-engine second turns; renderer/Electron readiness and memory; ready-to-send observer/setup time; stage-specific preparation/MCP attribution; active cancellation, tools and browser initialization; real-model network/first-token latency and monetary cost. No packaged-app estimate was inferred. The sealed fixture and fake configuration are not an OS network sandbox, and no packet capture was performed; no external services or credentials were configured or real provider calls requested. All scripted requests went to the owned loopback fixture.

Scope/security review: only this Markdown report changed in Git; runners use repository fixture lifecycle ownership, isolated synthetic input and short temporary paths. No new dependency, product optimization, installer/package build, live data/config/Keychain access, push, integration, CI or publication. Report verification checks arithmetic/event provenance, matched before/after hashes, successful turn completion, recorded process shutdown and `git diff --check`; no product test suite was rerun for a documentation-only change. Parent review/integration remains separate.
