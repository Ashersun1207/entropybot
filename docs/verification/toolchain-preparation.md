# Offline toolchain candidate preparation

Status: **data only, unapproved; production qualification remains blocked**.
The public standard-library Python function `prepare` and CLI in
`scripts/full-gate/prepare-toolchain-candidate.py` bind original compressed bytes
to a full archive inventory and selected regular output bytes. They never invoke
an installer, interpreter on archive contents, Node, pnpm, a native module or a
network client. This utility is outside the producer closure; it adds no production
pins or approval capability. The existing 319 pins, empty trust roots, installation
policy, bootstrap policy and active workflow remain unchanged.

The CLI accepts only `node-runtime-subset` (Node 24.22.2 darwin-arm64) and
`pnpm-complete-runtime` (pnpm 10.33.0). Its catalog is the adjacent existing
`scripts/full-gate/toolchain-candidates.json`, an unapproved source of expectations.
There is no CLI catalog, command, archive-name, selector or limit override. The
public function allows synthetic catalog bytes and smaller limits for tests;
these are never an approval mechanism. A caller able to replace code/catalog
can generate different data candidates, never qualified installation receipts.

For the retained offline originals, invoke each profile once into a separate fresh
root under the owned evidence parent:

```sh
python3 -B scripts/full-gate/prepare-toolchain-candidate.py \
  --input-root /absolute/owned/retained-archives \
  --output-root /absolute/owned/evidence/new-node \
  --profile node-runtime-subset
python3 -B scripts/full-gate/prepare-toolchain-candidate.py \
  --input-root /absolute/owned/retained-archives \
  --output-root /absolute/owned/evidence/new-pnpm \
  --profile pnpm-complete-runtime
```

The original Node archive SHA-256 must match both catalog archive and checksum-row
expectations; Node bin/node and LICENSE must match catalog member hashes and sizes
before output creation. The official checksum was observed previously; PGP
verification is unavailable and **not approved** for this candidate. pnpm must
match compressed SHA-256, size and metadata SHA-512 SRI, with required package,
bin, dist and configuration members matching catalog hashes/sizes. Its SRI is
metadata only, not a root-lock binding. Same-origin checksum agreement and
reproducible copying do not establish authenticity, safety or runtime eligibility.

Node copies only bin/node and the bundled LICENSE, retaining the full inventory
and SHA-256 of every ordinary member, including omitted files. The exact three
known symlinks bin/npm, bin/npx and bin/corepack with their documented relative JS
targets are recorded as `omitted-known-link-not-followed`; none is materialized.
Any other link or target rejects the profile. This explicit subset does not make
the full Node archive eligible for general provisioning. pnpm copies **all**
regular distribution files, including bundled runtime dependencies, licenses and
inert native/vendor bytes. The two cataloged fastlist files and four exact
reflink filenames are the only permitted native/vendor members; their complete
bytes are bound by the original compressed archive hash and inventoried separately.
No native safety review, dependencies proof for a reduced pnpm subset, or execution
claim is substituted for copying the complete distribution.

Inputs are opened with O_NONBLOCK|O_NOFOLLOW before fstat and must be owned,
single-link, bounded regular files without group/world write access. Roots must
be canonical, owned and not writable by other users; every existing path component
is checked as a real directory. This prevents opening a no-writer FIFO from
stalling before type checks. It does not establish an absolute deadline for kernel
I/O or protect against a malicious same-UID writer. No concurrent writers to the
inputs or fresh output root are assumed. The trusted host, filesystem and Python
standard library are outside this data utility's qualification.

The strict tar reader accepts only ordinary files, directories and those three
explicit Node symlinks. It rejects hardlinks, FIFO/device/special and extended
headers, absolute/empty/dot/traversal/backslash paths, duplicates, parent type
collisions, malformed headers, nonzero padding and nonzero data after the two-block
terminator. A directory header's single conventional trailing slash is normalized.
All compressed bytes are hashed before output. Every gzip byte, including headers,
skipped members, padding, trailing zeros and concatenated gzip streams, is consumed
under the 450 MiB expanded cap and gzip CRC validation. Limits are 90 MiB compressed,
12,000 entries, 150 MiB per member and 450 MiB aggregate member bytes. Entries hidden
behind tar extension metadata cannot evade counts because extensions reject.
A second streaming pass writes the validated selection and must reproduce the
entire first inventory; compressed identity is checked again. No full tar spool,
extractall, native loading or archive-derived Python import is used.

The output root must not exist, including a dangling symlink. Files are exclusively
created through no-follow directory descriptors, with requested modes 0600; all
new directories request 0700. The runner uses a normal 077/022 umask; a restrictive
umask may remove permissions and cause failure, never add execute bits. Archive
executable modes are recorded as metadata and never preserved. Node's original
0755 becomes 0600. Writes first reside in `data.partial`, renamed to `data` after
verification in the owned root. There is no cross-process atomic check-and-exec
claim. A failure after root creation retains partial data and bounded failure
reason in `failure.json` where writable; earlier failures are emitted by CLI to
stderr and leave no root. No existing root is deleted or overwritten, and disk
failure may prevent a failure manifest from being persisted.

`manifest.json` has kind `toolchain-preparation-candidate`, approval false,
execution and installation `not-attempted`, qualification.complete false. It binds
catalog source baseline, implementation baseline, catalog/preparer SHA-256,
expected/observed compressed identities, required-member expectations, all observed
member hashes/archive modes, explicit selectors/omissions, limits and deterministic
sorted relative-path/bytes/0600/SHA-256 output inventory. The inventory comparison
is explicitly the expected first archive scan versus the observed copy scan; it is
not an independently approved inventory. No automatic promotion exists. Existing
`requireInstallation`, `validateBootstrapPolicy` and `stageReviewedBootstrap`
reject this report even if a caller forges qualification.complete=true.

Regression entry: `scripts/full-gate/prepare-toolchain-candidate-test.py`. It tests
the public function and CLI, positive full inventories and modes, compressed/SRI
and selected member mismatch before output, path/duplicate/link/special/header
rejections, skipped-member expansion caps, input FIFO/symlink/hardlink, output
symlink/existing roots, known Node link omissions, pnpm entry/dist/missing runtime,
partial disk failure and actual production/bootstrap consumer rejection. The suite
runs with Python unittest; it is intentionally not added to the JavaScript producer
closure. The existing eight F2 Node suites (478 assertions), eight docs/size guards,
319 public pins and diff checks remain separate. No TypeScript or JavaScript source
is changed, so TS lint/types are outside this increment. Private collector controls
remain a separate historical-source check, not proof of this new preparer.

Frozen pre/post source/dependency hashes, exact argv, synthetic HOME/environment,
UTC intervals, exit logs and one offline copy of each retained real archive are
recorded under the outer
`private/engineering-foundation-evidence/f2-archive-preparation/` directory. Real
output manifests bind the originals and output inventory digests; no candidate
file is executed. Actual counts and clean commit identity are handed to the
controller in that evidence directory. A clean source receipt is not a production
approval. Independent review and controller serial integration are required;
bootstrap/runtime, signature trust, installers, lifecycle/network history,
platforms, native safety, resources and release qualification remain incomplete.
The controller owns the already-started quality task and its ledger.

Maintenance/security review is limited to the new streaming parser, fixed profile
selection, no-follow owned reads/writes, failure retention and tests. There are no
new dependencies, download requests, credentials, executable permission changes,
production approvals or workflow changes. Python parsing and deterministic byte
copying do not demonstrate a vulnerability in the earlier capability-missing
baseline or establish a performance benefit.
