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
source and run, and keep completeCleanup false. Durable group history accepts at
most 1,024 files, separately from the 64 declared Chrome registry files. Overflow,
a short-lived unidentified process or unconfirmed lease still causes unknown and
blocks the diagnostic. No complete resource containment is claimed.

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

Author regression entry: the macOS `.unit.mjs` suites, existing real Vitest
CLI fixture, POSIX resource/source-binding tests and bounded archive preparer
suite. Use the already installed same-lock dependencies and existing Node only;
never invoke the hosted entry locally. Local evidence lives outside checkout in
the controller-designated macos-full-suite evidence directory. Independent review
and new hosted execution remain prerequisites; no real application-suite counts
are inferred from these synthetic checks.

## First application attempt and bounded repairs

Attempt-1 run `43067442325` executed exact source
`4f43ebdd3d9723e562bf146d780ad1a678cff6c4` and failed. Its original ten reports
contain 31,334 passed assertions and 270 skips, with zero assertion failures or
todos. Node contains 2,267 passed assertions and nine skips. These counts do not
make the run successful: shard 09 has a failed suite and exit 1, and static
TypeScript build mode aborted with a genuine V8 heap-exhaustion stack at about
2 GiB. The original failed run and reports remain unchanged.

Diagnostic identity now extends group/file/fullName with an `occurrence` integer
ONLY when that name collides in the same file and group. Noncolliding identities
stay byte-compatible. Vitest JSON exposes no assertion position field. The
ordinal is zero-based among equal fullName entries in that file's original
assertionResults array, counting passed AND skipped entries; the pinned runner's
declaration/report order, unchanged source/config and original report hash bind
this order. It is not derived from timing, status, duration or title sorting.
Source/config changes invalidate cross-run assumptions about ordinal meaning.
Node uses the original strict structured parser first, then orders parsed records
by entryFile and declaration testId before assigning equal-name ordinals, so
completion timing cannot swap occurrences. Original reports are never reordered
or rewritten. Every assertion survives; ordinals never collapse tests.

The collision inventory accounts for each source call site: 43 equal-name groups,
including 36 parameterized rendered-title collisions, six literal duplicate call
sites and one Node loop-generated title collision. There are 60 main duplicate
extras in all raw reports (47 in shards that reached reconciliation plus 13 in
failed shard 09), and two Node extras. All these colliding assertions passed in
this run. Source hashes, exact titles, indices and call-site lines are retained
in the external hosted-repair evidence. This is not a test-name cleanup or a
reason to remove duplicate assertions.

A duplicated skipped title must have an explicit source-bound declaration for
EACH occurrence. An ambiguous historical declaration without an ordinal does
not expand to cover all collisions. Missing, extra, duplicate, invalid, mismatched
or source-altered occurrences still reject; a passed occurrence cannot consume
a skipped occurrence's disposition. The historical 280-entry catalog bytes and
A/B/C semantics remain unchanged. This implementation is diagnostic-local:
formal full-gate core, Node parser, dispositions and candidate pins are unchanged.
F2 still uses group/file/fullName alone and will encounter the SAME collisions.
Its producer, target receipts and signed disposition contracts require a separate
reviewed coherent identity change before activation; these diagnostic results do
not fix or activate F2.

All three diagnostic TypeScript commands now invoke the actual installed
TypeScript JavaScript entry with fixed Node argv
`--max-old-space-size=6144`, matching ordinary CI's budget. The pnpm .bin/tsc
entry is a shell shim, so it is not passed as JavaScript to Node. No caller flag
or NODE_OPTIONS enters the constructed environment. Hosted tools TypeScript had
already passed; server TypeScript was not reached. The same explicit cap covers
all three without changing the seven-command coverage or any execution/resource
budget. Other static commands have no observed heap-exhaustion evidence. Actual
hosted success under this cap still requires a new exact-SHA attempt.

Shard 09's failed suite is server/data/data.e2e.test.ts. Its one assertion passed,
but the test terminated the managed fixture directly, started a replacement
server outside that lifecycle and removed its directory while its fixture lease
remained pending. The original test reproduces locally with the actual strict
runner, capability bootstrap, isolated HOME and fake engines: one passed
assertion, a failed file, and a pending fixture/unknown file lease. The test now
uses existing fixture.restart and fixture.close, preserving its assertions and
requiring generation stop receipts and directory cleanup through the owner.
No supervisor signal/ESRCH rule is relaxed.

The outer command also retained transient `kill EPERM` text. Missing term/kill
attempt timestamps plus the supervisor's code place that text on its signal-0
presence-probe path; the child itself exited 1 and final group disappearance was
observed. The actual OS reason for EPERM was not captured and cannot be inferred
from this report. No EPERM is converted to success or ESRCH. Moreover, shards
01–09 all report history-inventory-rejected/unknown, independently of duplicate
identities and shard 09's failed suite. The artifact does not distinguish the
existing 64-file limit, unfinished history writes or other history read failures;
no exact original inventory size is recoverable. Budget overflow is a concrete
local public-API rejection path and a hypothesis for those large shards, not a
retrospectively proved hosted cause. Audit/resource acceptance remains blocked
until the controller resolves that boundary with a reviewed finite capacity and
preserved unknown rejection. The bounded correction below addresses capacity;
a new hosted run is still required to establish the real workload result.

## Durable history capacity correction (2026-11-12)

The controller's 65-record public API probe confirms that the unchanged reader
rejects legitimate retained histories above 64. A main shard runs many test files
with two workers; each fixture server generation and detached CLI launch adds a
record that must survive until both independent observations. This is cumulative
launch history, not a concurrent-process limit. Fixture restarts and multiple CLI
calls per file make 64 unsuitable for the real shard structure. Shards 01–09 had
history-inventory-rejected while shard 10 had 59 records and a clear domain. The
original failed artifacts do not preserve exact inventories for the rejected
shards; no exact maximum or leak conclusion is inferred from that absence.

`MAX_GROUP_HISTORY_FILES` is 1,024: sixteen times the rejected 64-file boundary,
with space for hundreds of fixture/CLI launches and worker-driven activity in a
shard. This is a deliberately conservative finite capacity chosen from launch
structure, not a measured local shard maximum or a guarantee for future suites.
No full local shard was run. At 65,536 bytes per file the authenticated history
acceptance budget is at most 64 MiB of file bytes per inventory. The reader still
rejects 1,025 files before reading identities. Both audit observations retain a
history-path union bounded to 1,024, so deleting and replacing paths cannot reset
that budget. No history file is deleted by the producer or audit.

The audit's former combined 64-file check also needed coordination. Its explicit
`registryFiles` input still accepts at most 64 declared registry paths. History
files are discovered separately through `readGroupHistory`; their retained union
has the shared 1,024 cap, and the combined inventory has a finite 1,088 cap. Chrome
registry capacity and row semantics are unchanged. Filename, 65,536-byte per-file,
HMAC, binding/nonce, identity, status and timestamp validation remain mandatory;
O_NOFOLLOW/O_NONBLOCK reads, terminal unknown, absence plus ESRCH for stopped,
stale-identity probe ordering and disappearance detection remain unchanged.

Public API regressions cover 65, 1,023 and 1,024 authenticated files with 64 Chrome
registries, 1,025 rejection, a retained-union overflow despite individually valid
inventories, and per-file/name/authentication/identity rejection. Synthetic repeated
records derive from one actually observed owned child, stopped and reaped with
ESRCH; they measure inventory acceptance, not 1,024 independent process launches.
Existing real-child unknown, stale, false-stopped and same-group orphan controls
remain required. Overflow still produces unknown and fails audit validation.

The shared F2 producer benefits from this capacity correction but is NOT activated.
`completeCleanup` and `completeQualification` remain false. Formal identity,
installation, trust, policy, reviewer and asset blockers remain unchanged. Candidate
pin hashes follow only the two changed producer files; the closure stays at 320
paths. Independent review, controller integration and a new exact-SHA hosted
attempt remain required. Local synthetic checks do not qualify the full suite.

