# Hosted macOS source application window

This is a bounded diagnostic for the next macOS gap after installation, vendor
Electron startup and the application suites. It has not run on a hosted Mac yet.
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
Formal source-bound final counts and command hashes are in the controller's
external evidence handoff, not inferred from this document.

`completeQualification` and `completeCleanup` remain false. First-JavaScript
trust, Node PGP, complete resource containment, formal F2 producer/trust approval,
packaged embedded-server startup, Apple signing/notarization, installation,
upgrade/migration and release acceptance remain unqualified. Linux/Windows remain
deferred. No policy, trust, reviewer, asset approval, dependency or production
application source is changed by this diagnostic. The maintenance/security review
covers the added workflow, constructed command environment, full-entry import,
synthetic data ownership, bounded observation and artifact selection; independent
review and the first real hosted execution remain outstanding.
