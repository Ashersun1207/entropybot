import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, rmSync, realpathSync, writeFileSync, symlinkSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { digest, safeArgv, vitestResults, source, unchanged } from "../full-gate/core.mjs";
import { createGateCapability } from "../testing/verification-lifecycle.ts";
import { validateResourceAudit } from "../full-gate/resource-audit.mjs";
import { applicationCommands, APPLICATION_GROUPS, diagnosticDispositions, reconcileDiagnostic, applicationCoverage, loadSkipCatalog, SKIP_CATALOG_LIMIT } from "./application-contract.mjs";
import { provisionDiagnosticCache } from "./application.mjs";
import { inventory } from "./contract.mjs";
const root = resolve(import.meta.dirname, "../..");
const binding = { sourceSha: "a".repeat(40), runId: "42", attempt: "1" };
const policy = JSON.parse(readFileSync(join(root, "scripts/full-gate/policy.json")));
const { catalog } = loadSkipCatalog();
const tests = catalog.entries.map((row, index) => ({ group: row.file.endsWith(".node-test.mjs") ? "electron-node" : `main-vitest-${String(index % 10 + 1).padStart(2, "0")}`, file: row.file, fullName: row.fullName, status: "skipped" }));
const bundle = () => diagnosticDispositions(tests, catalog, root, binding);
const check = (value, rows = tests) => reconcileDiagnostic(rows, value, binding, policy, catalog);
for (const kind of ["regular", "symlink", "oversized", "fifo"]) test(`public catalog loader ${kind} control under external watchdog`, () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "ma-catalog-")));
  const path = join(home, "catalog.json");
  try {
    const original = join(root, "scripts/macos-qualification/skip-declarations.json");
    if (kind === "regular") writeFileSync(path, readFileSync(original));
    else if (kind === "symlink") symlinkSync(original, path);
    else if (kind === "oversized") writeFileSync(path, Buffer.alloc(SKIP_CATALOG_LIMIT + 1, 32));
    else execFileSync("/usr/bin/mkfifo", [path]);
    const module = new URL("./application-contract.mjs", import.meta.url).href;
    const code = `import {loadSkipCatalog} from ${JSON.stringify(module)}; console.log('before-read'); try { const loaded=loadSkipCatalog(${JSON.stringify(path)}); console.log('accepted:'+loaded.catalog.entries.length); } catch(error) { console.log('domain-reject:'+error.message); }`;
    const argv = ["--input-type=module", "-e", code];
    const env = { PATH: "/usr/bin:/bin", HOME: home, OMB_EVAL_LIVE: "0" };
    const startedAt = new Date().toISOString();
    const result = spawnSync(process.execPath, argv, {
      cwd: root, env, encoding: "utf8", timeout: 3000, killSignal: "SIGKILL",
    });
    const finishedAt = new Date().toISOString();
    assert.equal(result.error, undefined, `external watchdog/startup failure: ${result.stderr}`);
    assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null);
    assert.match(result.stdout, /before-read/);
    if (kind === "regular") assert.match(result.stdout, /accepted:280/);
    else {
      assert.doesNotMatch(result.stdout, /accepted:/);
      assert.match(result.stdout, /domain-reject:.*(?:ELOOP|bounded regular file|1 MiB)/);
    }
    assert.throws(() => process.kill(result.pid, 0), { code: "ESRCH" });
    if (process.env.MAC_CATALOG_EVIDENCE) writeFileSync(join(process.env.MAC_CATALOG_EVIDENCE, `loader-${kind}.json`), JSON.stringify({ argv: [process.execPath, ...argv], cwd: root, env, startedAt, finishedAt, externalWatchdogMs: 3000, stdout: result.stdout, stderr: result.stderr, exitCode: result.status, signal: result.signal, pid: result.pid, reaped: true }, null, 2), { flag: "wx" });
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test("catalog shape validates on load and the same parsed snapshot survives removal of its original path", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "ma-catalog-shape-")));
  const path = join(home, "catalog.json");
  try {
    const bytes = readFileSync(join(root, "scripts/macos-qualification/skip-declarations.json"));
    writeFileSync(path, bytes);
    const loaded = loadSkipCatalog(path);
    assert.equal(Buffer.isBuffer(loaded.bytes), true); assert.deepEqual(loaded.bytes, bytes);
    assert.equal(digest(loaded.bytes), digest(bytes));
    unlinkSync(path);
    const dispositions = diagnosticDispositions(tests, loaded.catalog, root, binding);
    assert.equal(reconcileDiagnostic(tests, dispositions, binding, policy, loaded.catalog).skipped, 280);
    for (const value of [null, {}, { ...catalog, entries: null }, { ...catalog, entries: [null] }, { ...catalog, entries: [{ ...catalog.entries[0], sourceHash: "wrong" }] }]) {
      writeFileSync(path, JSON.stringify(value));
      assert.throws(() => loadSkipCatalog(path), /catalog.*shape/);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test("historical 280 declarations bind unchanged sources, actual groups and all three honest classes", () => {
  const result = check(bundle());
  assert.equal(tests.length, 280);
  assert.deepEqual([result.total, result.passed, result.skipped, result.failed, result.todo], [280, 0, 280, 0, 0]);
  assert.equal(result.formalDispositionAcceptance, false);
  assert.equal(result.strictGreen, false);
  const counts = Object.fromEntries(["platform-specific", "environment-not-provisioned", "policy-prohibited"].map(c => [c, bundle().entries.filter(e => e.class === c).length]));
  assert.deepEqual(Object.values(counts), [73, 203, 4]);
});
for (const [name, mutate] of [
  ["undeclared", b => b.entries.pop()],
  ["extra", b => b.entries.push({ ...b.entries[0], fullName: "extra" })],
  ["duplicate", b => { b.entries[1] = b.entries[0]; }],
  ["mismatched group", b => { b.entries[0].group = "main-vitest-99"; }],
  ["mismatched name", b => { b.entries[0].fullName += " wrong"; }],
  ["invalid class", b => { b.entries[0].class = "passed"; }],
  ["multiple classes", b => { b.entries[0].classes = ["policy-prohibited"]; }],
  ["B relabeled as policy", b => { b.entries.find(e => e.class === "environment-not-provisioned").class = "policy-prohibited"; }],
  ["missing B capability", b => { b.entries.find(e => e.class === "environment-not-provisioned").missingCapability = null; }],
  ["A target Darwin", b => { b.entries.find(e => e.class === "platform-specific").targetPlatform = "darwin"; }],
  ["A fake evidence", b => { b.entries.find(e => e.class === "platform-specific").targetEvidence = "passed"; }],
  ["C absent policy", b => { b.entries.find(e => e.class === "policy-prohibited").policyRef = null; }],
  ["C foreign policy", b => { b.entries.find(e => e.class === "policy-prohibited").policyRef = "scripts/full-gate/policy.json#policyExclusions/99"; }],
  ["C wrong reason", b => { b.entries.find(e => e.class === "policy-prohibited").reason = "environment missing"; }],
  ["source mismatch", b => { b.sourceSha = "b".repeat(40); }],
  ["run mismatch", b => { b.runId = "43"; }],
  ["rerun", b => { b.attempt = "2"; }],
  ["bad source reference", b => { b.entries[0].evidenceRef = "unresolved"; }],
]) test(`diagnostic reconciliation rejects ${name}`, () => { const b = bundle(); mutate(b); assert.throws(() => check(b)); });
test("no fabricated skip/pass, changed source, undeclared assertion or duplicate declaration", () => {
  assert.throws(() => check(bundle(), tests.map((t, i) => i ? t : { ...t, status: "passed" })));
  for (const status of ["failed", "todo", "pending"]) assert.throws(() => check(bundle(), tests.map((t, i) => i ? t : { ...t, status })));
  assert.throws(() => diagnosticDispositions([{ ...tests[0], fullName: "new unknown skip" }], catalog, root, binding), /undeclared/);
  const altered = structuredClone(catalog); altered.entries[0].sourceHash = "b".repeat(64);
  assert.throws(() => diagnosticDispositions(tests, altered, root, binding), /source changed/);
  altered.entries = [...catalog.entries, catalog.entries[0]];
  assert.throws(() => diagnosticDispositions(tests, altered, root, binding), /duplicate/);
  const passed = [{ ...tests[0], status: "passed" }];
  assert.equal(check(diagnosticDispositions(passed, catalog, root, binding), passed).skipped, 0);
});
test("real public builder selects all ten original strict adapters, shards and Node reporters without selection flags", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "ma-command-")));
  try {
    const capability = createGateCapability(home, { ...binding, group: "main-vitest-01" });
    for (const [i, group] of APPLICATION_GROUPS.slice(0, 10).entries()) {
      const command = applicationCommands({ root, group, capability, out: home });
      safeArgv(command.argv);
      assert.deepEqual(command.list.slice(2, 5), ["list", "--filesOnly", "--json"]);
      assert.equal(command.argv.at(-1), `--shard=${i + 1}/10`);
      assert.equal(command.argv[command.argv.indexOf("--config") + 1], join(root, "scripts/full-gate/main-vitest.config.mjs"));
      assert.equal(command.list.includes("run"), false);
      assert.equal(command.argv.includes("run"), true);
      for (const flag of ["--retry=1", "--passWithNoTests", "--testNamePattern=a"]) assert.throws(() => safeArgv([...command.argv, flag]));
    }
    const files = ["electron/synthetic.node-test.mjs"];
    const node = applicationCommands({ root, group: "electron-node", capability, out: home, files }).commands[0];
    assert.equal(node.includes("--test"), true); assert.deepEqual(node.slice(-1), files);
    assert.equal(node.includes(`--test-reporter=${join(root, "scripts/full-gate/node-reporter.mjs")}`), true);
    const commands = applicationCommands({ root, group: "static-checks", capability, out: home }).commands;
    assert.equal(commands.length, 7);
    assert.deepEqual(commands.at(-1), [process.execPath, "scripts/check-patches.mjs", "--verify"]);
    assert.throws(() => applicationCommands({ root, group: "electron-node", capability, out: home, files: [] }));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test("coverage uses report identities, requires all lanes, disjoint shards and full Node entries", () => {
  const records = APPLICATION_GROUPS.map((group, i) => group.startsWith("main-") ? { group, discovered: Array.from({ length: 10 }, (_, j) => `file${j}`), files: [`file${i}`] } : group === "electron-node" ? { group, files: ["a.node-test.mjs"], discovered: ["a.node-test.mjs"] } : { group, commands: 7 });
  applicationCoverage(records);
  for (const mutate of [r => r.pop(), r => { r[1].files = r[0].files; }, r => { r[0].discovered.pop(); }, r => { r[10].files = ["extra.node-test.mjs"]; }, r => { r[11].commands = 6; }]) {
    const r = structuredClone(records); mutate(r); assert.throws(() => applicationCoverage(r));
  }
});
test("public parser never counts skips as passes and rejects retry/failure/todo report claims", () => {
  const report = { success: true, numTotalTests: 2, numPassedTests: 1, numPendingTests: 1, numFailedTests: 0, numTodoTests: 0, numFailedTestSuites: 0, numPendingTestSuites: 0,
    testResults: [{ name: join(root, "synthetic.test.ts"), status: "passed", assertionResults: [{ fullName: "pass", status: "passed" }, { fullName: "skip", status: "skipped" }] }] };
  assert.equal(vitestResults(report, root, "main-vitest-01").skipped, 1);
  for (const mutate of [r => { r.numPassedTests = 2; }, r => { r.numTodoTests = 1; }, r => { r.numFailedTests = 1; }, r => { r.testResults[0].assertionResults[0].retryCount = 1; }]) { const r = structuredClone(report); mutate(r); assert.throws(() => vitestResults(r, root, "main-vitest-01")); }
});
test("cache outputs are outside dependencies, original link inventory remains bound and existing paths reject", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "ma-cache-")));
  try {
    const checkout = join(home, "checkout"); mkdirSync(checkout); mkdirSync(join(checkout, "node_modules"));
    const links = provisionDiagnosticCache(checkout, home);
    assert.equal(links.length, 2);
    const inv = inventory(join(checkout, "node_modules"));
    assert.equal(inv.rows.every(row => typeof row.link === "string"), true);
    assert.throws(() => provisionDiagnosticCache(checkout, home));
    assert.equal(digest(JSON.stringify(inv.rows)), inv.sha256);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test("resource validator rejects diagnostic claims lacking actual audit snapshots or matching source binding", () => {
  assert.throws(() => validateResourceAudit({ status: "clear-observed-domain", completeCleanup: false }, { ...binding, group: "main-vitest-01" }));
  const sha = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const current = source(root, sha);
  unchanged(current, source(root, sha));
  assert.throws(() => unchanged(current, { ...current, hash: "b".repeat(64) }));
});
