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

## First hosted result and resource repair

Actual hosted run `43035952201`, attempt 1, executed source
`0ded53240d49376831017a066e37e92425605674` on macOS 15 arm64. Real frozen install,
pnpm startup, Electron provisioning/cache ZIP/startup, normal HTTP job, all 55
lifecycle tests, leases, dependency/source comparisons and artifact handling
passed. The job failed only because the POSIX audit rejected one of ten registry
records. It observed no residual processes; that does not establish complete
cleanup or authorize ignoring the rejected record. The original artifact remains
immutable (API artifact 13862159812, ZIP SHA-256
`5bcfa37e803f8b1176202bd2471a919c0de67a5b779f950fa80c6eac561172b8`).

A source-bound local reproduction of the same HTTP/lifecycle/audit path on 0ded
reproduced the rejection. Its authenticated inner verification-scope record had
null child and owner start times and terminal unknown. The sealed server PATH
contains only the Node directory. Darwin inventory resolved `ps` through that
PATH, so it could not spawn the OS reader. A live-child public API regression
also reproduced ENOENT and both null identities, without any short-lived-process
race. Darwin inventory now uses `/bin/ps` directly, retaining the sealed PATH.
No identity requirement, terminal unknown, MAC/source binding or stale zero-probe
rule is relaxed. Other platforms retain their existing implementation. The
original hosted rejected frame was not retained; its exact contents cannot be
retrospectively recovered from the local reproduction.

Audit snapshots now retain `registryFailures`: fixed stage/error codes, file
hash, and an authenticated identity projection with explicitly bounded allowed
fields, including missing start/owner field names. Invalid/untrusted payloads
and arbitrary error text are excluded; history enumeration errors retain only a
fixed code. No capability key, whole frame, config/cache/store or arbitrary
payload fields are uploaded. Rejected registries still make the audit unknown.
Existing artifact size, regular-file and capability-secret checks still apply.
This repair requires independent review and a new source-bound hosted attempt 1;
the original failed run is not rerun or relabeled as success.

Maintenance/security review of this scope covers fixed origins, extraction
reuse, source/hash comparisons, action pins, constructed env, token separation,
bounded execution and artifact handling. Public pnpm/Electron packages retain
their original licenses. No dependency, lock, production approval, application
code or ordinary CI workflow changes. Local validation and hosted execution must
be reported separately in the controller's source-bound handoff.

## Application-suite candidate (2026-11-12)

The controller reports attempt-1 hosted run `43041542924` successful on baseline
`4ac9a0c0f31c069e14fabc03a7d2b4de51a73ef7`: frozen installation, pristine Electron
provision/start, real fake-engine HTTP operation, 55 lifecycle assertions and a
clear observed resource domain. That run qualifies the bounded install/tool path;
it supplies no full application-suite result.

This candidate extends the existing qualification branch workflow rather than
registering another workflow or adapting full-gate provenance. After independent
review the controller must push a NEW exact reviewed SHA to
`codex/macos-qualification` and collect its attempt-1 original artifact. No CI is
launched by author validation. The single serial job now has a 360-minute bound;
GitHub cancellation can still leave incomplete reports, which never qualify.
The formal full-gate dispatch workflow, trust/policy/reviewer/assets and main are
unchanged. Diagnostic dispositions are deliberately a separate contract from
formal signed same-run disposition acceptance.

After the same frozen install and explicit pristine Electron path, the entry runs
all ten main shards through the unchanged main adapter and public Vitest command
builder. It retains the original sequencer, discovery, includes, setup, strict
runner, two workers and shard values 1/10 through 10/10. It sets no subset, name,
retry, host-only or passWithNoTests flag. The union of shard report files must
exactly equal discovery without duplicate files. It runs every tracked
`.node-test.mjs` entry via the existing Node structured reporter and independently
checks TAP totals, event identities and exact file coverage. Seven static commands
remain the full-gate commands: diff checking, deny-warning oxlint, tools TypeScript,
TypeScript build mode (noEmit application configuration), server TypeScript,
release identity check, and the original patch verification CLI. No Vite app build,
packaging, signing or local application installation is added. Broker and
control-plane suites on Linux/Windows remain deferred and outside this diagnostic.

Each application group gets an owned short synthetic HOME and its own capability,
original command argv/environment/UTC/exit/stdio reports and unchanged-source
checks. Reports are copied as original bytes into prefixed flat names; original
reports are retained even when the command fails. Each capability secret is scanned
by the existing quarantine, in addition to the outer capability scan. Independent
phases continue after failures; failed/missing groups block exact coverage. The
existing resource producer and validator run per group in finally, bind the group,
source and run, and keep completeCleanup false. The 64-record audit bound remains:
a larger group, short-lived unidentified process or unconfirmed lease can cause
unknown and block the diagnostic. No complete resource containment is claimed.

Before dependency snapshots, fresh node_modules cache links for `.vite` and
`.vite-temp` point to explicitly retained owned scratch directories. This lets
unchanged production configs write mutable Vite output outside executable package
bytes. Link identities are included in the original dependency inventory; cache
contents are declared mutable outputs, not dependency-integrity evidence. Existing
paths reject rather than being overwritten. No package source is patched. Tests
that actually mutate other installed bytes still fail the dependency comparison.

The source-bound historical declaration catalog has 280 entries: 73 platform,
203 environment and four policy declarations. File hashes match this candidate's
sources; actual reports determine which entries are used, with current group
identities (shard allocation can change). This is neither an expected skip count
nor evidence those assertions ran. Each actual skip needs exactly one matching
file/fullName declaration, unchanged file hash, group and reason. Missing, extra,
duplicate, changed or misclassified skips block. A new skip must receive reviewed
source analysis before another exact-SHA attempt, never an automatic catch-all.

Platform dispositions name Linux/Windows and explicitly say target execution
evidence is not supplied. Environment dispositions name missing full Chrome,
agent-browser, compatible UI dist, playwright-core, qualified mail/CA, external
synthetic-provider CLI, isolated Pillow or case-sensitive temporary storage.
They are not policy prohibitions. Policy dispositions cite the exact existing
policy.json exclusion, with matching file and prohibition reason; live Muse and
paid routing flags/keys stay absent. CI is real on the hosted run, so CI discovery
may execute and must pass; it is never locally spoofed or automatically skipped.
All classes retain skipped status. Successful diagnostic reconciliation requires
positive total = passed + skipped, failed=todo=retries=0, but never supplies
formal disposition acceptance or completeQualification. The 280 historical
classifications require re-verification against actual hosted output.

Author regression entry: the two macOS `.unit.mjs` suites, existing real Vitest
CLI fixture, POSIX resource/source-binding tests and bounded archive preparer
suite. Use the already installed same-lock dependencies and existing Node only;
never invoke the hosted entry locally. Local evidence lives outside checkout in
the controller-designated macos-full-suite evidence directory. Independent review
and new hosted execution remain prerequisites; no real application-suite counts
are inferred from these synthetic checks.

