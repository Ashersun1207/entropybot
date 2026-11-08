# Expired multiline retrieval projection (M1b)

Baseline: `50fe2e363f25885c3a205997c2c0b917bd13a80f`, branch `codex/engineering-memory-expiry`, controller-assigned worktree `/Users/sun/Desktop/Codex/gorkbot/.worktrees/engineering-memory-expiry`. Sole writer: M1b. Product scope: `server/memory-entries.ts` only. Independent acceptance and serial integration belong to the controller.

`withoutExpired` removed only dated header lines; expired indented continuations and closed fenced blocks survived as ordinary text. It now drops each expired entry's existing parsed `[line, end)` span. `hidden` still counts entries, not lines. Same-day expiry remains inclusive; undated handwriting, adjacent live entries and struck-entry handling retain their existing semantics. No parser grammar, workspace, recall, storage or embedding implementation changed.

## Reproduction and acceptance

Before the product fix, the isolated red run executed 21 tests: 17 passed and four new regressions failed. The log demonstrates retained continuation/fence text in the helper output, actual SQLite indexed document, `buildRecall` alias result and captured fake embedding request. These were assertion failures against real synthetic file/index operations, not startup errors. Evidence: `private/engineering-foundation-evidence/m1b/red.log` and `red.json` in the controller repository.

The regressions reuse Vitest, `server/testing/setup.ts`'s disposable per-file HOME and the existing workspace/SQLite/recall/embedding entry points. The outer runner also starts with an isolated HOME and a sealed environment (no inherited provider credentials or account configuration). Embedding `fetch` is replaced with a synthetic local response; no service is contacted.

- [Entry regressions](../../server/memory-entries.test.ts) check complete spans with indented and unindented closed fences, two-expired-entry count semantics, same-day/future/no-expiry controls, handwriting and adjacent struck content.
- [Retrieval regressions](../../server/memory-expiry-retrieval.test.ts) check actual `syncMemoryIndex`, indexed documents, file search, lexical `buildRecall` and named-topic alias recall with `threadIds: []`. The alias-only query uses `flightdecks` against the `flightdeck` alias and explicitly proves file search has no match, exercising the topic passage path independently of FTS. Live results retain the file/source label.
- The fake provider receives actual embedding request inputs: expired continuation/fence canaries are absent and live/handwritten controls remain. A pending provider response crosses midnight while the Markdown bytes and mtime stay unchanged. Date-driven index refresh removes the newly expired entry and its continuation, rejects the in-flight stale vector, then rebuilds a vector matching the current source hash. Existing endpoint/model/dimension and source-change stale-vector regressions remain required.
- Existing prompt/capture projection regressions and the fake-engine memory-layer workflow cover their separate boundaries. No new prompt-delivery guarantee follows solely from the retrieval fixtures.

## Verification record

All commands ran in this worktree with Node `v24.22.2`, using the authorized symlink to the existing verified node_modules; no install was performed. Full suite and the six F1 groups were not run. Runner: `private/engineering-foundation-evidence/m1b/run.py`; each JSON receipt contains the exact argv, cwd, UTC start/end, duration, exit and absolute log path.

| Evidence stem | Command (after `node node_modules/`) | Result | Measured wall time |
|---|---|---|---|
| `red` | `vitest/vitest.mjs run server/memory-entries.test.ts server/memory-expiry-retrieval.test.ts` | exit 1; 4 failed / 17 passed, before product fix | 1.757s |
| `targeted` | `vitest/vitest.mjs run server/memory-entries.test.ts server/memory-expiry-retrieval.test.ts server/memory-embedding-index.test.ts server/memory-prompt-projection.test.ts server/memory-topic-corrections.test.ts server/recall.test.ts server/recall-accent.test.ts server/message-recall-index.test.ts server/message-recall-evidence.test.ts server/memory-capture-calls.test.ts server/memory-upkeep.test.ts scripts/testing/file-size-ratchet.test.ts server/memory-layer.e2e.test.ts` | exit 1; 132 passed across 12 files, workflow failed before memory checks (environment, below) | 30.419s |
| `workflow-default-temp` | `vitest/vitest.mjs run server/memory-layer.e2e.test.ts` | exit 0; 1 test passed | 16.636s |
| `typecheck` | `typescript/bin/tsc -p tsconfig.server.json` | exit 0 | 29.169s |
| `lint` | `oxlint/bin/oxlint --deny-warnings server/memory-entries.ts server/memory-entries.test.ts server/memory-expiry-retrieval.test.ts` | exit 0; 0 warnings/errors | 0.122s |

Final coverage across the targeted run plus the corrected workflow run: **13 unique files / 133 tests passed**, zero skips/todos reported. This is combined evidence, not a claim that the original targeted command exited successfully. `git diff --check` passed after documentation whitespace cleanup.

The first workflow failure reproduced L17: the evidence runner set a deep explicit TMPDIR, yielding a permission broker Unix-socket path too long for macOS (`listen EINVAL`). It failed at the scheduled routine assertion before reaching memory checks. `targeted-server.log` preserves the server error. Removing that runner-only override restored Node's default short temp root; the unchanged workflow then passed. `workflow-default-temp-server.log` preserves its server output. No product rework or lowered assertion was used. The outer environment remains sealed and HOME isolated; the shared test setup creates disposable per-file homes and the workflow launches its own fake-engine verification server. Only that failed workflow was rerun; the 132 passing tests and successful static checks were not repeated.

## Scope and self-review

The fix is an in-memory retrieval projection; original Markdown remains byte-for-byte readable and is not rewritten by filtering. It does not erase facts from history, summaries, journal, backups, prior provider copies or physical SQLite pages. Archive/log retrieval rules are unchanged. Parser treatment of unclosed fences remains unchanged and is outside this closed-span repair.

Maintenance/security review traced both helper callers (`searchableMemoryText` and `topicPassages`) and the indexed-text-to-embedding flow. The small fix reuses parsed spans and the same line-set pattern as existing superseded filtering, without a second parser or new framework. No new dependency, network operation, process, credential access, permission, migration or file deletion enters product code. Test deletions target only setup-owned synthetic data. No real app/user chat/config/memory/Keychain, model accounts, package build, installation, push or publication was used. OS-level network isolation and real-model quality are not established by fake providers.

## Timing

First recorded checkpoint: `2026-11-08T08:20:24Z`, after initial instruction/source reads (initial start unknown). Per-command UTC start/end, exit, duration and log paths are in `private/engineering-foundation-evidence/m1b/*.json`. Pure implementation, verification effort, rework effort and model wait are unknown unless separately measured; command wall time is not model wait or active effort. One bounded product fix was made; independent review remains pending. Implementation/verification/self-review closeout checkpoint: `2026-11-08T08:24:43Z` (4m19s since the first recorded checkpoint, including tool/model latency and documentation; initial reads and final commit overhead excluded). Separate implementation/verification/rework effort and model wait remain unknown. The verification-environment correction is recorded above.
