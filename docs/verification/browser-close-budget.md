# Legacy browser close caller budget

Scope: standalone repair from `98b25c17b13b2d811893fbcc7c9c97e7ece2ab02`.
It does not include the frozen navigation cancellation candidate or its diagnostic
instrumentation. The direct/redirect cancellation pair with the shared raw target
probe still requires a separately reviewed combined candidate before integration.

`closeBrowserSession` starts its deadline at enqueue. Inventory, owned-tree
discovery, native close, disappearance checks and owned fallback share that
absolute deadline. An owned tree reserves at most 2 seconds, or half the remaining
allowance, for fallback. TERM grace is capped to leave confirmation/KILL time;
expiry is false, never confirmation. `BrowserSweep.closeAll` subtracts initial
listing time before dispatching each session close. Existing shutdown producer
and server graceful budgets are unchanged.

Native command results distinguish exit, timeout, spawn and output overflow
internally without logging stderr or content. Timeout kills the owned command
with SIGKILL before its command deadline and awaits actual child close within
that deadline. There is no delayed five-second KILL timer. A command whose close
is unconfirmed keeps the session fenced against subsequent commands through this
runner and `startBrowserSession`; timeout does not claim OS termination.

Fallback rechecks remaining time and the pid-file identity before signals and
profile removal. Captured process start times and group identities still protect
reused PIDs. An unavailable process table neither authorizes snapshot PID signals
nor confirms disappearance. Native child close, daemon disappearance and captured
browser-tree disappearance are distinct checks.

## Evidence

Private receipts: `private/engineering-foundation-evidence/browser-close-budget/`
in the controller workspace. Each command records pre/post source maps, HEAD,
tree/status, Node/dependency/runner inputs, argv, synthetic HOME, canonical short
TMPDIR, UTC, exit and log hash. Generated Vite cache maps are recorded separately;
shared cache deltas are observations, not product changes or historical evidence.

- Baseline synthetic red: `server/browser-close-budget.test.ts` had 2 failures
  (total fallback allowance and queue wait) and 1 passing nonzero-exit control.
- First repair run: 114 passed, 3 failed, 2 platform skips; fractional `execFile`
  timeout caused synchronous rejection and leaked timer callbacks. Clamp to an
  integer and clear timers on synchronous rejection. The original assertions stay.
- Second repair run: 136 passed, 1 failed, 2 platform skips. The remaining new
  reused-PID fixture awaited a second zero-delay fake timer after advancing zero
  milliseconds. Advance one millisecond; no product change for that fixture fix.
- Actual isolated packaged agent-browser 0.37 close: one new disposable HOME,
  five captured members/two groups, close true in 224.3 ms within 4,000 ms;
  captured tree absent and session inventory empty after close. Directory removed
  only after both checks. This is a close-boundary probe, not a cancellation test.

Regression entrances: `server/browser-close-budget.test.ts`,
`server/browser-process-budget.test.ts`, existing `server/browser-engine.test.ts`,
`server/browser-processes.test.ts`, and `server/browser-lifecycle-cleanup.test.ts`.
They cover fast native close, nonzero command, native timeout and owned fallback,
unconfirmed command close/fencing, unknown/refused fallback, queue contention,
distinct sessions, replacement while closing, expired/near deadlines, table
failure, real owned command exit/stdio close, reused-PID and unrelated controls.

## Limits and review

This bounds supported waits and command timeouts; it is not a hard wall-clock
claim for blocking filesystem/kernel I/O, cross-process scheduling or remote
filesystems. The absolute budget uses the existing Date.now clock convention;
wall-clock adjustments are not qualified. OS signalling and process enumeration
retain their existing race boundaries. Windows image checks remain weaker than
POSIX start-time identity; Windows and Linux execution were not qualified here.
Existing Linux OOM and real Windows cmd fixtures skip on macOS and are reported
as skips, not passing acceptance.

The real fixture exercised normal native close only. The previous native false
result and the exact inner fallback wait in the diagnostic redirect remain
unknown. No repeated browser run, omitted raw probe acceptance, real provider,
Keychain, user browser/data, package build, install, dependency change or download
was used. The first type-check wrapper was terminated by a 20-second tool timeout
without a post receipt; it is incomplete and cannot count as a passing check.

Maintenance/security review is confined to these deadline, command-child and
owned-process paths. No new network access, executable source, dependency,
permissions, auth/schema/UI or cancellation ownership change. Required independent
product/security review must examine the final diff and resource/identity fences
before any main integration or combination with the frozen cancellation work.
Final check counts and source identity are in the private handoff.
