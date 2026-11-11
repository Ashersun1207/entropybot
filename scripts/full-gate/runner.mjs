import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GROUPS, insist, exact, source, unchanged, safeArgv, vitestResults, strictTap, digest, nodeFiles } from "./core.mjs";
import { nodeResults } from "./node-results.mjs";
import { proposedDispositions } from "./dispositions.mjs";
import { preflight } from "./preflight.mjs";
import { beginResourceAudit } from "./resource-audit.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ASSETS = "/opt/entropybot-full-gate";
export function environment(home, path) {
  const chrome = `${ASSETS}/chrome/Google Chrome.app/Contents/MacOS/Google Chrome`;
  const browser = `${ASSETS}/bin/agent-browser`;
  return {
    PATH: path, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"),
    OMB_EVAL_LIVE: "0", OMB_UI_E2E: "1", OMB_VITEST_WORKERS: "2", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    OMB_AGENT_BROWSER_PATH: browser, AGENT_BROWSER_EXECUTABLE_PATH: chrome, OMB_CHROME_PATH: chrome,
    OMB_CDP_CHROME: chrome, OMB_RELOAD_CHROME: chrome, OMB_TEST_AGENT_BROWSER: browser, OMB_TEST_CHROME: chrome,
    OMB_CREATE_SCOPE_BROWSER_BINARY: browser, OMB_CREATE_SCOPE_BROWSER_CHROME: chrome,
    OMB_STOP_BROWSER_E2E: "1", OMB_STOP_BROWSER_BINARY: browser, OMB_STOP_BROWSER_CHROME: chrome,
    OMB_FIXTURE_HOME_CHROME: chrome, OMB_FIXTURE_HOME_BINARY: browser, OMB_TEAM_BROWSER_E2E: "1",
    OMB_EMAIL_REAL_TEST: "1", NODE_EXTRA_CA_CERTS: `${ASSETS}/mail/ca.pem`,
    OMB_UI_CHROMIUM: chrome, OMB_UI_PLAYWRIGHT_CORE: `${ASSETS}/playwright-core`, OMB_UI_DIST: `${ASSETS}/dist`, OMB_WEB_APP_BUILD: `${ASSETS}/dist`,
    OMB_CLINE_NATIVE_PATH: `${ASSETS}/bin/cline`, OMB_OPENCODE_E2E_CLI: `${ASSETS}/bin/opencode1`, OMB_OPENCODE2_E2E_CLI: `${ASSETS}/bin/opencode2`,
  };
}
export function provenance(env) {
  insist(env.GITHUB_REPOSITORY === "Ashersun1207/entropybot", "foreign repository");
  insist(env.GITHUB_EVENT_NAME === "workflow_dispatch" && env.GITHUB_RUN_ATTEMPT === "1", "event or attempt mismatch");
  insist(Number(process.versions.node.split(".")[0]) >= 24, "Node 24 required");
  return source(ROOT, env.GITHUB_SHA);
}
export async function lane(group, env = process.env) {
  insist([...GROUPS, "static-checks"].includes(group), "unknown lane");
  const before = provenance(env);
  if (env.FULL_GATE_PLATFORM) {
    const { platformLane } = await import("./platform.mjs");
    await platformLane(group, env);
  }
  const out = join(env.RUNNER_TEMP, "full-gate", group);
  mkdirSync(out, { recursive: true });
  const home = realpathSync(mkdtempSync(join(env.RUNNER_TEMP, "fg-home-")));
  const childEnv = environment(home, `${ASSETS}/bin:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`);
  const { GateCommandRunner } = await import("../patch-gate-process.ts");
  const { createGateCapability, gateBootstrapArgs, gateVitestWorkerArg, assertGateLeases } = await import("../testing/verification-lifecycle.ts");
  const capability = createGateCapability(home);
  let serial = 0;
  const run = async (argv, cwd = ROOT, timeoutMs = 1500000) => {
    unchanged(before, source(ROOT, env.GITHUB_SHA));
    const prefix = join(out, String(++serial));
    const receipt = { argv, cwd, before, started: new Date().toISOString() };
    writeFileSync(`${prefix}.start.json`, JSON.stringify(receipt));
    try {
      const result = await runner.run(argv[0], argv.slice(1), { cwd, env: childEnv, timeoutMs, forwardOutput: true, onStdout: chunk => appendFileSync(`${prefix}.stdout.log`, chunk) });
      writeFileSync(`${prefix}.stdout.log`, result.stdout);
      writeFileSync(`${prefix}.stderr.log`, result.stderr);
      insist(!result.outputTruncated, "truncated command log");
      unchanged(before, source(ROOT, env.GITHUB_SHA));
      writeFileSync(`${prefix}.finish.json`, JSON.stringify({ ...receipt, ended: new Date().toISOString(), exitCode: 0, evidence: result.evidence }));
      return result.stdout;
    } catch (error) {
      writeFileSync(`${prefix}.failure.json`, JSON.stringify({ ...receipt, ended: new Date().toISOString(), error: String(error), evidence: error.evidence, ownedGroupStopped: runner.ownedGroupStopped }));
      throw error;
    }
  };
  const snapshots = phase => writeFileSync(join(out, `processes-${phase}.log`), execFileSync("ps", ["-axo", "pid,ppid,pgid,etime,command"], { encoding: "utf8", timeout: 10000 }));
  const auditPath = join(out, "resource-audit.json");
  const audit = await beginResourceAudit({ root: ROOT, home, binding: { sourceSha: before.sha, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, group }, output: auditPath });
  const runner = new GateCommandRunner({ commandTimeoutMs: 1500000, overallTimeoutMs: group === "static-checks" ? 5000000 : 1650000 });
  try {
    snapshots("before");
    if (group.startsWith("main-vitest-")) {
      const trust = JSON.parse(readFileSync(join(ROOT, "scripts/full-gate/disposition-trust.json"), "utf8"));
      const result = preflight(childEnv, { approvals: trust.assetHashes, tempRoot: env.RUNNER_TEMP });
      writeFileSync(join(out, "preflight.json"), JSON.stringify(result));
      insist(result.ready, result.issues.join("; "));
    }
    if (group === "static-checks") {
      for (const argv of [["git", "diff", "--check"], ["node_modules/.bin/oxlint", "--deny-warnings", "."], ["node_modules/.bin/tsc", "-p", "tsconfig.tools.json"], ["node_modules/.bin/tsc", "-b"], ["node_modules/.bin/tsc", "-p", "tsconfig.server.json"], [process.execPath, "scripts/entropybot-release.mjs", "check"], [process.execPath, "scripts/check-patches.mjs", "--verify"]]) await run(argv, ROOT, argv.at(-1) === "--verify" ? 900000 : 600000);
      writeFileSync(join(out, "static.json"), JSON.stringify({ before, after: source(ROOT, env.GITHUB_SHA), commands: serial, success: true }));
      return;
    }
    const isMain = group.startsWith("main-vitest-");
    const cwd = group === "control-plane-vitest" ? join(ROOT, "cloudflare/control-plane") : ROOT;
    const config = isMain ? "vite.config.ts" : group === "broker-vitest" ? "cloudflare/composio-broker/vitest.config.ts" : "vitest.config.ts";
    const vitest = join(cwd, "node_modules/vitest/vitest.mjs");
    let files;
    let discovered;
    let argv;
    let report;
    let tests;
    if (group === "electron-node") {
      files = nodeFiles(ROOT);
      insist(files.length > 0, "no Node files");
      argv = [process.execPath, ...gateBootstrapArgs(capability), "--test", "--test-concurrency=2", "--test-reporter=tap", `--test-reporter-destination=${join(out, "report.tap")}`, `--test-reporter=${join(ROOT, "scripts/full-gate/node-reporter.mjs")}`, `--test-reporter-destination=${join(out, "node-events.jsonl")}`, ...files];
      safeArgv(argv);
      await run(argv);
      const totals = strictTap(readFileSync(join(out, "report.tap"), "utf8"));
      const parsed = nodeResults(readFileSync(join(out, "node-events.jsonl"), "utf8"), ROOT, group);
      insist(parsed.total === totals.tests && parsed.passed === totals.pass && parsed.skipped === totals.skipped, "TAP/event totals mismatch");
      tests = parsed.tests;
      exact(parsed.files, files, "Node per-test file coverage");
    } else {
      const list = [process.execPath, vitest, "list", "--filesOnly", "--json", "--config", config];
      discovered = JSON.parse(await run(list, cwd));
      insist(Array.isArray(discovered) && discovered.length > 0 && discovered.every(f => typeof f.file === "string" && !f.projectName), "invalid Vitest discovery");
      discovered = discovered.map(f => resolve(cwd, f.file).slice(ROOT.length + 1)).sort();
      argv = [process.execPath, ...gateBootstrapArgs(capability), vitest, "run", "--config", config, "--runner", join(ROOT, "scripts/full-gate/strict-runner.ts"), gateVitestWorkerArg(capability), "--maxWorkers", isMain ? "2" : "1", "--reporter=json", `--outputFile=${join(out, "report.json")}`];
      if (isMain) argv.push(`--shard=${Number(group.slice(-2))}/10`);
      safeArgv(argv);
      await run(argv, cwd, isMain ? 1500000 : group === "broker-vitest" ? 300000 : 600000);
      report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
      const parsed = vitestResults(report, ROOT, group);
      files = parsed.files;
      tests = parsed.tests;
      if (!isMain) exact(files, discovered, group);
    }
    const catalog = JSON.parse(readFileSync(join(ROOT, "scripts/full-gate/platform-declarations.json"), "utf8"));
    const declarations = catalog.entries.filter(row => digest(readFileSync(join(ROOT, row.file))) === row.sourceHash);
    const proposed = proposedDispositions(tests, { sourceSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID }, declarations);
    writeFileSync(join(out, "platform-dispositions.json"), JSON.stringify(proposed, null, 2));
    writeFileSync(join(out, "test-identities.json"), JSON.stringify(tests));
    assertGateLeases(capability, files.map(f => join(ROOT, f)));
    const after = source(ROOT, env.GITHUB_SHA);
    unchanged(before, after);
    snapshots("after");
    await audit.finish();
    const resourceAuditHash = digest(readFileSync(auditPath));
    writeFileSync(join(out, "receipt.json"), JSON.stringify({ group, sha: env.GITHUB_SHA, attempt: env.GITHUB_RUN_ATTEMPT, argv, files, discovered, before, after, exitCode: 0, timedOut: false, reportHash: digest(readFileSync(join(out, group === "electron-node" ? "report.tap" : "report.json"))), isolation: { syntheticHome: true, fakeEngines: true, live: "0" }, resources: { leasesVerified: true, ownedGroupStopped: runner.ownedGroupStopped, processAudit: "unknown", resourceAuditHash } }));
    insist(false, "independent detached-resource confirmation domain incomplete; narrowed audit evidence retained");
  } finally { await runner.close(); await audit.finish(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  lane(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
