import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { basename } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { validateNodeReport, validateVitestReport, verifyPatchBehavior } from "../check-patches.mjs";
import { vitestFiles } from "../patch-contracts.mjs";
import { gateFixture } from "./patch-gate-cli-fixture.mjs";

const faults = vi.hoisted(() => ({ remove: false }));
vi.mock("node:fs", async importOriginal => {
  const fs = await importOriginal();
  return { ...fs, rmSync: (path, options) => {
    if (faults.remove && basename(path).startsWith("entropybot-patch-gate-")) throw new Error("synthetic removal refusal");
    return fs.rmSync(path, options);
  } };
});
afterEach(() => { faults.remove = false; vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const ready = f => expect.poll(() => { try { return f.readState().pid > 1; } catch { return false; } }, { timeout: 2_000 }).toBe(true);

it("awaits the real CLI and uses its source root, filtered environment and sequential suites", async () => {
  vi.stubEnv("GATE_SYNTHETIC_API_KEY", "fixture-only");
  vi.stubEnv("OMB_DATA_DIR", "/synthetic-not-a-real-data-path");
  vi.stubEnv("NODE_OPTIONS", "--trace-warnings");
  const f = gateFixture("valid");
  const result = await f.cli().done;
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain("Patch behavior gate OK");
  expect(f.readState()).toMatchObject({ cwd: f.root, leaked: false });
  expect(existsSync(f.readState().home)).toBe(false);
  expect(f.nextStarted()).toBe(true);
});

it("executes the CLI through a symlink instead of silently treating it as an import", async () => {
  const f = gateFixture("valid");
  const entry = `${f.root}/gate-entry.mjs`;
  symlinkSync(`${f.root}/scripts/check-patches.mjs`, entry);
  const result = await f.cli(entry).done;
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain("Patch behavior gate OK");
  expect(f.nextStarted()).toBe(true);
});

it.each(["exit7", "bad-json", "missing-report"])("real CLI rejects %s and does not start subsequent suites", async mode => {
  const f = gateFixture(mode);
  const result = await f.cli().done;
  expect(result.code).toBe(1);
  if (mode === "exit7") expect(result.stderr).toContain("[exit] Vitest patch suites: exit code 7");
  expect(result.stdout).not.toContain("Patch behavior gate OK");
  expect(f.nextStarted()).toBe(false);
  expect(existsSync(f.readState().home)).toBe(false);
});

it.each(["SIGINT", "SIGTERM"])("real CLI handles repeated %s with one cleanup and no subsequent suite", async signal => {
  const f = gateFixture("hang");
  const cli = f.cli();
  await ready(f);
  cli.child.kill(signal);
  cli.child.kill(signal);
  const result = await cli.done;
  expect(result.code).toBe(1);
  expect(result.signal).toBeNull();
  expect(result.stderr).toContain(`[cancelled] Vitest patch suites: received ${signal}`);
  expect(f.nextStarted()).toBe(false);
  expect(existsSync(f.readState().home)).toBe(false);
  expect(existsSync(`${f.root}/received-term`)).toBe(true);
  expect(existsSync(`${f.root}/insurance`)).toBe(false);
});

it("reclaims a partial-report timeout before removing HOME", async () => {
  const f = gateFixture("partial-hang");
  await expect(verifyPatchBehavior(f.root, { commandTimeoutMs: 400, graceMs: 50, killWaitMs: 1_000 })).rejects.toMatchObject({ kind: "timeout", cleanupConfirmed: true });
  expect(f.nextStarted()).toBe(false);
  expect(existsSync(f.readState().home)).toBe(false);
  expect(existsSync(`${f.root}/insurance`)).toBe(false);
});

it("retains HOME when owned termination is denied", async () => {
  const f = gateFixture("partial-hang");
  const controller = new AbortController();
  const outcome = verifyPatchBehavior(f.root, { signal: controller.signal, graceMs: 50, killWaitMs: 100 }).catch(error => error);
  await ready(f);
  const pid = f.readState().pid;
  const originalKill = process.kill.bind(process);
  const kill = vi.spyOn(process, "kill").mockImplementation((target, signal) => {
    if (target === -pid && signal !== 0) throw Object.assign(new Error("synthetic EPERM"), { code: "EPERM" });
    return originalKill(target, signal);
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    controller.abort();
    expect(await outcome).toMatchObject({ kind: "cancelled", cleanupConfirmed: false });
    expect(existsSync(f.readState().home)).toBe(true);
    expect(JSON.parse(readFileSync(`${f.readState().home}/lifecycle-failure.json`, "utf8"))).toMatchObject({ kind: "cancelled", cleanupConfirmed: false });
    expect(log.mock.calls.flat().join(" ")).toContain("retained temporary data");
    expect(f.nextStarted()).toBe(false);
  } finally {
    kill.mockRestore();
    f.fallback();
    await expect.poll(() => { try { originalKill(-pid, 0); return true; } catch { return false; } }).toBe(false);
  }
});

it("fails removal separately and preserves an earlier command failure", async () => {
  const f = gateFixture("exit7");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  faults.remove = true;
  await expect(verifyPatchBehavior(f.root)).rejects.toMatchObject({ kind: "exit" });
  expect(log.mock.calls.flat().join(" ")).toContain("synthetic removal refusal");
  expect(existsSync(f.readState().home)).toBe(true);
  faults.remove = false;
});

it("fails an otherwise successful gate when temporary removal fails", async () => {
  const f = gateFixture("valid");
  faults.remove = true;
  await expect(verifyPatchBehavior(f.root)).rejects.toThrow("synthetic removal refusal");
  expect(existsSync(f.readState().home)).toBe(true);
  faults.remove = false;
});

it.each(["missing", "empty", "skip", "todo", "failed", "wrong-root", "damaged"])("rejects a %s Vitest report", mode => {
  const root = "/synthetic-checkout";
  const report = { testResults: vitestFiles.map(file => ({ name: `${root}/${file}`, status: "passed", assertionResults: [{ status: "passed" }] })) };
  if (mode === "missing") report.testResults.pop();
  if (mode === "empty") report.testResults[0].assertionResults = [];
  if (["skip", "todo", "failed"].includes(mode)) report.testResults[0].assertionResults[0].status = mode;
  if (mode === "wrong-root") report.testResults[0].name = "/other-checkout/test.ts";
  expect(() => validateVitestReport(mode === "damaged" ? {} : report, root)).toThrow("[behavior]");
});

it("rejects incomplete, empty, skipped, todo, failed and cancelled TAP summaries", () => {
  const good = "# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
  expect(() => validateNodeReport(good, "fixture")).not.toThrow();
  for (const report of ["", "# tests 1\n", good.replace("tests 1", "tests 0"), ...["skipped", "todo", "fail", "cancelled"].map(name => good.replace(`${name} 0`, `${name} 1`))]) {
    expect(() => validateNodeReport(report, "fixture")).toThrow("[behavior]");
  }
});
