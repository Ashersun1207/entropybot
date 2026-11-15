# Hosted macOS source application window

This is a bounded diagnostic for the next macOS gap after installation, vendor
Electron startup and the application suites. First hosted window run 43745001727,
attempt 1, source 9a2e95b88, failed before diagnostics: its 203-byte artifact
contains only the workflow's host.txt. It supplies no application-window result.
The second run 43747320501, attempt 1, source 1224eb4f3, passed startup/install
and failed only source-application-window: Electron exited 1 without an accepted
observation. Its retained stderr has only backupd XPC noise, not an identified
main-process cause; the failed run remains immutable.
Independent review must precede the controller pushing a NEW exact SHA to
`codex/macos-window-readiness`; the first attempt's original reports determine
its result. Local author checks never build, download or launch Electron.

The separate `entropybot-macos-window.yml` workflow reuses the existing
qualification entry in explicit `window` mode. Its exact branch/ref, macos-15
label, actual Darwin/arm64 checks, Node 24.22.2, attempt 1, read-only permission,
pinned actions and credential separation retain the original install boundary.
Its 35-minute job bound covers the unchanged direct pnpm acquisition, frozen
install and explicit pristine Electron provisioning. It runs no application test
shards in this mode; their earlier evidence remains separate. The original
qualification workflow and formal F2 contracts are unchanged.

The first hosted failure was an import-time dependency, not a recorded phase
failure. run.mjs's static window import reached control-omb.ts, the headless team
modules and bare yaml/zod before the fresh checkout had node_modules. The entry
now dynamically imports window.mjs only inside the installed window phase after
Electron provisioning and the dependency baseline. The application-suite mode
does not load that window/control graph at startup. No install, lifecycle,
window assertion or report contract changes. A Node-child regression imports the
actual run.mjs static startup module set while a public resolution hook denies
all installed packages and node_modules paths. It omits the entry body so no host
checks, download or install runs locally. The common startup graph must resolve
for both modes without window/control modules; explicit yaml/zod import controls
must fail under the same hook. This closes the local same-lock-dependencies blind
spot. The old hosted failure remains immutable; the controller must use a new
reviewed exact-SHA attempt 1, never rerun 43745001727.

After the existing dependency snapshot and owned mutable Vite cache links, the
entry executes the public pnpm `build` script: `tsc -b`, server TypeScript and
`vite build`. Only this build child receives the fixed 6144 MiB Node heap cap
required by earlier hosted TypeScript evidence; caller NODE_OPTIONS is absent.
The UI must be freshly generated in this checkout, including its referenced JS
entry. A bounded inventory records the built bytes. No external UI asset bundle,
cloudflared preparation, electron-builder, DMG, ZIP, signing, installation or
release command participates.

The Node worker reuses `launchVerificationServer` with its real source server,
fake engine, lifecycle leases and staticDir option pointing to that dist. The
existing port-range API is restricted to 8799–8799: it cannot fall back to another
port or silently attach to an existing app. The short canonical owned HOME,
profile, caches and evidence directories come from the existing constructed
environment. The worker launches the provisioned vendor Electron with an owned
`--user-data-dir` and `--use-mock-keychain`. Its tiny ESM entry sets app paths,
observes window creation, then imports the complete real `electron/main.mjs`.
The application's ordinary development URL is explicitly the synthetic static
server; production BrowserWindow, preload, renderer, navigation and shutdown
code execute unchanged. This qualifies the source application path, not the
packaged app's embedded utilityProcess server or installed application.

The wrapper sets canonical owned home, appData, userData, sessionData, logs, temp
and crashDumps directories before importing main. Its userData and CLI profile
are `HOME/window-app-data/openmausbot`: main's existing appData/openmausbot
assignment therefore resolves to the same owned profile. Exact effective paths,
canonical resolution and directory ownership are asserted after main import,
again before accepting a window, and by the parent when reading the report.
Only the before-import and effective path strings are retained, never their
contents. This keeps application/session/log writes within the audited HOME.

The wrapper also sets `OMB_MACOS_WINDOW_DIAGNOSTIC=1` before importing main.
There was no existing updater network-disable option: manual mode schedules its
15-second and hourly checks before the ordinary unpackaged-app guard. The new
updater guard suppresses scheduling and explicit manual checks only when this
flag is exactly 1 AND the app is unpackaged. Packaged apps ignore the flag, and
ordinary unpackaged manual-update behavior is unchanged. It neither changes
UPDATE_MODE nor shortens the readiness observation. The accepted report also
requires the diagnostic updater guard to remain enabled.

Failure visibility uses the existing desktop diagnostics APIs. Before importing
main, the wrapper installs the existing crash listeners and records bounded,
redacted error details for entry/import failure, main exceptions, observation
rejection and the unchanged watchdog. The real Electron command's failure is
re-thrown after a best-effort capture, before fixture cleanup. The collector
uses readSafeLogTail on eleven fixed owned log paths: the wrapper failure log,
desktop/server/updater/main/session logs, and the known profile/session Chromium
text logs. Missing or rejected inputs are explicit. Canonical owned directories,
regular single-link owned files, 8 KiB reads, complete lines, at most 64 lines per
file and 2 KiB per line bound the input. It never scans arbitrary profile files.

buildDiagnosticsReport and diagnosticsFileName produce one flat diagnostics text
report plus fixed-schema inventory metadata. Known credential patterns and URL
parameters use the existing scrubber; the collector additionally removes exact
capability secret values, opaque HMAC/token-like strings, account/email fields
and structured private state. Redaction precedes output bounds. Binary text-log
inputs are omitted; crash/Crashpad directories contribute at most sixteen entry
counts each, never filenames or dump bytes. Output text is capped at 128 KiB;
existing artifact quarantine still checks the complete report set. No config,
cookies, session database, credential file or whole profile is exported. Capture
failure remains explicit and never turns the command failure into success.
Both capture output and its fallback status output are best effort: even if both
writes fail, the original command rejection is rethrown. The independent review
of 46defb768 found that an unprotected fallback could previously replace that
rejection with EEXIST/ENOSPC. New public-API synthetic-child controls force both
writes to fail through real pre-existing files or targeted ENOSPC injection;
they require the original command error and retained exit/stdio/group evidence.
No real disk exhaustion is used, and pre-existing diagnostic contents stay intact.

A real synthetic Node child writes known crash/session lines and exits 1 with
empty stdio. The public failure command path must retain exit/close/group evidence,
export those lines, exclude capability/HMAC/account/password/profile/dump canaries,
and pass the existing artifact quarantine. A separate public collector test rejects
symlink/hardlink/binary logs, omits structured account state and caps crash counts.
No Electron launch, logging/sandbox/GPU flag, observation timeout or semantic
startup fix is added. The next hosted attempt should show a safe main/import or
observation error and available app log tails; native failure before the wrapper
runs can still leave only missing-log metadata. The ~91-second failed command
also fits the existing 90-second readiness timeout, so exit timing alone is not
proof of the underlying startup cause. No real application-window pass is claimed.

The actual assertions are:

- Only the BrowserWindow with the real `electron/preload.cjs` qualifies. Both
  `ready-to-show` and `did-finish-load` must occur within 90 seconds. Main-frame
  load failure or renderer exit fails the observation. The renderer must load
  exactly `http://127.0.0.1:8799/`, expose the actual desktop capability bridge
  and report host platform `darwin`.
- Before and after the Electron command, `pollServerIdentity` must identify the
  owned fixture PID, app `entropybot` and static UI. A second bounded health read
  must return exactly HTTP 200, that PID, `static:true` and the four current
  guarded-message/request/full-access/on-behalf-of capabilities at version 1.
- The real sidebar must mount. Fonts, images and two animation frames settle
  within the enclosing deadline. A visible text Range within the viewport is
  cropped using Electron capturePage. The existing PNG decoder used by the
  window-frame fixtures reads the crop; at least three quantized colour buckets
  and 16 pixels outside the dominant bucket are required. A nonempty uniform
  PNG fails. This is bounded pixel presence in a text region, not visual
  correctness, legibility, screen interaction or model response acceptance.
- The app quits through its real `app.quit` handlers. The existing command runner
  requires successful exit, stdio close and observed process-group disappearance.
  The source server closes through its existing lifecycle; exit, close, stopped
  receipt with all registered children confirmed and removed data directory are
  mandatory. The existing capability/lease checks and independent resource audit
  still reject unknown or residual observation.

Existing `smoke-app-frames.mjs` tests embedded frame containment; the actual
`verify-window-frame.ts` is under scripts, not electron, and drives preview
windows. Neither proves readiness of the real main application. This diagnostic
therefore adds only the real-entry event observer, reusing the existing fixture,
boot identity poll, PNG tools, command recorder, capabilities, constructed env,
resource audit and report quarantine rather than replacing their lifecycles.

All uploaded files remain bounded flat regular reports/logs under the original
report root. Only geometry, numeric pixel evidence, health projections, build
hashes and tool/command/resource receipts are retained. The PNG, window profile,
fixture config, capability file and caches stay outside the upload root. No real
account, model, OAuth, cloud, mail, user data or Keychain is supplied. Source and
dependency comparison surrounds the work; executable identity is recorded for
the Electron command. Report failure does not become qualification success.

Author regressions are the macOS `.unit.mjs` suites, including the new public
window observer/health/pixel/dist/command tests, the existing eight engineering
guard assertions, lint, tools TypeScript, scoped TypeScript syntax/type checks and diff
check. These tests drive actual public functions, including both event orders,
never-ready/missing-load, late events, renderer/frame failure, wrong health
identity/port/capabilities, absent build output, blank PNG, mutable action,
missing architecture/build mode, ignored failure and artifact/secret exposure.
The first exploratory unit run was 18 pass/1 fail because its temporary root
used macOS's `/var` alias while the production precondition requires canonical
paths. The fixture now canonicalizes its owned root; the precondition remains.
The independent review of candidate 1012fb8206 then found that main overrode the
CLI/profile setting and manual updater checks could outlive 15 seconds. These
were implementation isolation gaps, unrelated to the controller's whitespace
fix. New Node-child regressions import the actual diagnostic entry with native
Electron stubbed and main's real profile-override statement executed at the
real main import path. They verify two userData assignments, all effective
owned paths, and refusal of escaped profile/session paths. The rest of main's
native startup is intercepted locally; this is not full Electron execution.
Separate children import the real ESM updater graph with only Electron
stubbed, mock timers past 15 seconds and one hour, and intercept every fetch.
The diagnostic case makes zero fetches including explicit update IPC, while
ordinary unpackaged and flagged packaged controls retain manual checks. The
existing manual/automatic updater suites also remain regression entry points.
Formal source-bound final counts and command hashes are in the controller's
external evidence handoff, not inferred from this document.

`completeQualification` and `completeCleanup` remain false. First-JavaScript
trust, Node PGP, complete resource containment, formal F2 producer/trust approval,
packaged embedded-server startup, Apple signing/notarization, installation,
upgrade/migration and release acceptance remain unqualified. Linux/Windows remain
deferred. No policy, trust, reviewer, asset approval, dependency, main or preload
source changes. The updater's only change is the unpackaged diagnostic guard
described above. The maintenance/security review
covers the added workflow, constructed command environment, full-entry import,
synthetic data ownership, bounded observation and artifact selection; independent
review and the first real hosted execution remain outstanding.
