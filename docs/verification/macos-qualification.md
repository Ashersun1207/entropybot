# macOS first: hosted arm64 qualification contract

This diagnostic implements the user's decision to finish macOS first and freeze
further verifier/framework expansion until actual isolated install, tools and
lifecycle evidence exists. Source implementation and local contract tests do
not establish that hosted CI ran. The controller must independently review the
candidate, integrate the separate common patch fixture fix serially, then push
the exact reviewed source to `codex/macos-qualification`. The first actual run's
SHA/tree and original artifact determine its result. Do not rewrite a supervised
HEAD, rerun secretly, or describe a unit pass as platform qualification.

The [official runner-images table](https://github.com/actions/runner-images/blob/main/README.md),
read 2026-11-11, lists `macos-15` as arm64 and `macos-15-intel` as x64. This job
uses the standard hosted `macos-15` label; no paid larger runner/custom VM is
needed. Before dependencies, it checks actual uname, Node platform/arch, exact
24.22.2 version, and records ImageOS/ImageVersion/runner.arch. The pinned approved
checkout/setup-node/upload-artifact action SHAs match the existing action source
review. Checkout does not persist credentials; repository permissions are read
only. Push is restricted to the exact branch and job ref; optional dispatch is
not needed for workflow registration. Attempts other than 1 fail explicitly.

Trust starts at the hosted runner, OS, action startup and standard public package
SRI. setup-node may use its hosted toolcache; its official Node archive expected
URL/hash and actual executable identity are separate fields. The executable
must equal the pristine catalog member, but archive bytes are not independently
observed by this entry. PGP remains unverified. This is not a claim that the first
JavaScript ran only after Node signature verification. The pristine candidate
catalog remains unapproved as a production root; its fixed bytes are used only
as diagnostic comparisons here.

[Runnable commands and phase details](../../scripts/macos-qualification/README.md)
use the existing installEnvironment, GateCommandRunner, verification server,
capabilities/durable history and POSIX audit. A short canonical owned
`/private/tmp/mq-*` HOME keeps macOS permission UNIX sockets below the path limit;
HOME/USERPROFILE/XDG/TMP/config/cache/store are synthetic. Evidence alone goes
under `$RUNNER_TEMP/mac-qualification`. No caller proxy, mirror, npm config,
NODE_OPTIONS, Electron override or repository/runtime token crosses into the
installer/test env. PATH contains only the selected Node directory and standard
OS directories. CI prepare retains its known exit. There is no Corepack enable,
shim/global install, ignore-scripts or locally downloaded binary execution.

pnpm is acquired only from its fixed official npm archive, bounded and checked
before entry execution, then prepared by the existing reviewed two-pass archive
reader. Real frozen install preserves public lock/SRI and optional native hooks.
Electron 43.7.9's package has no scripts field: install-electron is a bin mapping.
The explicit installer is therefore a distinct reviewed operation, conditional
on exact version and pristine manifest/install/checksums/get/extractor members.
It receives only the constructed environment plus an owned cache setting. The
actual cached ZIP must match `dcf13726bbf45646c968bb67f48d24ecfb941af1b3c01217f84edaf50fee632a`.
No mirror, remote checksums, override dist path, fallback or skip is supplied.
Its native extractor and transitive public dependency execution are inside this
host diagnostic trust boundary; there is no exhaustive transitive binary review
or independent reconstruction of redirect/network/cache history. Existing package
bytes are never patched to make provisioning succeed. Any inability to observe
provisioning/startup fails that phase while independent lifecycle checks continue.

The normal HTTP smoke starts the actual repository fixture with fake engines,
checks `/api/health` and doctor, completes a synthetic CLI job and requires a
nonempty reply. It then requires the actual server exit, stdio close, stop
receipt and removed owned data directory. Three fixed suites exercise real CLI
normal/nonzero/cancel/signal paths and expected failures/unknown controls; strict
JSON totals reject empty/no-op, missing files, failed assertions, skip/todo and
retry. Selection is intentional diagnostic coverage, not full F2 coverage.
Lease and POSIX reports retain their exact observed domain and blind spots;
`completeCleanup` stays false. Capability-bound command groups do not prove all
server generations, escaped descendants, sockets/files or unregistered spawners.
Source and dependency snapshots surround the actual checks; provisioning changes
are expected before the dependency comparison boundary. Original argv, constructed
envs, UTC, exit/close/group timestamps, bounded stdio, expected/observed tool hashes,
source SHA/tree/hash and manifest/workspace/lock hashes are retained. The upload
contains only bounded regular reports/logs; capabilities, caches and stores remain
outside it. Artifact action runtime credentials never reach test children.

This does not build or install Entropybot, a DMG/ZIP, or qualify an application
window, Apple signing/notarization, upgrade/migration or release acceptance.
Electron `--version` is minimal actual desktop tool startup. Full gate's 15 jobs,
five steps, consumer, trust/approval maps, resource blocking and all-platform
contract are unchanged. Linux/Windows are deferred; they are not prohibited and
no old skips or dispositions are removed. Final summary distinguishes diagnostic
pass/fail, missing capabilities and out of scope; it never grants installation
qualification or authoritative F2 acceptance.

Maintenance/security review of this scope covers fixed origins, extraction
reuse, source/hash comparisons, action pins, constructed env, token separation,
bounded execution and artifact handling. Public pnpm/Electron packages retain
their original licenses. No dependency, lock, production approval, application
code or ordinary CI workflow changes. Local validation and hosted execution must
be reported separately in the controller's source-bound handoff.
