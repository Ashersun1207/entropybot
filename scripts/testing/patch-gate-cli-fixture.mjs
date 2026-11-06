import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { once } from "node:events";
import { expect, onTestFinished } from "vitest";
import { repositoryRoot } from "../check-patches.mjs";
import { inventory, vitestFiles, nodeTestFiles } from "../patch-contracts.mjs";

export function gateFixture(mode) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gate-cli-fixture-")));
  const children = [];
  const retired = new Set();
  const readState = () => JSON.parse(readFileSync(join(root, "observed.json"), "utf8"));
  const killGroup = pid => {
    if (retired.has(pid)) return;
    if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) throw new Error("Invalid fixture process group");
    try { process.kill(-pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    retired.add(pid);
  };
  const fallback = () => {
    if (existsSync(join(root, "observed.json"))) {
      const state = readState();
      if (!existsSync(join(root, "command-done"))) killGroup(state.pid);
    }
    for (const { child } of children) if (child.exitCode === null && child.signalCode === null) killGroup(child.pid);
  };
  onTestFinished(async () => {
    fallback();
    for (const { closed, timer } of children) { await closed; clearTimeout(timer); }
    for (const pid of retired) await expect.poll(() => {
      try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; }
    }, { timeout: 1_000 }).toBe(false);
    if (existsSync(join(root, "observed.json"))) {
      const state = readState();
      if (existsSync(state.home)) rmSync(state.home, { recursive: true, force: true });
    }
    rmSync(root, { recursive: true, force: true });
  });
  for (const file of new Set([...inventory, ...vitestFiles, ...nodeTestFiles, "scripts/check-patches.mjs", "scripts/patch-contracts.mjs", "scripts/patch-gate-process.ts"])) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), readFileSync(join(repositoryRoot, file)));
  }
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  mkdirSync(join(root, "node_modules/vitest"), { recursive: true });
  for (const dependency of ["typescript", "yaml"]) symlinkSync(join(repositoryRoot, "node_modules", dependency), join(root, "node_modules", dependency), "junction");
  const script = `
    import { writeFileSync } from 'node:fs';
    import { join, resolve } from 'node:path';
    import { vitestFiles } from '../../scripts/patch-contracts.mjs';
    const root = process.cwd();
    const mode = ${JSON.stringify(mode)};
    const report = process.argv.find(arg => arg.startsWith('--outputFile.json=')).slice('--outputFile.json='.length);
    const state = { pid: process.pid, home: process.env.HOME, cwd: root,
      leaked: ['GATE_SYNTHETIC_API_KEY', 'OMB_DATA_DIR', 'NODE_OPTIONS'].some(key => key in process.env) };
    writeFileSync(join(root, 'observed.json'), JSON.stringify(state));
    process.on('exit', () => writeFileSync(join(root, 'command-done'), 'done'));
    if (mode === 'hang' || mode === 'partial-hang') {
      if (mode === 'partial-hang') writeFileSync(report, '{');
      process.on('SIGTERM', () => {
        writeFileSync(join(root, 'received-term'), 'term');
        if (mode === 'hang') process.exit(0);
      });
      setTimeout(() => { writeFileSync(join(root, 'insurance'), 'insurance'); process.exit(90); }, 8000);
    } else if (mode === 'exit7') process.exitCode = 7;
    else if (mode === 'bad-json') writeFileSync(report, '{');
    else if (mode !== 'missing-report') writeFileSync(report, JSON.stringify({ testResults: vitestFiles.map(file => ({
      name: resolve(root, file), status: 'passed', assertionResults: [{status:'passed'}]
    })) }));
  `;
  writeFileSync(join(root, "node_modules/vitest/vitest.mjs"), script);
  for (const file of nodeTestFiles) writeFileSync(join(root, file), `import test from 'node:test'; import { appendFileSync } from 'node:fs';
    test('synthetic gate suite', () => appendFileSync(${JSON.stringify(join(root, "next-suites"))}, ${JSON.stringify(file + "\n")}));`);
  const cli = (entry = join(root, "scripts/check-patches.mjs")) => {
    const child = spawn(process.execPath, [entry, "--verify"], { cwd: tmpdir(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const closed = once(child, "close");
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const timer = setTimeout(fallback, 6_000);
    children.push({ child, closed, timer });
    return { child, done: closed.then(([code, signal]) => { clearTimeout(timer); return { code, signal, stdout, stderr }; }) };
  };
  return { root, readState, cli, nextStarted: () => existsSync(join(root, "next-suites")), fallback };
}
