# Release completion: phone v1, provider docs and browser fixtures

Baseline: `2f063e4381b82e8ef0d635174a922f1db82f264c`. Worktree: `gorkbot/.worktrees/release-completion-compat`, branch `codex/release-completion-compat`. This slice does not change delta recovery, handed-message recovery, verification runners, cleanup helpers, versioning, packaging or installed applications.

## Phone credential v1

The unchanged Apple CryptoKit ciphertext in `server/phone-secret.test.ts` failed at baseline. Rebranding had changed both HPKE `info` and the AAD prefix while retaining protocol version 1.

The server now retains the published v1 domain bytes:

- HPKE info: `OpenMausBot phone credential v1`.
- AAD prefix: `openmausbot-phone-credential-v1`.

These are cryptographic protocol identifiers, not product copy. Historical Swift `PhoneSecretCrypto` at `ca5f90e39` and immediately before iOS removal (`0d6708c56^`) uses these same bytes. `Session.preparePhoneCredential` binds the connection, pinned key ID, device, bot, thread, card, target and request key before sealing. `Client.provideCredential` sends the envelope to the existing authenticated secret-card route. No source evidence of a released renamed-domain iOS client was found, so no dual-read or fallback was added.

The fixed ciphertext/private test key were not regenerated. Tests pin the literal domain strings, reject renamed info/AAD independently and together with a generic verification failure, and check all card/device metadata tampering fails before the private save callback. Key identity/version checks and HTTP authorization remain unchanged. Desktop utility-process messages remain `entropybot:phone-secret-*` on both ends: they are not the Swift HTTP envelope or HPKE domain.

## Provider documentation

All three baseline text-contract failures were visible product-name mismatches. The existing tests already exercise real Claude catalog/auth readers, OpenCode ACP discovery/effort variants and OpenCode JSON injection in temporary homes. The model picker still consumes `model.useLocal`.

Only visible product references on `apps/docs/content/docs/providers/model-providers.mdx` were corrected to Entropybot. The upstream source link is retained. No provider, UI, config parser or model capability was changed, and no expected capability was rewritten to match a fixture.

## S6 notice and deterministic networking

The notice case now uses a real Chrome with separate CDP browser-context proxy settings. Browser-process background traffic goes to a closed fixture proxy; the page context alone uses its BrowserEgress gate. A synthetic unrelated navigation confirms it cannot populate that page's notice. The original exact loopback notice assertion and zero-owner-service-hits assertion remain.

The allowed public page is supplied by a controlled stand-in through the existing home-site upstream path (`www.google.zz:80`). It is not fetched from the internet. The page must navigate successfully, preserve its title/body, and produce no refusal notice. This replaces the external example.com availability probe and conditional early return; no production loopback, rebinding, Reddit, private-network or metadata policy was relaxed. Test resolvers refuse unknown/public destinations rather than consulting the machine's external DNS.

A wider related test run exposed two additional DNS assumptions: the local resolver returned fake-IP answers even for `bad host name` and `evil\u0007.example`. Unit tests now inject deterministic DNS failure/answers, still asserting the original notice text and resolver fallback behavior. `gate.ts`, `policy.ts` and `registry.ts` production logic are unchanged. The first failed batch and final passing batch are both retained.

## Explicit Chrome HOME/profile injection

Production defaults and the “use my Chrome” path are retained. No environment switch changes the production default globally.

- `chromeLaunchEnv(env, platform, home)` accepts an explicit home; its previous account-home default is unchanged.
- `launchPipeChrome` accepts an explicit environment and can create a proxy-specific CDP browser context.
- `ChromeLauncherOptions.home` is carried through calibration, generated launcher HOME and launcher checks.
- The internal launch/calibration/engine/local-backend options carry `home` to the existing `chromeEnv` boundary. Explicit `userDataDir`/profile folders remain separate.
- S6/use-my-mac fixtures pass their synthetic environment; the optional real cloud-lending fixture passes its own temporary home. CDP/service/hold-browser fixtures pass their private home/profile explicitly.

Existing assertions of default account-home behavior were retained. Added assertions cover explicit synthetic homes, launcher/calibration/check boundaries, the actual benign calibration child process's HOME/profile arguments, and backend launch parameters. Defaults are tested with known fake binaries or pure functions; they do not open a user's Chrome profile. Real Chrome runs in this slice use temporary profiles, synthetic HOME and the existing mock-keychain flags.

## Executed checks

Use the existing Node 24.22.2 and linked repository node_modules; no dependency installation. Vitest setup supplies per-file synthetic HOME/data. Default short TMPDIR is retained. Persistent evidence directory:

`/Users/sun/Desktop/Codex/gorkbot/private/release-completion-evidence/compat/`

1. Baseline phone/provider-doc tests: **4 failed, 22 passed**. Log: `baseline-phone-modeldocs.log`.
2. Phone/provider docs plus chrome-pipe, flags, launcher, calibrate and local-backend tests: **7 files / 69 passed**. Log: `phone-modeldocs-home.log`.
3. Final browser batch (complete S6, gate, policy, registry, cloud-lending, use-my-mac, engines and size guard): **8 files / 114 passed / 3 pre-existing environment skips**, no failures; **67.02 seconds**, exit 0, 420-second supervisor budget not reached. Logs: `browser-isolation-final.log`, `browser-isolation-final-run.json`.
4. Phone HTTP ownership/companion selected regression: **4 files / 19 passed / 451 deliberately unselected tests**, no failures. This is a filtered subset, not a full index/companion run. Log: `phone-http-companion.log`.
5. Private phone identity/IPC Node tests: **10 passed**, no skips or failures, only synthetic in-memory identities. Log: `phone-private-ipc.log`.
6. `tsc -b`, `tsc -p tsconfig.server.json`, changed TypeScript-file `oxlint --deny-warnings` and `git diff --check` passed. Typecheck/lint logs: `typecheck-final.log`, `lint.log`. The source-size guard is included in item 3; no budget or guard was changed.

The earlier browser batch had **2 failed / 111 passed / 3 skips** because of DNS-dependent unit tests, not S6. It is retained as `browser-isolation.log` and `browser-isolation-run.json`. The focused DNS correction passed **29 tests** in `dns-isolation-fixed.log`. Focused S6 notice passed separately in `s6-notice.log`; it overlaps the final batch and is not an additional independent pass count.

Representative commands:

```sh
node node_modules/vitest/vitest.mjs run --root . --configLoader native \
  server/phone-secret.test.ts server/model-providers-docs.test.ts \
  server/testing/chrome-pipe.test.ts server/browser/chrome/flags.test.ts \
  server/browser/chrome/launcher.test.ts server/browser/chrome/calibrate.test.ts \
  server/browser/backends.test.ts

node node_modules/vitest/vitest.mjs run --root . --configLoader native \
  server/browser/egress/hostile-pages.e2e.test.ts server/browser/egress/gate.test.ts \
  server/browser/egress/policy.test.ts server/browser/egress/registry.test.ts \
  server/cloud-lending-chrome.e2e.test.ts server/use-my-mac.e2e.test.ts \
  server/browser/engines.test.ts scripts/testing/file-size-ratchet.test.ts

node --test electron/phone-secret-identity.node-test.mjs
```

Historical Swift source/review excerpts are in `ios-v1-last-source.swift.txt`, `ios-v1-client-request.txt`, `ios-v1-session-encrypt.txt` and `source-review.json` in the evidence directory.

## Limits and maintenance

The three environment skips are the CI-only Chrome presence assertion on a non-CI host, plus two existing opt-in real agent-browser + Chrome cloud-lending cases. No agent-browser binary was installed to enable them. Mock lending tests are not evidence that those real platform cases ran. S6 itself exercised real Chrome; Linux process-ownership checks use the suite's documented stand-in on this Darwin host. Native iOS builds, real Keychain/credentials, installed Chrome profiles, signed/package upgrades and full-repository regression were not exercised.

No permissions, production egress policy, dependency, install script, version or credential-storage identity were changed. New maintenance lesson: branding must not rewrite cryptographic domain strings; external DNS/background Chrome traffic must not decide a supposedly synthetic fixture's exact notice. Keep immutable cross-platform vectors, inject test homes at every launch boundary and explicitly separate fixture, real-browser and real-platform evidence. This review is limited to the changed scope, not a claim of whole-repository safety or completed release readiness.
