# Pipe Chrome fixture HOME isolation

The pipe verification helper must preserve the caller's synthetic home. The baseline default read `userInfo().homedir`, which consults the account database rather than the fixture's HOME. A temporary Chrome profile alone did not prevent that environment override.

`chromeLaunchEnv` now defaults to the supplied environment's HOME, or USERPROFILE for win32. An absent or empty variable stays absent or empty; the helper never fills it from the account database. Callers must still supply a synthetic home: this change does not guarantee Chrome's own behavior when HOME is absent. The third argument remains an explicit home override, including a deliberately selected account home. Arguments, temporary-profile allocation, credential-store flags and egress policy are unchanged.

## Reproduction and evidence

The focused regression is `server/testing/chrome-pipe.test.ts`. Before the product change, the new contract produced **7 failed / 3 passed**: inherited synthetic HOME/USERPROFILE, omitted arguments and absent-home cases failed. The explicit override and credential flags controls passed. The red source and patch were retained before modifying the helper.

Private evidence is in the controller workspace at `private/engineering-foundation-evidence/f2-chrome-home-isolation/`. Each command has before/after source, selected dependency package contents/lock, Node, Chrome executable and runner hashes, exact argv, minimal environment, UTC, exit and persistent log. The snapshots include all tracked source/assets and untracked source files; dependency binding covers the runner/tool packages listed in the manifest, not every transitive installed byte. This is local evidence, not the F2 authoritative producer or a trust-map implementation.

The owned smoke uses the actual helper under synthetic HOME/USERPROFILE and a throwaway profile under tmpdir. A tiny owned executable records only HOME/USERPROFILE/argv/PID immediately before `execv` of installed Chrome, inheriting the same environment and pipe descriptors. A process listing confirms the executable; a CDP evaluation returns 42. A deny-all existing egress gate and the unchanged macOS mock-keychain argument remain active. The red smoke confirms the passed HOME equals the real account home and differs from the synthetic caller home; the green smoke requires equality with synthetic HOME. Both require profile removal and no remaining process referencing that profile after close.

Two initial red smoke attempts failed in the evidence harness's attempt to read HOME from `ps` output; the recorded exec environment already showed the mismatch. The probe was corrected within two repair rounds to use the exact exec environment, actual executable and CDP response. Both failed logs remain. They do not count as completed smoke acceptance. No Keychain access audit was performed, and no real Keychain read or absence-of-access guarantee is claimed.

Final related suites, guards, scoped strict types and lint are recorded in the private receipts on frozen source. There is no build, app installation, dependency acquisition, provider/model call or release action. Independent review is required before integration; the final integrated source needs its own regression run. This closes only the pipe helper's HOME precondition.

## Callers and other account-home paths

All `launchPipeChrome` / `chromeLaunchEnv` references were inspected:

- `launchPipeChrome`'s omitted-environment default invokes this helper and is the repaired path.
- Four launches in `server/browser/egress/hostile-pages.e2e.test.ts` and one in `server/use-my-mac.e2e.test.ts` already pass the synthetic `process.env` directly; no account-home override occurs there.
- `server/cloud-lending-chrome.e2e.test.ts` explicitly supplies its owned temporary home as the third argument. That override remains supported.
- The helper tests cover defaults, both platform variables, no account fallback and explicit overrides. No caller relies on the helper's old implicit real-home default.

Other findings are follow-ups, left unchanged:

- `server/browser/chrome/flags.ts`: `accountHome()` reads `userInfo().homedir`; `chromeEnv` deliberately defaults to it. `launchChrome` and calibration callers without an explicit home can therefore override synthetic HOME. Existing flags/calibration tests protect that production default; their account-home child is a known shell stand-in, not real Chrome. The production policy needs separate review, not a global replacement in this patch.
- `server/browser/chrome/launcher.ts`: private calibration/check environment and generated wrapper use `userInfo().homedir` by default on Darwin. Existing launcher tests explicitly protect this behavior using stand-ins. Fixture entrypoints must continue supplying `home` explicitly.
- `server/drivers/muse-code.live.test.ts`: deliberately restores real account HOME for a signed-in live CLI, behind `OMB_LIVE_MUSE=1`. It is not an offline fixture; retain its opt-in and exclude it from synthetic/live-disabled acceptance. It was not run.

The existing CDP real-Chrome helper, bare-Chrome helper, hold-Chrome helper, real browser service, identity/passkey verification and manual browser verification supply an explicit synthetic home. Ordinary `os.homedir()` uses (including fake-engine fallbacks and product/browser resolver fallbacks) follow HOME/USERPROFILE at call time; the server test setup assigns those variables before imports. No additional unconditional real-account override was found in those fixture helpers. Helpers inheriting the parent environment still require a synthetic supervisor environment; a temporary profile by itself is insufficient.
