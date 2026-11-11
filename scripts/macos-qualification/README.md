# macOS arm64 diagnostic qualification

Controller entry after independent review: push the reviewed exact commit to
`refs/heads/codex/macos-qualification`. The push workflow is carried on that
branch; no default-branch workflow registration or main merge is needed.
Attempt 1 only, one serial 360 minute `macos-15` job, no retries. Actions startup and the
hosted OS/toolcache are trusted for this diagnostic. See the
[contract and limits](../../docs/verification/macos-qualification.md).

The workflow runs this exact entry after pinned setup-node 24.22.2:

```sh
/usr/bin/env -i PATH="$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin" HOME="$RUNNER_TEMP" \
  "$NODE" scripts/macos-qualification/run.mjs \
  "$RUNNER_TEMP/mac-qualification" "$GITHUB_SHA" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"
```

Do not run that entry on a developer Mac. It performs a real dependency install
and provisions and starts official Electron. The local author checks use only
existing tools and synthetic child processes:

```sh
node --test scripts/macos-qualification/contract.unit.mjs scripts/macos-qualification/application.unit.mjs
```

The explicit `.unit.mjs` entry is outside ordinary Vitest discovery. It validates
workflow mutations, architecture, environment, strict report interpretation and
the real public recorder's normal/failed/cancelled local fixture children. It
does not download or execute Node, pnpm or Electron distributions.

The hosted entry executes:

1. Actual uname/Node architecture and exact version, clean source identity and
   pristine Node executable hash (archive transport remains action evidence).
2. Fixed-origin capped pnpm archive download, SHA-256/SRI and bounded two-pass
   extraction using the existing preparer; exact bin/dist hashes and version.
3. `node <owned-pnpm>/bin/pnpm.cjs install --frozen-lockfile --store-dir <owned-store>`.
   Optional/native hooks remain enabled, CI prepare exits as already designed.
4. Pristine source/hash checks of Electron, get and native extractor, followed
   by `node <locked-electron>/install.js` with owned `electron_config_cache`.
   It requires a fresh dist, the actual cached darwin-arm64 ZIP hash, extracted
   version and real executable identity. Official Electron is started with
   `--user-data-dir=<owned-profile> --use-mock-keychain --version`.
5. Actual repository verification server health, doctor, normal synthetic job
   completion/reply and acknowledged exit/stdio close via `http-smoke.mjs`.
6. Full fixed files `patch-gate-process.test.ts`, `verification-lifecycle.test.ts`
   and `verification-process-scope.test.ts`, through original Vite setup and
   existing strict runner, no retry/skip/todo or empty report accepted. They
   exercise actual fake CLI exits, deliberate failures, aborts/signals,
   descendant reclamation and unknown cleanup controls.
7. All ten main Vitest shards using the original strict adapter/command builder,
   every tracked Node test with structured/TAP reconciliation, and all seven
   original static commands. Each group retains its own source-bound audit and
   exact skip dispositions; unknown skips, failures and todos block. Final shard
   coverage is exact. Class-B assets remain unprovisioned and skips remain skips.
8. Existing authenticated leases, source/dependency inventories and the existing
   independent POSIX audit. The observed domain can be clear while overall
   containment remains incomplete.

Each independent phase records its failure and later valid phases continue.
Summary exit is nonzero for any failure. If dependency installation fails,
dependency-dependent checks cannot run; the failed phase and missing later
outputs remain visible. Reports are flat regular owned files, capped at 16 MiB
each/128 MiB aggregate, with symlinks, special files and capability secrets
quarantined outside the upload root. No store, cache, HOME, lease capability or
application data is uploaded. Upload has its Actions runtime token in the
trusted action process; installers and test children receive constructed envs
without repository/runtime tokens. A job killed by GitHub may lack final reports;
`always()` uploads whatever bounded original reports were already produced.
