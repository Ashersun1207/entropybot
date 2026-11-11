# Node 24.22.2 release signing key evidence

Status: **unapproved, read-only candidate trust input**, collected 2026-11-11
from baseline `d5ddb3bba024df2a8848b14750aa75497227d9b5`. The machine-readable
catalog is `scripts/full-gate/node-release-key-candidate.json`; it has no consumer
and remains outside the producer trust closure. Production approval is false.

The earlier [pristine archive evidence](pristine-toolchain.md) remains historical:
that increment fetched no keys and performed no signature verification. This
increment establishes an official publication and matching public-key identity.
**Cryptographic signature verification was not performed: unavailable-toolgap.**
Neither increment establishes an independently accepted release trust root.

## Official publication before key retrieval

Both retained official README files explicitly publish full fingerprint
`5BE8A3F6C8A5C01D106C0AD820B1A390B168D356` for **Antoine du Hamel** among active
release keys. The complete fingerprint was located in those sources before
fetching any key. The detached signature's issuer key ID was not used to select
a keyserver or authorize a key.

| Official source | Exact commit | Tree | README SHA-256 |
|---|---|---|---|
| [nodejs/node release keys](https://github.com/nodejs/node/blob/77e63793adc78164cd3b5b5147d0c7ef02b543c2/README.md#release-keys) | `77e63793adc78164cd3b5b5147d0c7ef02b543c2` | `5cf0d28c91de1bd85b9c04b0643b8a38e633a66e` | `08884b12cde6dfd5ca9ea53ff85913b310381298c267f84aa5d421c93fc61da1` |
| [nodejs/release-keys](https://github.com/nodejs/release-keys/blob/481637f813e912c4aa3622d7964ab426c97b8e8d/README.md) | `481637f813e912c4aa3622d7964ab426c97b8e8d` | `ff100f7e33b8131f81544f555fd51c57b1a33de7` | `caee8c460eee4240f17e11290032b71ee1a5ba06fdbc106db4b77d097b5cca49` |

The node README points to nodejs/release-keys keyrings and documents full
fingerprint retrieval from keys.openpgp.org. The release-keys README links the
individual armored key and describes keys/ as raw release signing keys. This
increment uses that exact-commit blob directly; no keyserver request, clone,
import script, preloaded keyring or auto-retrieval was used. GitHub's commit
verification fields are retained as service metadata only. Commit signatures
were not verified locally; publication over official GitHub HTTPS remains a
candidate trust input for independent review, not a self-authenticated root.

## Retained key identity

The original [armored key](https://raw.githubusercontent.com/nodejs/release-keys/481637f813e912c4aa3622d7964ab426c97b8e8d/keys/5BE8A3F6C8A5C01D106C0AD820B1A390B168D356.asc)
is 924 bytes, SHA-256
`5115095e2f8010c75da052ecb1cfb3af630e084f0f8daa93a863557b01b0f90a`.
Its recomputed Git blob identity is
`d7d9090d3b37bbaee829a490609543b9e096c3dc`, matching the exact keys subtree
`99a6415900960df9a5cd98df2cafa179b8e9915f` entry. The subtree is bound by the
retained release-keys root tree. Both README byte streams also match their
published Git blob identities. These content hashes do not validate Git signatures.

A private bounded packet reader computes the RFC 4880 version 4 fingerprint:
SHA-1 of byte 0x99, the two-byte big-endian public-key packet body length, and
that body. The primary packet body is 51 bytes with SHA-256
`6e076a1d67552ab67cffea5b650d4a540ffce21f74055f787d3f3785363975d1`.
The derived full fingerprint equals both official publications and the prior
unauthenticated signature issuer claim. Its low 64 bits equal
`20B1A390B168D356`. This is packet identity hashing, **not a PGP signature
verifier**. No signature mathematics, trust decision or key import is implemented.

The packet inventory also derives subkey fingerprint
`0A178CD0FE03CB4F8780980A039F94E89826F891`; its relationship to the primary key
has not been cryptographically validated. User IDs, self-signatures, revocation,
expiry, subkey binding, creation times and the signature's claimed creation time
remain untrusted data. No assertion of current validity or absence of revocation
is made from the bounded inventory.

## Tool gap and reproduction boundary

All nine explicit paths for gpg, gpgv and sq under /usr/bin, /usr/local/bin and
/opt/homebrew/bin are absent. The retained path probe did not execute a verifier.
No global tool or library was installed, no downloaded tool/code was executed,
and no real user HOME, GPG configuration, keyring, trust database or shared agent
was read. There is no successful verification status to report.

A future verifier needs separately reviewed provenance and executable identity,
an explicit isolated GNUPGHOME and no user configuration, automatic key retrieval
or shared agent. It must bind retained key bytes, full fingerprint, detached
signature and exact manifest, record bounded argv/status/output and distinguish
cryptographic validity from independent trust-root acceptance. No such source
qualification or production trust provision is approved here.

Private evidence is under the controller's
`private/engineering-foundation-evidence/f2-node-release-key/`. It retains original
commit/tree/README HTTP bytes, raw key, original manifest and signatures copied
from the prior increment, HTTP status/headers/times/SHA-256, packet offsets/body
hashes, local collector sources and pre/post source snapshots. The public catalog
also embeds the exact ASCII key bytes, enabling identity reproduction without
another network request. Existing manifest/archive/SRI facts are unchanged.

Requests use only HTTPS api.github.com and raw.githubusercontent.com, no inherited
proxy, no credentials, a 2 MiB cap, 20-second socket timeout and 60-second elapsed
checks between reads; redirects are refused. Successful records show HTTP 200
and no redirects. A blocking operation may consume its socket timeout beyond an
elapsed check; no OS network sandbox or hard wall-clock bound is claimed. Key
packet inspection additionally caps input at 64 KiB and 128 packets, rejects
partial/indeterminate packet lengths and performs no open-ended parsing.

The initial recursive node tree request stopped at the unchanged 2 MiB cap.
One repair switched to nonrecursive exact tree requests. The initial body was
not retained and its HTTP record was overwritten during the retry; terminal
failure and this evidence limitation are recorded separately, without claiming
a complete initial request receipt. Subsequent successful raw responses remain
retained. A separate exact-commit reproduction fetched both commit/tree/README
sources, the keys subtree and the same key again with fully recorded isolated
environment/argv/logs and pre/post hashes; all source/key byte comparisons passed.
The original collection's full inherited environment was not captured, so that
later receipt binds only the reproduction, not the earlier requests. No second
repair or relaxed guard was needed.

## Validation and maintenance review

The private offline identity check re-reads the public catalog, retained original
bytes, official publication/blob bindings and prior manifest/signature hashes.
It compares all 319 existing pin entries and their file hashes with the baseline,
and checks the allowed docs/data diff and unchanged trust/policy/workflow bytes.
This is a data identity check, not execution of the public JavaScript verifyPins
API or a substitute for its producer-closure discovery.

The task forbids actual Node/pnpm execution. Accordingly, the eight existing
Vitest guards and public JavaScript pin verifier were **not run** in this
increment; they remain required controller checks on the final clean commit.
No dirty-state check is presented as final-commit validation. A separate clean
commit identity/diff receipt records the delivered SHA/tree/status. Red evidence,
performance benefit and general crypto-verifier qualification remain unknown;
no implementation-mirroring product tests were added for copied data.

Bounded maintenance/security review found only docs and an inert JSON candidate:
no production install policy, bootstrap, targets, sourceHashes, dependency,
workflow, resource approval or trust pins change. No Node/pnpm/archive execution,
install/build, Actions, push, main modification, user data or Keychain access
occurred. The quality task remains open and its ledger belongs to the controller.
Independent review, final controller validation/integration, qualified signature
verification and explicit trust-root approval remain outstanding.
