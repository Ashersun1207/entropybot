import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, realpathSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { insist, source, unchanged, digest, vitestResults, strictTap } from "./core.mjs";
import { nodeResults } from "./node-results.mjs";
import { PLATFORM_JOBS, executionEnvironment } from "./same-run.mjs";
import { captureExecutionPaths } from "./execution-paths.mjs";
import { beginResourceAudit } from "./resource-audit.mjs";
import { vitestCommand } from "./vitest-command.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function fileIdentity(path) {
  const absolute = resolve(path);
  const resolvedPath = realpathSync.native(absolute);
  return { path: absolute, resolvedPath, target: resolvedPath === absolute ? null : resolvedPath, sha256: digest(readFileSync(absolute)) };
}
export function recordInstall(env = process.env) {
  const before = source(ROOT, env.GITHUB_SHA);
  writeFileSync(join(env.RUNNER_TEMP, "full-gate-install.json"), JSON.stringify({ sourceSha: before.sha, frozen: true, lockHash: digest(readFileSync(join(ROOT, "pnpm-lock.yaml"))) }));
}
export async function platformLane(jobName, env = process.env) {
  const target = PLATFORM_JOBS.find(t => t.name === jobName);
  insist(target && target.platform === env.FULL_GATE_PLATFORM, "unmapped platform job");
  const jobId = Number(env.FULL_GATE_JOB_ID);
  insist(Number.isSafeInteger(jobId) && jobId > 0, "numeric API producer job identity missing");
  const out = join(env.RUNNER_TEMP, "full-gate", jobName);
  mkdirSync(out, { recursive: true });
  const before = source(ROOT, env.GITHUB_SHA);
  const lane = { jobName, jobId, platform: process.platform, sourceSha: before.sha, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, status: "blocked", issues: [], executions: [] };
  const save = () => writeFileSync(join(out, "platform.json"), JSON.stringify(lane));
  if (process.platform !== target.platform) lane.issues.push("actual runner platform mismatch");
  if (process.platform === "win32") lane.issues.push("Windows owned-process containment is unavailable; no test command started");
  if (env.NODE_OPTIONS !== undefined) lane.issues.push("NODE_OPTIONS present in producer environment");
  if (process.platform === "linux") {
    for (const path of ["/usr/bin/bwrap", "/usr/bin/socat", "/usr/bin/flock", "/proc/self/ns/pid", "/proc/sys/kernel/random/boot_id"]) if (!existsSync(path)) lane.issues.push(`missing Linux capability ${path}`);
    lane.issues.push("owned Linux DISPLAY/Xvfb and browser asset qualification is unavailable");
  }
  save();
  insist(lane.issues.length === 0, lane.issues.join("; "));
  const installed = JSON.parse(readFileSync(join(env.RUNNER_TEMP, "full-gate-install.json"), "utf8"));
  insist(installed.sourceSha === before.sha && installed.frozen === true && installed.lockHash === digest(readFileSync(join(ROOT, "pnpm-lock.yaml"))), "frozen source installation receipt missing or stale");
  const declarations = JSON.parse(readFileSync(join(ROOT, "scripts/full-gate/platform-declarations.json"), "utf8")).entries.filter(r => r.class === "executed-in-this-run" && r.targetPlatform === target.platform);
  const nodeFiles = [...new Set(declarations.filter(r => r.file.endsWith(".node-test.mjs")).map(r => r.file))].sort();
  const installation = { ...installed, root: realpathSync(ROOT), tempRoot: realpathSync(env.RUNNER_TEMP), entry: fileIdentity(join(ROOT, "node_modules/vitest/vitest.mjs")), node: fileIdentity(process.execPath), nodeTests: Object.fromEntries(nodeFiles.map(file => [file, fileIdentity(join(ROOT, file))])) };
  lane.installation = installation;
  const home = realpathSync(mkdtempSync(join(env.RUNNER_TEMP, "fg-platform-")));
  const childEnv = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"), OMB_EVAL_LIVE: "0", OMB_VITEST_WORKERS: "1", CI: "true", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", FULL_GATE_TARGET_PLATFORM: target.platform };
  const { GateCommandRunner } = await import("../patch-gate-process.ts");
  const { createGateCapability, gateBootstrapArgs, assertGateLeases } = await import("../testing/verification-lifecycle.ts");
  const capability = createGateCapability(home);
  const commands = [
    { format: "vitest", argv: vitestCommand({ root: ROOT, cwd: ROOT, group: jobName, capability, out, platform: true }).argv },
    ...(nodeFiles.length ? [{ format: "node-events", argv: [process.execPath, ...gateBootstrapArgs(capability), "--test", "--test-concurrency=1", "--test-reporter=tap", `--test-reporter-destination=${join(out, "platform.tap")}`, `--test-reporter=${join(ROOT, "scripts/full-gate/node-reporter.mjs")}`, `--test-reporter-destination=${join(out, "platform-events.jsonl")}`, ...nodeFiles] }] : []),
  ];
  const audit = await beginResourceAudit({ root: ROOT, home, binding: { sourceSha: before.sha, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, group: jobName }, output: join(out, "platform-resource-audit.json") });
  const runner = new GateCommandRunner({ commandTimeoutMs: 900000, overallTimeoutMs: 1650000 });
  try {
    for (const command of commands) {
      unchanged(before, source(ROOT, before.sha));
      const arguments_ = command.format === "vitest" ? [installation.entry.path] : nodeFiles;
      const filesystem = captureExecutionPaths(installation, { cwd: ROOT }, ROOT, arguments_);
      const startedAt = new Date().toISOString();
      writeFileSync(join(out, `${command.format}.start.json`), JSON.stringify({ before, argv: command.argv, env: childEnv, startedAt }));
      const result = await runner.run(process.execPath, command.argv.slice(1), { cwd: ROOT, env: childEnv, forwardOutput: true });
      writeFileSync(join(out, `${command.format}.log`), `${result.stdout}\n${result.stderr}`);
      insist(!result.outputTruncated, "platform command log truncated");
      const filesystemAfter = captureExecutionPaths(installation, { cwd: ROOT }, ROOT, arguments_);
      insist(JSON.stringify(filesystem) === JSON.stringify(filesystemAfter), "execution filesystem identity changed");
      const raw = readFileSync(join(out, command.format === "vitest" ? "platform-report.json" : "platform-events.jsonl"));
      const parsed = command.format === "vitest" ? vitestResults(JSON.parse(raw), ROOT, "platform") : nodeResults(raw.toString(), ROOT, "platform");
      if (command.format === "node-events") {
        const tap = strictTap(readFileSync(join(out, "platform.tap"), "utf8"));
        insist(tap.tests === parsed.total && tap.pass === parsed.passed && tap.skipped === parsed.skipped, "platform TAP/events mismatch");
      }
      const after = source(ROOT, before.sha);
      unchanged(before, after);
      const reportHash = digest(raw);
      writeFileSync(join(out, `${reportHash}.${command.format === "vitest" ? "json" : "jsonl"}`), raw);
      for (const row of declarations.filter(r => r.file.endsWith(".node-test.mjs") === (command.format === "node-events"))) {
        insist(parsed.tests.some(t => t.file === row.file && t.fullName === row.fullName && t.status === "passed"), `platform assertion not executed: ${row.file} ${row.fullName}`);
        const assertion = { group: row.group, file: row.file, fullName: row.fullName, status: "passed" };
        const receipt = { schemaVersion: 2, kind: "execution-receipt", id: `this-run:${jobName}:${digest(JSON.stringify(assertion))}`, jobName, jobId, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, sourceSha: before.sha, platform: target.platform, report: { sha256: reportHash, root: ROOT, format: command.format }, assertion, entry: command.format === "vitest" ? installation.entry : installation.nodeTests[row.file], source: { before: { sha: before.sha, tree: before.tree, clean: true }, after: { sha: after.sha, tree: after.tree, clean: true } }, command: { argv: command.argv, cwd: ROOT, env: childEnv, exitCode: 0, signal: null, timedOut: false, retries: 0 }, isolation: { home }, filesystem, startedAt, finishedAt: new Date().toISOString() };
        executionEnvironment(receipt, installation);
        lane.executions.push({ receipt, reportHash });
      }
      save();
    }
    assertGateLeases(capability, [...new Set(declarations.map(r => join(ROOT, r.file)))]);
    lane.resourceAudit = await audit.finish();
    lane.issues.push("independent detached-resource confirmation domain incomplete; same-run platform receipt acceptance blocked");
    save();
    insist(false, lane.issues.join("; "));
  } finally { await runner.close(); await audit.finish(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { if (process.argv[2] === "record-install") recordInstall(); else await platformLane(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
