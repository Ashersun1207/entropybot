# M1: complete spans in memory tidy

Bounded product reliability fix on baseline `5769d469603b0422e0b281aabc2fcbf33b481a44`, branch `codex/m1-tidy-spans`. Source only; no package build, installation, push or integration.

`server/memory-tidy.test.ts` runs actual `planTidy`/`applyTidy`, then the existing workspace prompt, SQLite index, file search and recall projections against synthetic data. The corrected baseline run has seven failing tests and one passing CRLF control: archived expired notes lose their indented continuation and closed code fence; orphan canaries remain in active text, model prompt and indexed/searchable content. Single-token `buildRecall` probes are already null on the baseline under its relevance gate; those controls do not establish a baseline recall leak. Both production `createMemoryUpkeep().tidy()` paths (core notebook and topic) reproduce archival truncation without a text engine.

The fix drops the parser's entire `[line, end)` span, archives the original header with its existing expiry annotation plus all continuation/fence content, and conservatively omits every multiline note from duplicate grouping. Even identical multiline bodies remain; deduplication still applies to single-line entries with the existing narrow identity/date policy. No parser, projection, journal or backup policy changes.

The targeted suite checks exact archived bytes and provenance, active raw text, prompt/index/search controls, same-day expiry, adjacent live and handwritten notes, distinct and identical continuation bodies, signed values, single-line duplicate selection, real core/topic upkeep persistence and a second no-op tidy. Archive remains searchable by existing policy; absence of expired canaries is claimed only for active projections, not general forgetting.

## Verification and evidence

Run from the assigned worktree using Node 24.22.2:

```sh
node node_modules/vitest/vitest.mjs run server/memory-tidy.test.ts server/memory-upkeep.test.ts server/memory-upkeep-writes.test.ts server/memory-upkeep-lifecycle.test.ts server/memory-entries.test.ts server/memory-prompt-projection.test.ts server/memory-expiry-retrieval.test.ts server/memory-topic-corrections.test.ts scripts/testing/file-size-ratchet.test.ts scripts/testing/verification-docs.test.ts
```

The targeted post-fix run passed all eight tests. Final related-suite counts and commit identity are in the source-bound handoff receipts; do not add overlapping targeted and related suite totals. Scoped lint covers the two changed TypeScript files; scoped typecheck extends the existing strict server configuration and includes those files and their transitive imports, without emitting artifacts.

The outer workspace evidence directory is `private/engineering-foundation-evidence/m1-tidy-spans/`. The runner records exact argv, UTC start/end, exit status and logs, with before/after HEAD/tree/status, source SHA-256 inventory, Node binary hash and dependency-tree inventory/hash. It uses the existing shared dependency symlink and default temporary root; Vitest setup creates a disposable HOME before importing server configuration. No dependency installation or external services.

The initial `red` log is retained, including fixture errors: treating `readMemoryTopic`'s string result as an object and assuming existing CRLF support. `red-fixture-corrected` removes those mistakes before production changes. The corrected run fails both production callers on actual archive truncation. The subsequent `green-targeted` run passes all eight tests on the fix.

## Maintenance, security and limits

Review of this bounded increment and its production callers found no new network, process, credential, permission, dependency, installation or arbitrary file deletion behavior. The change reuses the existing parser boundaries and archive-before-active-write order. Existing same-week concentrated maintenance is recorded in the engineering maintenance log; this review is scoped to the assigned change.

The parser does not recognize dated headers ending in CRLF; the control verifies those bytes stay untouched, not CRLF expiration. Malformed/unclosed fences and continuation ownership remain the existing parser's contract. Existing multiline contradiction prompts use first-line bodies, and inserting a supersession remainder can reassign continuation ownership; those require a separately scoped change and are not qualified by this fix. Existing single-line contradiction/remainder tests remain unchanged. Archive/history/journal/backup deletion, provider replicas, physical erasure, real models, user data, Keychain, UI, installed app, remote CI and cross-platform execution are unverified.
