# Full gate installation prerequisite

The [Darwin arm64 fixture staging pilot](full-gate-bootstrap-staging.md) adds a
verified owned stand-in launch and a distinct incomplete bootstrap-stage receipt.
It leaves every production installation qualification boundary below blocked.

Status: **blocked**. This increment closes the guessed three-field receipt path;
it does not qualify an installation or enable the full gate. The production
policy has no target toolchain approvals, bootstrap approval, source hash approvals
or native lifecycle output approvals. Nothing observed on this host provisions
those approvals. No real installer, Corepack command, Electron downloader, native
hook, build, network request or Actions run was executed for this prerequisite.

The locked-install workflow block exits 1 using a Bash builtin, before starting
an installer or Node launcher. JavaScript environment sanitization cannot protect
Node's own startup against inherited NODE_OPTIONS or loader settings. There is no
approved absolute pre-JavaScript bootstrap here. The earlier setup/provenance
steps and the workflow as a whole remain unqualified; the blocked install step is
not a claim that every earlier runtime starts in a controlled environment. Do not
replace its failure with a Node policy check until that startup boundary is
reviewed. Action references, dispatch-only trigger, job count, verdict steps and
permissions are outside this increment.

`install-policy.ts` provides strict TypeScript contracts and runtime policy,
binding and environment checks. Targets must name exact Node distribution and
executable versions/digests, pnpm 10.33.0 executable/entry/archive/digests, and an
optional independently approved Corepack if one is ever used. Expected HTTPS
origins are restrictions, not proof of downloads or redirect history. Missing
approvals, version ranges, wrong target, absent digests and foreign archive origins
reject. The tracked policy remains empty at the approval boundaries. Even a caller
supplying plausible approvals and bootstrap/lifecycle success fields cannot enable
execution: qualification is deliberately unimplemented and throws. There is no
production install execution capability or environment override to enable it.

The public `requireInstallation` and `readInstallation` consumers reject legacy,
wrong-source/run/attempt/job/platform/architecture, failed/incomplete and synthetic
observations. Every main shard, static lane, electron lane and direct platform lane
calls the consumer before full source snapshots, dependency execution, preflight,
resource observation or creation of lane output. `record-install` now rejects
without replacing an existing receipt. The artifact verdict requires each lane's
installation observation; the production same-run loader additionally requires
installation qualification. `inspectSameRunEvidence` retains the existing
structural parser contract for diagnostics and focused regression tests. It cannot
qualify an install, and the production loader does not substitute it for the
installation check. Tests deliberately separate that structural contract from
production acceptance, preserving all prior parser/environment/path negatives.

`recordSyntheticCommand` runs only an owned synthetic MJS entry, via the existing
bounded POSIX supervisor. It is not an installer. It records the actual argv/cwd,
constructed environment, source input hashes before/after, entry hashes
before/after, policy hash, UTC interval, observed exit code/signal/timeout,
exit/stdio-close/group evidence, and hashes/byte sizes of the captured UTF-8 logs.
The shared supervisor now retains exit code/signal and bounded failure output in
its existing result/error evidence; its stop algorithm and budgets are unchanged.
Logs are decoded captures, not a raw binary transport history. Truncation and
unknown observations remain explicit. Node executable digest/version qualification
is unknown; launcher version is labeled separately. Fixture snapshots are hashes
of synthetic inputs, not clean Git/source installation evidence. No dependency
entries or lifecycle events are invented. Every recorder receipt has synthetic
true, frozen null, qualification complete false and explicit limitations.

Child environments are constructed from an empty object. They include fresh
HOME/USERPROFILE/XDG and temporary directories, fixed PATH, controlled npm
registry/TLS/optional-dependency settings and fixture-owned config/cache/store
roots. Caller secrets, command-file paths, NODE_OPTIONS, dynamic loaders,
Electron mirrors/cache/checksum overrides, ESBUILD_BINARY_PATH, proxies, CA
settings and registry configuration are not copied. These are construction
properties, not an exhaustive blacklist or OS sandbox/egress guarantee. Darwin
may inject __CF_USER_TEXT_ENCODING after spawn; the actual recorder output retains
it separately from the constructed environment. The fixture allows only that
known platform addition and does not qualify its value as an approval. Existing
workspace permission for electron/esbuild hooks remains unchanged. No
ignore-scripts flag or explicit lifecycle invocation is introduced. Electron
43.7.9's pristine hook status and native network history remain unknown; its
installed manifest does not authorize invoking install-electron. esbuild 0.28.1
and 0.28.2 invocation/output and optional-package/fallback download histories
remain unqualified. Windows environment tests use lexical synthetic paths,
fixed OS values, semicolon PATH, NUL and case-insensitive duplicate rejection.
They do not establish actual Windows containment or installation.

Independent review R1 found the receipt reader could block during O_RDONLY open
of a FIFO before descriptor validation. The reader now requires nonblocking and
no-follow support, opens with both flags, then checks the descriptor as before.
The real public-consumer regression uses a no-writer FIFO and an external
2-second watchdog. Before the fix it reached before-read and hung until killed
and reaped; after the fix it must emit a domain rejection and exit promptly with
the child reaped. Symlink, directory, regular legacy JSON, oversized and empty
controls remain. A startup failure cannot satisfy the before-read marker or
rejection checks. These real file probes are qualified only on the exercised
POSIX host; Windows stays blocked, and missing open capabilities fail closed.
This does not promise a wall-clock deadline for arbitrary kernel or remote
filesystem stalls. R1 evidence is retained under the existing evidence directory's
review-r1 subdirectory. Independent re-review is required.

Regression entry: `scripts/full-gate-install.node-test.mjs`. It uses actual
recorder children for zero/nonzero/timeout/spawn failure and exit before stdio
close, parent environment canaries, owned-root rejection, policy negatives,
receipt replay and every public lane's old-receipt rejection. Receipts may be
retained with FULL_GATE_INSTALL_EVIDENCE only by the test harness; this setting
is not forwarded to the children. The existing six F2 Node suites, eight size/docs
guards, deny-warning lint, tools/strict-runner TypeScript, pin verification and
diff checks are the final validation scope. Exact counts, source/dependency
hashes, argv/environment/time/logs and the retained initial failure are external
under `private/engineering-foundation-evidence/f2-install-receipt/`. Launcher
Node bytes were not read from the user's toolchain directory: its digest remains
unknown, never a production approval. Full resource/trust/reviewer/assets and the
77 unresolved declarations remain blocked. Independent review and controller
serial integration are required.
