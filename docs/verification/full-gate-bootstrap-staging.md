# Darwin arm64 verified bootstrap staging

Status: **fixture staging only; production installation blocked**. The public
`stageReviewedBootstrap` API in `scripts/full-gate/bootstrap-stage.ts` launches
owned Node/pnpm stand-ins after verification and writes `bootstrap-stage.json`.
Its distinct kind is `bootstrap-stage`, installation is `not-attempted`, and
qualification.complete is always false. It never writes full-gate-install.json.
Changing complete to true cannot satisfy `requireInstallation`; production policy
validation still ends at the unimplemented bootstrap/lifecycle rejection.

The explicit initial trust boundary is a fresh disposable Darwin arm64 host,
kernel, loader, runner service, initial environment and absolute OS utilities:
/usr/bin/env, /bin/bash, /usr/bin/uname, /usr/bin/stat, /usr/bin/find and
/usr/bin/openssl. SHA-256 uses the host's native LibreSSL utility (observed
LibreSSL 3.3.6); missing utilities fail. No Perl/Python interpreter is part of
bootstrap verification. The external evidence harness uses Python to snapshot and
run tests; it is not the launcher. Existing local Node runs the development tests
and API, with its executable digest unknown. Its bytes were not read or approved.
This scope is application Node after a trusted OS launcher, not qualification of
the first JavaScript in an actual hosted job.

`FixtureReview` is an in-process contract for a trusted fixture reviewer. It is
not accepted user JSON, a signature format, an external receipt authority or an
assertion that code ran elsewhere. Review explicitly supplies the fixture-only
classification, manifest and launcher digests, exact Darwin/arm64 Node 24.22.2 and
pnpm 10.33.0 labels, canonical absolute tool paths, separate executable/entry and
archive hashes, source hashes, and the fixed provisioning relationship. These
version labels describe stand-in profiles; no actual Node 24.22.2 or pnpm 10.33.0
candidate bytes are approved or executed. Production targets/source approvals and
bootstrap stay empty. Candidate metadata alone cannot start either tool.

The launcher `scripts/full-gate/verified-bootstrap-darwin.sh` receives only three
data arguments: owned root and reviewed manifest/launcher digests. Its fixed
manifest header is
`reviewed-owned-fixture-staging|darwin|arm64|24.22.2|10.33.0|inventory-not-extraction-proof`.
Subsequent lines are `F|sha256|relative-path` or `D|-|relative-path`; the only roots
are archives, node, pnpm and source. Paths use a restricted alphabet, cannot have
aliases/escapes, and must identify complete reviewed inventories. Maximum 256
entries and 1 MiB per file bound this fixture. Missing, altered or extra files or
directories, symlinks, hardlinks, FIFOs and other nonregular files reject. Owner
and write permissions are checked. Every inventory path/type is checked before
opening inventory files for hashing. Manifest and launcher are regular checked
files before reading. The typed reader additionally opens nonblocking/no-follow,
fstats and bounds the actual bytes. Shell readers rely on the checked local
regular files and exclusion of concurrent writers; they do not implement an atomic
check-and-exec or protect against a malicious same-UID actor. No in-kernel or
remote-filesystem wall-clock deadline is promised.

Fixed archive-to-directory relationships plus the full inventory are explicitly
reviewed fixture provisioning data. They prove the order of fixture archive-byte,
distribution and source checks before execution. They do not prove that real
archive extraction produced those bytes. Source entry and all fixture source
inputs are inventoried, including exact identities for the running stage,
install-policy and supervisor source closure. Config/manifest/lock drift or
preexisting source dependencies/profile/store rejects before selection. Extra
files anywhere in the relevant distribution/source trees reject, including hidden
config. No extraction, download, PATH lookup, Corepack, dependency installation,
workspace hook, native lifecycle or network operation is performed.

The API constructs a minimal initial environment and invokes absolute
/usr/bin/env -i followed by /bin/bash --noprofile --norc and the verified launcher.
The shell checks retained BASH_ENV, ENV, NODE_OPTIONS, NODE_PATH, CA and known
loader controls before candidate execution, then starts the fixed absolute owned
Node stand-in on the reviewed source entry through env -i. The direct pnpm
stand-in command is the verified absolute Node plus fixed absolute pnpm entry and
--version. Its sole post-Node profile is the existing typed installEnvironment,
including fresh synthetic config/cache/store paths. The receipt retains exact
argv, constructed environments, actual bounded logs and process evidence,
expected/observed source/distribution/launcher/manifest hashes, and caller
source/run/attempt/job binding. GitHub fields are assertions, not authenticated
job metadata. The initial and post-Node profiles have different purposes; tests
check their shared isolation controls and the full typed post-Node profile.

An env -i invocation cannot sanitize env's own loader. Darwin SIP strips DYLD
variables before these system binaries run; absence at script entry is not proof
that script inspection rejected them. No malicious loader, OS, runner service or
same-UID protection is claimed. Actual owned BASH_ENV, ENV (/bin/sh interactive)
and Node preload positive controls establish that canaries can execute, then
controlled env -i launches establish their removal. The Node preload control uses
the existing development test runtime, not a candidate toolchain. No dylib is
loaded for a test. An initial test incorrectly expected /bin/bash --posix to read
ENV and Darwin to retain DYLD variables; those failures are retained externally.
The repair uses the actual /bin/sh control and a retained LD_PRELOAD rejection
probe, with the Darwin limitation explicit.

Regression: `scripts/full-gate-bootstrap.node-test.mjs`, alongside all seven
existing F2 Node suites (444 baseline tests), eight size/docs guards, deny-warning
lint, tools and scoped strict TypeScript, candidate pin verification and diff
checks. Existing CLI commands/reports, five synthetic install observations and six
real consumer probes remain enabled. Frozen receipts retain source/dependency
snapshots, argv/env/times/logs under the outer private evidence directory
`private/engineering-foundation-evidence/f2-verified-bootstrap/`. Exploratory
output without snapshots is labeled unbound; baseline capability was missing,
not a measured red or demonstrated performance benefit. Quality task accounting
belongs to the controller, which already started F2-verified-bootstrap-20261111.

The active workflow is untouched. Checkout/setup/provenance JavaScript currently
precedes locked-install. Future hosted qualification requires a reviewed workflow
initial environment and reordering before those first JavaScript actions, approved
real Node/pnpm archives, complete provisioning/extraction and distribution
identity, workspace/native-hook network histories, assets, resource observation
and independent review. No hosted Actions run, build, install, real user config,
Keychain access, real candidate/downloaded executable, or production qualification
is part of this staging pilot. Integration remains a controller decision after
independent review.
