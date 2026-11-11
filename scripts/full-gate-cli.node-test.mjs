import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { ROOT } from "./full-gate/runner.mjs";
import { producerClosure } from "./full-gate/trust.mjs";
import { testCommand } from "./full-gate/evidence-records.mjs";
import { strictConfig } from "./full-gate/strict-config.mjs";

const evidence = process.env.FULL_GATE_CLI_EVIDENCE;
test("strict config changes only the runner and retains project settings", () => {
  const base = { plugins: [{ name: "fixture" }], resolve: { alias: { fixture: "/owned" } }, test: { include: ["all/**/*.test.ts"], exclude: ["ignored"], setupFiles: ["setup.ts"], sequence: { sequencer: class {} }, runner: "ci-retry", retry: 2 } };
  const result = strictConfig(base);
  assert.deepEqual(result, { ...base, test: { ...base.test, runner: join(ROOT, "scripts/full-gate/strict-runner.ts") } });
});

test("installed Vitest accepts production commands, preserves setup/plugins/discovery and enforces strict policy", { timeout: 120000 }, async () => {
  assert.equal(JSON.parse(readFileSync(join(ROOT, "node_modules/vitest/package.json"))).version, "4.1.11");
  const root = realpathSync(mkdtempSync(join(evidence ?? tmpdir(), "fg-cli-")));
  let serial = 0;
  try {
    for (const file of [...producerClosure(ROOT), "scripts/testing/ci-retry-runner.ts", "scripts/testing/ci-retry-list.mjs"]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      cpSync(join(ROOT, file), join(root, file));
    }
    symlinkSync(realpathSync(join(ROOT, "node_modules")), join(root, "node_modules"));
    const control = join(root, "cloudflare/control-plane");
    symlinkSync(join(root, "node_modules"), join(control, "node_modules"));
    const { createGateCapability } = await import(pathToFileURL(join(root, "scripts/testing/verification-lifecycle.ts")));
    const { vitestCommand } = await import(pathToFileURL(join(root, "scripts/full-gate/vitest-command.mjs")));
    const home = join(root, "home"); mkdirSync(home);
    const capability = createGateCapability(home);
    const env = { PATH: dirname(process.execPath) + ":/usr/bin:/bin", HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"), OMB_EVAL_LIVE: "0", CI: "true", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", FULL_GATE_TARGET_PLATFORM: "linux" };
    function hashes() {
      const files = [...producerClosure(root), "scripts/testing/ci-retry-runner.ts", "scripts/testing/ci-retry-list.mjs", "setup.mjs", "node_modules/vitest/vitest.mjs", "node_modules/vitest/package.json"];
      for (const [directory] of bases) for (let index = 0; index < (directory === root ? 10 : 2); index++) files.push(join(directory, `owned/${index}.test.mjs`));
      return Object.fromEntries(files.map(file => { const path = file.startsWith("/") ? file : join(root, file); return [path, { realpath: realpathSync(path), sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }]; }));
    }
    function run(argv, cwd = root) {
      const before = hashes();
      const startedAt = new Date().toISOString();
      const result = spawnSync(argv[0], argv.slice(1), { cwd, env, encoding: "utf8", timeout: 20000 });
      const finishedAt = new Date().toISOString();
      const record = { argv, cwd, env, before, after: hashes(), startedAt, finishedAt, exitCode: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
      assert.deepEqual(record.after, before);
      if (evidence) writeFileSync(join(evidence, `cli-${++serial}.json`), JSON.stringify(record, null, 2));
      assert.equal(result.error, undefined);
      return record;
    }
    const setup = join(root, "setup.mjs");
    writeFileSync(setup, `import { consumeGateCapability } from ${JSON.stringify(pathToFileURL(join(root, "scripts/testing/verification-lifecycle.ts")).href)}; if (!consumeGateCapability()) throw new Error('Worker bootstrap missing'); globalThis.fullGateSetup = 'loaded';\n`);
    function base(directory, runner = "") {
      return `export default { root: ${JSON.stringify(directory)}, plugins: [{name:'owned-plugin', resolveId(id) { if(id === 'virtual:owned') return '\\0owned'; }, load(id) { if(id === '\\0owned') return 'export default 42'; }}], test: { include: ['owned/**/*.test.mjs'], setupFiles: [${JSON.stringify(setup)}]${runner ? `, runner: ${JSON.stringify(runner)}` : ""} } };\n`;
    }
    const bases = [[root, "vite.config.ts"], [join(root, "cloudflare/composio-broker"), "cloudflare/composio-broker/vitest.config.ts"], [control, "cloudflare/control-plane/vitest.config.ts"]];
    for (const [directory, file] of bases) {
      writeFileSync(join(root, file), base(directory, join(root, "scripts/testing/ci-retry-runner.ts")));
      mkdirSync(join(directory, "owned"), { recursive: true });
    }
    function fixtures(options = "") {
      for (const [directory] of bases) for (let index = 0; index < (directory === root ? 10 : 2); index++) {
        writeFileSync(join(directory, `owned/${index}.test.mjs`), `import { test, expect } from 'vitest'; import value from 'virtual:owned'; test('owned ${index}', ${options ? `${options}, ` : ""}() => { expect(globalThis.fullGateSetup).toBe('loaded'); expect(value).toBe(42); });\n`);
      }
    }
    fixtures();
    writeFileSync(join(root, "scripts/full-gate/platform-declarations.json"), JSON.stringify({ entries: [{ class: "executed-in-this-run", targetPlatform: "linux", file: "owned/0.test.mjs" }, { class: "executed-in-this-run", targetPlatform: "linux", file: "owned/1.test.mjs" }] }));
    const lanes = [["main-vitest-01", root, false, 10, 1], ["broker-vitest", root, false, 2, 2], ["control-plane-vitest", control, false, 2, 2], ["broker-vitest", root, true, 10, 10]];
    for (const [group, cwd, platform, discovered, total] of lanes) {
      const out = join(root, `out-${group}-${platform}`); mkdirSync(out);
      const command = vitestCommand({ root, cwd, group, capability, out, platform });
      assert.deepEqual(testCommand({ command: { argv: command.argv, cwd }, platform: process.platform, report: { root, format: "vitest" } }), [join(cwd, "node_modules/vitest/vitest.mjs")]);
      for (const config of ["arbitrary.config.mjs", "--config=arbitrary.config.mjs"]) {
        const bad = [...command.argv]; bad[bad.indexOf("--config") + 1] = config;
        assert.throws(() => testCommand({ command: { argv: bad, cwd }, platform: process.platform, report: { root, format: "vitest" } }));
      }
      const listed = run(command.list, cwd); assert.equal(listed.exitCode, 0, listed.stderr);
      const directory = platform || group.startsWith("main-") ? root : group === "broker-vitest" ? bases[1][0] : control;
      assert.deepEqual(JSON.parse(listed.stdout).map(row => row.file).sort(), Array.from({ length: discovered }, (_, index) => join(directory, `owned/${index}.test.mjs`)).sort());
      const passed = run(command.argv, cwd); assert.equal(passed.exitCode, 0, passed.stderr);
      const reportPath = join(out, platform ? "platform-report.json" : "report.json");
      assert.equal(JSON.parse(readFileSync(reportPath)).numPassedTests, total);
      fixtures("{ retry: 1 }");
      const rejected = run(command.argv, cwd); assert.equal(rejected.exitCode, 1);
      assert.match(rejected.stderr + readFileSync(reportPath), /Full gate forbids retries/);
      fixtures();
    }
    fixtures("{ retry: 1 }");
    for (const runner of ["", join(root, "scripts/testing/ci-retry-runner.ts")]) {
      writeFileSync(join(root, "cloudflare/composio-broker/vitest.config.ts"), base(bases[1][0], runner));
      const out = join(root, runner ? "ci-control" : "default-control"); mkdirSync(out);
      const { argv } = vitestCommand({ root, cwd: root, group: "broker-vitest", capability, out });
      argv[argv.indexOf("--config") + 1] = join(root, "cloudflare/composio-broker/vitest.config.ts");
      const controlResult = run(argv);
      assert.equal(controlResult.exitCode, 0, controlResult.stderr);
    }
    fixtures();
    const out = join(root, "negative"); mkdirSync(out);
    const command = vitestCommand({ root, cwd: root, group: "broker-vitest", capability, out });
    for (const option of ["--retry=1", "--testNamePattern=owned", "--passWithNoTests"]) {
      const negative = run([...command.argv, option]); assert.equal(negative.exitCode, 1);
      assert.match(negative.stderr + readFileSync(join(out, "report.json")), /Full gate forbids retries/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
