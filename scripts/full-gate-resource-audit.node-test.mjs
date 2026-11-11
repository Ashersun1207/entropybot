import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beginResourceAudit, validateResourceAudit } from "./full-gate/resource-audit.mjs";
import { listProcesses, ProcessRegistry } from "../server/browser/chrome/processes.ts";

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "fg-audit-")));
  const root = join(base, "source");
  const home = join(base, "home");
  mkdirSync(root); mkdirSync(home);
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git(["init", "-q"]);
  writeFileSync(join(root, "source.txt"), "synthetic\n");
  git(["add", "."]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]);
  const binding = { sourceSha: git(["rev-parse", "HEAD"]), runId: "1234", attempt: "1", group: "electron-node" };
  const output = join(base, "resource-audit.json");
  t.after(() => {
    if (process.env.F2_RESOURCE_AUDIT_TEST_EVIDENCE) {
      const destination = join(process.env.F2_RESOURCE_AUDIT_TEST_EVIDENCE, base.split("/").at(-1));
      mkdirSync(destination, { recursive: true });
      try { writeFileSync(join(destination, "resource-audit.json"), readFileSync(output)); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    rmSync(base, { recursive: true, force: true });
  });
  return { root, home, binding, output, registryFiles: [], base };
}
async function child(t, profile) {
  const p = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", "--", `--user-data-dir=${profile}`], { stdio: "ignore", detached: true });
  await once(p, "spawn");
  t.after(async () => { if (p.exitCode !== null || p.signalCode !== null) return; const done = once(p, "close"); p.kill("SIGTERM"); await done; });
  return p;
}
async function identity(pid) {
  const row = (await listProcesses()).find(p => p.pid === pid);
  assert.ok(row?.startTime);
  return row;
}

for (const mode of ["null", "throw"]) test(`unknown ${mode} process inventory stays unknown`, async t => {
  const f = fixture(t);
  const audit = await beginResourceAudit({ ...f, list: async () => { if (mode === "throw") throw new Error("synthetic inventory failure"); return null; } });
  const result = await audit.finish();
  assert.equal(result.status, "unknown");
  assert.equal(result.completeCleanup, false);
  assert.throws(() => validateResourceAudit(result, f.binding), /audit/);
});

test("detached owned profile process outlives root and is independently detected", async t => {
  const f = fixture(t);
  const profile = join(f.home, "profile");
  const script = join(f.base, "root.cjs");
  writeFileSync(script, `const {spawn}=require('node:child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)','--',${JSON.stringify(`--user-data-dir=${profile}`)}],{detached:true,stdio:'ignore'});console.log(p.pid);p.unref();`);
  const root = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] });
  let text = ""; root.stdout.on("data", chunk => { text += chunk; });
  await once(root, "close");
  assert.equal(root.exitCode, 0);
  const pid = Number(text.trim());
  const owned = await identity(pid);
  t.after(async () => {
    const current = (await listProcesses()).find(p => p.pid === pid);
    if (current?.startTime === owned.startTime && current.args === owned.args) {
      process.kill(pid, "SIGTERM");
      const deadline = Date.now() + 2000;
      while ((await listProcesses()).some(row => row.pid === pid && row.startTime === owned.startTime && row.args === owned.args)) {
        assert.ok(Date.now() < deadline, "owned synthetic detached process did not exit");
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
  });
  const audit = await beginResourceAudit(f);
  const result = await audit.finish();
  assert.equal(result.status, "residual");
  assert.ok(result.after.processes.some(p => p.pid === pid));
  assert.equal(result.completeCleanup, false);
  assert.deepEqual(JSON.parse(readFileSync(f.output, "utf8")), result);
  assert.throws(() => validateResourceAudit(result, f.binding), /audit/);
});

test("stale registry identity cannot authorize a clear result or touch unrelated process", async t => {
  const f = fixture(t);
  const p = await child(t, join(f.base, "unrelated-profile"));
  const row = await identity(p.pid);
  const registry = new ProcessRegistry(f.home);
  registry.add({ pid: p.pid, startTime: `${row.startTime}-stale`, userDataDir: join(f.home, "profile"), ownerPid: process.pid, launchedAt: new Date().toISOString() });
  const audit = await beginResourceAudit({ ...f, registryFiles: [registry.file] });
  const result = await audit.finish();
  assert.equal(result.status, "unknown");
  assert.match(result.issues.join(" "), /identity/);
  assert.equal((await identity(p.pid)).startTime, row.startTime);
});

test("missing or malformed explicitly declared registry is unknown", async t => {
  for (const content of [undefined, "{}", "[{\"pid\":1}]"]) {
    const f = fixture(t);
    const file = join(f.home, "processes.json");
    if (content !== undefined) writeFileSync(file, content);
    const result = await (await beginResourceAudit({ ...f, registryFiles: [file] })).finish();
    assert.equal(result.status, "unknown");
  }
});

test("registry deletion after capture is unknown even when registered PID has exited", async t => {
  const f = fixture(t);
  const p = await child(t, join(f.home, "profile"));
  const row = await identity(p.pid);
  const registry = new ProcessRegistry(f.home);
  registry.add({ ...row, userDataDir: join(f.home, "profile"), ownerPid: process.pid, launchedAt: new Date().toISOString() });
  const audit = await beginResourceAudit({ ...f, registryFiles: [registry.file] });
  const closed = once(p, "close");
  p.kill("SIGTERM");
  await closed;
  rmSync(registry.file);
  const result = await audit.finish();
  assert.equal(result.status, "unknown");
});

test("source drift remains unknown and keeps artifact", async t => {
  const f = fixture(t);
  const audit = await beginResourceAudit(f);
  writeFileSync(join(f.root, "source.txt"), "changed");
  const result = await audit.finish();
  assert.equal(result.status, "unknown");
  assert.match(result.issues.join(" "), /source/);
  assert.ok(readFileSync(f.output).length);
});

test("normal exit and empty retained registry clears only observed domain; control survives", async t => {
  const f = fixture(t);
  const control = await child(t, `${f.home}-control-profile`);
  const p = spawn(process.execPath, ["-e", "process.once('message',()=>process.disconnect())", "--", `--user-data-dir=${join(f.home, "profile")}`], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  await once(p, "spawn");
  const closed = once(p, "close");
  t.after(async () => { if (p.exitCode === null && p.signalCode === null) { p.kill("SIGTERM"); await closed; } });
  const row = await identity(p.pid);
  const registry = new ProcessRegistry(f.home);
  registry.add({ ...row, userDataDir: join(f.home, "profile"), ownerPid: process.pid, launchedAt: new Date().toISOString() });
  const audit = await beginResourceAudit({ ...f, registryFiles: [registry.file] });
  p.send("finish");
  await closed;
  assert.equal(p.exitCode, 0);
  registry.remove(p.pid);
  const result = await audit.finish();
  assert.equal(result.status, "clear-observed-domain");
  assert.equal(result.completeCleanup, false);
  assert.equal(result.before.processes.some(row => row.pid === control.pid), false);
  assert.ok(result.before.processes.some(row => row.pid === p.pid));
  validateResourceAudit(result, f.binding);
  await identity(control.pid);
});

test("Windows unsupported explicitly, without listing processes", async t => {
  const f = fixture(t);
  const result = await (await beginResourceAudit({ ...f, platform: "win32", list: () => { throw new Error("must not enumerate"); } })).finish();
  assert.equal(result.status, "unknown");
  assert.match(result.issues.join(" "), /unsupported.*win32/);
});

test("verifier rejects wrong source/run/attempt/group and false cleanup claims", async t => {
  const f = fixture(t);
  const result = await (await beginResourceAudit(f)).finish();
  validateResourceAudit(result, f.binding);
  for (const key of ["sourceSha", "runId", "attempt", "group"]) {
    assert.throws(() => validateResourceAudit(result, { ...f.binding, [key]: "wrong" }), /audit/);
  }
  assert.throws(() => validateResourceAudit({ ...result, completeCleanup: true }, f.binding), /audit/);
});

test("hanging inventory is bounded and never clears", async t => {
  const f = fixture(t);
  const result = await (await beginResourceAudit({ ...f, inventoryTimeoutMs: 20, list: () => new Promise(() => {}) })).finish();
  assert.equal(result.status, "unknown");
});

test("missing process start identity stays unknown", async t => {
  const f = fixture(t);
  const p = await child(t, join(f.home, "profile"));
  const rows = await listProcesses();
  const result = await (await beginResourceAudit({ ...f, list: async () => rows.map(row => row.pid === p.pid ? { ...row, startTime: null } : row) })).finish();
  assert.equal(result.status, "unknown");
});

test("noncanonical fixture home rejects rather than silently missing aliases", async t => {
  const f = fixture(t);
  await assert.rejects(beginResourceAudit({ ...f, home: `${f.home}/../home` }), /canonical/);
});

test("producer wiring retains independent audit and unconditional confirmation-domain blockers", () => {
  const root = resolve(import.meta.dirname, "..");
  for (const file of ["runner.mjs", "platform.mjs"]) {
    const bytes = readFileSync(join(root, "scripts/full-gate", file), "utf8");
    assert.match(bytes, /beginResourceAudit/);
    assert.match(bytes, /audit\.finish\(/);
    assert.match(bytes, /independent.*(?:incomplete|unavailable|not implemented)/);
  }
  assert.match(readFileSync(join(root, "scripts/full-gate/verdict.mjs"), "utf8"), /validateResourceAudit/);
});
