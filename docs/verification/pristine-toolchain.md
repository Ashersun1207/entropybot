# Pristine toolchain archive candidate

Status: **unapproved / read-only evidence**, collected 2026-11-11 against source
`64ffeb6397e61dbdfb00e05036cbbb89fd4c76dd` (tree
`2050d28001c4a124f244da34f3c65b4fdea7b535`). This qualifies selected archive
identities for review. Production installation, bootstrap, lifecycle execution,
resource acceptance and release approval remain blocked as described in
[the installation prerequisite](full-gate-installation.md).

The audit catalog is `scripts/full-gate/toolchain-candidates.json`. It has no
consumer and is deliberately outside the producer trust closure. Its values are
observations and published tables, never an approval input. The existing 317
candidate pins, installation policy (including its historical unknown hook status),
production consumers, action catalog/workflow, empty release/reviewer/asset trust
roots, 77 unresolved dispositions, 15 jobs and five verdict steps are unchanged.
The earlier prerequisite's no-network statement describes its own increment;
this separate candidate made only the official read-only requests below.

## Archive binding and collection limits

The current root lock SHA-256 is
`b1d200592b36e631d7633bbecc433d15beed9c931fec54b833131f1f20fd2648`.
Exact-version metadata and original tarballs came from
[registry.npmjs.org](https://registry.npmjs.org/). All six archive SHA-512 values
match metadata integrity; five also match their exact root-lock SRI. Each archived
manifest name/version matches the request. pnpm is not a root-lock dependency:
its metadata integrity binds a candidate source archive only. The catalog retains
the full SRIs, archive SHA-256, manifest hashes, selected member hashes/modes,
exact URLs, HTTP status, timestamps and redirect chains. All observed requests
completed on the requested official origin with no redirects.

| Package | Version | Root-lock SRI matched | Archive SHA-256 |
|---|---|---|---|
| electron | 43.7.9 | yes | `b33139a341dec34c7ad4e15779f09951c6a8d95cd6b6b093ac03d9585c91b5c6` |
| esbuild | 0.28.1 | yes | `eb8ef756f8299d16d5c8b35678606d715ba29923f500db7b37c181310eed40a5` |
| esbuild | 0.28.2 | yes | `e045f94c235c7adc50e77ba2a579c7bec41b496b6b47c3a7845f7c1e19959a88` |
| @electron/get | 5.1.0 | yes | `bdaedaeec759d5b41a20e4d3ae930a86f0406ecf07f28777d8c3c1e9c62182bf` |
| @electron-internal/extract-zip | 1.0.5 | yes | `939b4462974f8fa1b339dd4f420c62787ddf06903cc9c61f1f0661f096f5370b` |
| pnpm | 10.33.0 | not lock-bound | `bfcc1bcbad279b13a516c446a75b3c58b6904b45d57a1951411015e50b751a80` |

A private Python standard-library collector disables proxy inheritance and accepts
only HTTPS registry.npmjs.org/nodejs.org origins, default port and no URL
credentials, including on redirects. Each request has a 30-second socket timeout,
180-second elapsed check between bounded reads, and explicit byte cap: metadata
2 MiB, npm archive 40 MiB, Node archive 90 MiB, checksum text 128 KiB and each
signature 256 KiB. A blocking read may consume its socket timeout after the elapsed
check; this is not an OS network sandbox or absolute wall-clock guarantee.

Archive inspection does not use extractall or follow links. A bounded gzip pass
caps all decompressed bytes, including tar headers/padding, at 450 MiB. Tar entries
are limited to 12,000 and 150 MiB each; absolute, traversal, backslash, foreign-prefix,
duplicate, symlink and special entries reject archive qualification. Selected
regular member streams are read/hashed into private evidence files without
preserving executable permissions. All six npm archives pass this bounded path
inspection. Node's three links are explicitly rejected below; its independent
regular-member hash does not make the archive eligible for provisioning.

## Electron hook discrepancy resolved

The original Electron 43.7.9 manifest has **no scripts field**. Its bin map is
`electron -> cli.js` and `install-electron -> install.js`. The latter is an exposed
command, not an automatic npm install/postinstall hook. The unchanged workspace
build permission does not create a missing lifecycle script. No invocation is
added; any explicit future provisioning command requires separate review.

Only these declared local files were compared, under the controller application's
node_modules/.pnpm/electron@43.7.9/node_modules/electron directory (absolute paths
are retained in the catalog). All three are byte-identical to the verified archive:

| Selected member | SHA-256 (archive and local) |
|---|---|
| package.json | `52e0fd164cd481c7cd56ad4cb7fa2d1a61f81180bb6d049d76efdf403fefd036` |
| install.js | `3b9e0c3c9070edbdb732dc05ed23c6f1c6b7a404bd623033a2f0b71052534e93` |
| checksums.json | `4106482e1f7cb05e6e462576710efb2319f56b3b326c601254944e2c18ac8321` |

There is no observed drift in those files. This comparison does not establish the
whole local dependency tree's provenance, prior lifecycle/network history, or the
identity of any installed Electron executable. No local dependency was overwritten.

Source reading of install.js shows an already-installed check, platform/architecture
and dist/cache overrides, a Darwin Rosetta sysctl subprocess branch, artifact download,
native extraction, declaration movement and path.txt output. It defaults to the
bundled checksum table unless remote checksums are requested. @electron/get defaults
to GitHub Electron release assets, can read/write its cache, and supports mirror,
custom filename/version/URL, proxy, downloader and checksum-disable options. These
are capabilities visible in source, not observed network behavior. Only the npm
sources were fetched here; no Electron release asset was requested. The catalog
copies the original target archive SHA-256 table as **metadata only**.

The extractor is the lock-bound @electron-internal/extract-zip package, not the
unscoped extract-zip package. Its JS wrapper loads a native binding. The catalog
hashes the actual nine bundled .node member streams and their filename platform
labels, including the universal Darwin member. None was loaded or executed; no
reproducible source-to-native rebuild or native safety review is established.

Both esbuild versions declare postinstall `node install.js`. Each installer source
selects an optional target package, supports ESBUILD_BINARY_PATH, and can fall back
to an npm subprocess and then a direct registry download. It may replace the JS
launcher with a linked binary and executes a version probe. Its fallback checks
SHA-256 against the manifest's esbuild.binaryHashes table. The normal resolved
optional-package path is not passed through that fallback integrity function.
Both original 23-entry binary hash tables, optional targets, installers and JS
launcher hashes are retained. Target binary hashes are published expectations;
no optional target archive or native lifecycle output was observed. The three
WASM fallback targets have no entries in those 23-entry binary tables. No hook,
npm subprocess, fallback, version probe or output mutation was run here.

## Node 24.22.2 and pnpm 10.33.0 identities

The requested exact Node release exists. Its official
[checksum manifest](https://nodejs.org/dist/v24.22.2/SHASUMS256.txt) has SHA-256
`aec92ae945293821c22aed4c37b97741688254bac353b861fc9fb25b81ce4567`.
Only the darwin-arm64 tar.gz was downloaded; every other checksum row remains
**manifest only / not downloaded**, including Windows executable rows.

| Observed item | Bytes / mode | SHA-256 |
|---|---|---|
| node-v24.22.2-darwin-arm64.tar.gz | 53,068,959 bytes | `aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a` |
| bin/node regular member | 122,564,432 bytes / 0755 in archive | `b6fb419f0f43bb2fbca273700294dd2f3b685a64b60e8417c295f47646a70e4a` |
| pnpm package/bin/pnpm.cjs | 1,102 bytes / 0755 in archive | `b276da51dc8ca5b0d3ee3371695b50fc8b3244b281b091c63a3f082a88dadeb9` |
| pnpm package/dist/pnpm.cjs | 7,825,035 bytes / 0644 in archive | `cdd88c62c16accc702dcf6a6103b4c5ca61e1f0d3883ed24a8941423248f8dca` |

The Node archive checksum matches its official manifest. The archive contains
bin/corepack, bin/npx and bin/npm symlinks to bundled JS paths. The collector
inventories these links and rejects the archive under its no-links policy. It
never follows or provisions them. Hashing the separate regular bin/node stream
provides an identity for future review, not archive-install acceptance. Node's
version is attributed to the official URL and archive prefix; the executable was
not launched to query its version. The requested version's use as an existing
validation runtime is separate from production approval of these archive bytes.

Both official SHASUMS256.txt.sig and SHASUMS256.txt.asc were fetched. Their hashes
and sizes are in the catalog. The detached packet contains an unauthenticated
issuer fingerprint `5BE8A3F6C8A5C01D106C0AD820B1A390B168D356` and issuer key ID
`20B1A390B168D356`; these are packet claims only. **No signature verification was
performed, no trusted release key was established, and no GPG keyring or user
state was accessed.** HTTPS plus a matching checksum from the same origin does
not establish independent signature trust, reviewer approval or binary safety.

pnpm's archived manifest maps pnpm to bin/pnpm.cjs and pnpx to bin/pnpx.cjs.
The actual pnpm entry requires ../dist/pnpm.cjs; both streams above were hashed.
Its manifest declares Node >=18.12, consistent with the entry's source version
check. Compatibility with Node 24.22.2 is source-level eligibility only; pnpm
was not executed. Direct invocation of a separately approved Node and pnpm entry
could avoid Corepack in a future design, but no implementation, invocation or
approval is added here. Bundled pnpm vendor executables are inventoried/hashed
without executing them; their presence and hashes do not approve them.

## Review, validation and missing conditions

External controller evidence is retained under
`private/engineering-foundation-evidence/f2-pristine-toolchain/`: raw exact-version
metadata, original compressed archives, HTTP headers/status/URL/origin/redirect
records, bounded tar inventories, selected regular-member bytes and hashes,
local comparison inputs, baseline snapshot, collector/generator source snapshots,
argv, environment notes, UTC intervals, exit records and logs. Initial collection
exited 1 because its manifest parser omitted valid source and Windows rows; the
six npm results were valid, but no Node archive was fetched in that run. The
corrected pass retains that failure and parses every original checksum row.
The private collector also rejects synthetic SRI mismatch, traversal, oversize,
duplicate and symlink fixtures, with a regular-file positive control. It is not
a new repository verifier or production extraction implementation.

Frozen validation covers the existing verification-docs and file-size guards
(eight assertions), public pin verification (317 unchanged pins) and diff checking,
plus a private catalog-to-original byte check (six packages, five lock-bound,
34 Node checksum rows, one downloaded Node archive and three rejected links).
All six synthetic collector controls pass. Guards use the original Vite config
with the existing strict runner, native config loading and a private cache root;
existing declared application dependencies are read through a temporary owned
node_modules symlink. No dependency installation or downloaded code execution is
involved. The launcher is the previously designated Node 24.22.2 validation
runtime; its toolchain-directory bytes were not read or hashed, and its production
identity remains unknown. No product tests were added for copied data, and no
repository tool source changed, so lint/types and full behavioral regression are
outside this change. Exact argv, environment, pre/post source and tool/config
hashes, UTC times, exits and logs are retained in private validation receipts;
they do not qualify installation or archive code execution. The quality task remains open for the controller; this subtask
does not start, finish or update its ledger.

Bounded maintenance/security review covers only the origins, archive path/size
handling, selected lifecycle/download source and license metadata above. Electron,
get, esbuild and pnpm declare MIT; extract-zip declares BSD-2-Clause. Original
license text members were hashed where present; the extractor archive has no
standalone LICENSE member. Node's bundled license text was retained. This is not
an exhaustive transitive license review, reproducible binary audit, or a safety
claim based on signatures. No unexpected local drift was found in the three
compared Electron files; broader local mutation classification remains unknown.

Independent candidate review and controller serial integration are still needed.
Future production qualification also needs trusted Node signature/key policy,
reviewed link/provisioning behavior, exact per-target executable approvals,
pre-JavaScript bootstrap approval, pnpm entry/dist and bundled executable review,
explicit Electron provisioning design, observed lifecycle outputs and complete
controlled cache/optional-package/fallback/redirect/network history. Downloading
verified bytes cannot reconstruct that history. The unconditional resource gate,
platform limitations and empty trust boundaries remain in force.
