import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, realpathSync, readFileSync, writeFileSync, rmSync, statSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGateCapability, assertGateLeases, VerificationLifecycle } from "./testing/verification-lifecycle.ts";
import { GateCommandRunner } from "./patch-gate-process.ts";
import { VerificationProcessScope } from "../server/verification-process-scope.ts";
import { startGroupHistory, readGroupHistory, groupPresence } from "../server/verification-group-history.ts";
import { listProcesses } from "../server/browser/chrome/processes.ts";
import { beginResourceAudit, validateResourceAudit } from "./full-gate/resource-audit.mjs";

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "fg-history-")));
  const root = join(base, "source"); const home = join(base, "home");
  mkdirSync(root); mkdirSync(home, { mode: 0o700 });
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git(["init", "-q"]); writeFileSync(join(root, "input"), "synthetic"); git(["add", "."]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]);
  const binding = { sourceSha: git(["rev-parse", "HEAD"]), runId: "1234", attempt: "1", group: "electron-node" };
  const capability = createGateCapability(home, binding);
  const output = join(base, "audit.json");
  t.after(() => {
    const evidence = process.env.F2_RESOURCE_AUDIT_TEST_EVIDENCE;
    if (evidence) {
      const dest = join(evidence, base.split("/").at(-1)); mkdirSync(dest, { recursive: true });
      for (const file of readGroupHistory(capability).files) writeFileSync(join(dest, file.split("/").at(-1)), readFileSync(file));
      try { writeFileSync(join(dest, "audit.json"), readFileSync(output)); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    rmSync(base, { recursive: true, force: true });
  });
  return { base, root, home, binding, capability, processCapability: capability, output };
}
async function owned(t) {
  const marker = `owned-history-${randomUUID()}`;
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", "--", marker], { detached: true, stdio: "ignore" });
  await once(child, "spawn");
  const row = (await listProcesses()).find(row => row.pid === child.pid);
  assert.ok(row?.startTime && row.args.includes(marker));
  const stop = async () => {
    const current = (await listProcesses()).find(row => row.pid === child.pid);
    if (!current) return;
    assert.equal(current.startTime, row.startTime); assert.ok(current.args.includes(marker));
    const closed = once(child, "close"); child.kill("SIGTERM"); await closed;
  };
  t.after(stop);
  return { child, row, stop };
}
function resign(capability, file, change) {
  const frame = JSON.parse(readFileSync(file)); const row = JSON.parse(frame.payload); change(row);
  frame.payload = JSON.stringify(row); frame.mac = createHmac("sha256", capability.secret).update(frame.payload).digest("hex");
  writeFileSync(file, JSON.stringify(frame));
}

test("public history persists start/owner/source identity and terminal stop; lease directory stays strict", async t => {
  const f = fixture(t); const p = await owned(t);
  const history = startGroupHistory(p.child, f.capability, "owned-fixture"); await history.ready;
  const initial = readGroupHistory(f.capability);
  assert.equal(initial.files.length, 1); assert.equal(initial.identities[0].startTime, p.row.startTime);
  assert.ok(initial.identities[0].ownerStartTime); assert.deepEqual(initial.identities[0].binding, f.binding);
  assert.equal(statSync(join(f.home, "verification-processes")).mode & 0o777, 0o700);
  assert.equal(assertGateLeases(f.capability), 0);
  writeFileSync(join(f.capability.directory, "extra.json"), "{}");
  assert.throws(() => assertGateLeases(f.capability), /Unfinished/); rmSync(join(f.capability.directory, "extra.json"));
  const audit = await beginResourceAudit(f);
  await p.stop(); await history.finish(true);
  const result = await audit.finish();
  assert.equal(readGroupHistory(f.capability).identities[0].status, "stopped");
  assert.equal(result.status, "clear-observed-domain"); validateResourceAudit(result, f.binding);
  await history.finish(false); await history.finish(true);
  assert.equal(readGroupHistory(f.capability).identities[0].status, "unknown");
});

for (const order of [[false, true], [true, false]]) for (const delayed of [false, true]) test(`concurrent finish ${order} with ${delayed ? "delayed" : "immediate"} inventory preserves terminal unknown`, async t => {
  const f = fixture(t); const p = await owned(t);
  let release;
  let observing;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { observing = resolve; });
  let calls = 0;
  const inventory = async () => {
    const rows = await listProcesses();
    if (++calls > 1 && delayed) { observing(); await held; }
    return rows;
  };
  const history = startGroupHistory(p.child, f.capability, "concurrent-finish", inventory);
  await history.ready; await p.stop();
  assert.equal(groupPresence(p.child.pid), false);
  const first = history.finish(order[0]);
  if (delayed) await started;
  const second = history.finish(order[1]);
  release();
  await Promise.all([first, second]);
  assert.equal(readGroupHistory(f.capability).identities[0].status, "unknown");
  await Promise.all([history.finish(true), history.finish(true), history.finish(false)]);
  await history.finish(true);
  assert.equal(readGroupHistory(f.capability).identities[0].status, "unknown");
});

test("rejected completion inventory persists unknown before the next queued stop", async t => {
  const f = fixture(t); const p = await owned(t);
  let calls = 0;
  const history = startGroupHistory(p.child, f.capability, "failed-inventory", async () => {
    if (++calls > 1) throw new Error("synthetic completion inventory failure");
    return listProcesses();
  });
  await history.ready; await p.stop();
  const outcomes = await Promise.allSettled([history.finish(false), history.finish(true)]);
  assert.equal(outcomes[0].status, "rejected"); assert.equal(outcomes[1].status, "fulfilled");
  await history.finish(true);
  assert.equal(readGroupHistory(f.capability).identities[0].status, "unknown");
});

for (const status of ["pending", "stopped"]) for (const identity of ["stale", "unreadable"]) test(`${status} record with ${identity} present leader causes zero audit probes; control survives`, async t => {
  const f = fixture(t); const p = await owned(t); const control = await owned(t);
  const history = startGroupHistory(p.child, f.capability, "guarded-probes"); await history.ready;
  resign(f.capability, readGroupHistory(f.capability).files[0], row => {
    row.status = status;
    if (identity === "stale") row.startTime += "-stale";
  });
  const original = process.kill; const calls = [];
  process.kill = function(pid, signal) { calls.push({ pid, signal }); return original.call(process, pid, signal); };
  let result;
  try {
    const list = async () => (await listProcesses()).map(row => identity === "unreadable" && row.pid === p.child.pid ? { ...row, startTime: null } : row);
    result = await (await beginResourceAudit({ ...f, list })).finish();
  } finally { process.kill = original; }
  assert.equal(result.status, "unknown"); assert.deepEqual(calls, []);
  assert.throws(() => validateResourceAudit(result, f.binding), /audit|observations/);
  assert.equal((await listProcesses()).find(row => row.pid === control.child.pid)?.startTime, control.row.startTime);
});

test("GateCommandRunner creates discoverable history after audit begins, then confirms actual disappearance", async t => {
  const f = fixture(t); const audit = await beginResourceAudit(f);
  const runner = new GateCommandRunner({ processCapability: f.capability, handleSignals: false });
  try {
    await runner.run(process.execPath, ["-e", "setTimeout(()=>{},300)"], { cwd: f.root, env: { PATH: process.env.PATH, HOME: f.home }, forwardOutput: false });
    const { files, identities } = readGroupHistory(f.capability);
    assert.equal(files.length, 1); assert.equal(identities[0].creator, "gate-command-runner");
    assert.equal(identities[0].status, "stopped"); assert.equal(groupPresence(identities[0].pgid), false);
    const result = await audit.finish(); assert.equal(result.registryFiles.length, 1);
    assert.match(result.domain, /authenticated-internal/); validateResourceAudit(result, f.binding);
  } finally { await runner.close(); }
});

test("VerificationProcessScope normal registration records its CLI group and observes actual stop", async t => {
  const f = fixture(t); const p = await owned(t);
  const identity = { version: 1, gateNonce: f.capability.gateNonce, fixtureNonce: randomUUID(), serverNonce: randomUUID(), generation: 1, dataDir: f.home };
  const scope = new VerificationProcessScope(identity, async () => true, f.capability);
  scope.register(p.child, async () => { await p.stop(); return true; });
  const receipt = await scope.drain(); assert.equal(receipt.status, "stopped");
  assert.equal(readGroupHistory(f.capability).identities[0].status, "stopped"); scope.dispose();
});

for (const mode of ["tampered", "forged", "stale", "lying-stopped", "unknown", "deleted"]) test(`${mode} durable history cannot clear; unrelated owned control survives`, async t => {
  const f = fixture(t); const p = await owned(t); const control = await owned(t);
  const history = startGroupHistory(p.child, f.capability, "owned-fixture"); await history.ready;
  const file = readGroupHistory(f.capability).files[0];
  if (mode === "tampered") { const frame = JSON.parse(readFileSync(file)); frame.payload += " "; writeFileSync(file, JSON.stringify(frame)); }
  if (mode === "forged") { const frame = JSON.parse(readFileSync(file)); frame.mac = "0".repeat(64); writeFileSync(file, JSON.stringify(frame)); }
  if (["tampered", "forged"].includes(mode)) assert.throws(() => readGroupHistory(f.capability), /Unauthenticated/);
  if (mode === "stale") resign(f.capability, file, row => { row.startTime += "-stale"; });
  if (mode === "lying-stopped") resign(f.capability, file, row => { row.status = "stopped"; });
  if (mode === "unknown") { await history.finish(false); await p.stop(); await history.finish(true); }
  const audit = await beginResourceAudit(f);
  if (mode === "deleted") { await p.stop(); rmSync(file); }
  const result = await audit.finish(); assert.notEqual(result.status, "clear-observed-domain");
  assert.throws(() => validateResourceAudit(result, f.binding), /audit|history/);
  assert.equal((await listProcesses()).find(row => row.pid === control.child.pid)?.startTime, control.row.startTime);
  if (["tampered", "forged"].includes(mode)) resign(f.capability, file, () => {});
});

test("invalid authenticated identity shapes, unsigned group arrays and foreign capability home cannot clear", async t => {
  const f = fixture(t); const p = await owned(t);
  const history = startGroupHistory(p.child, f.capability, "owned-fixture"); await history.ready;
  const file = readGroupHistory(f.capability).files[0]; const original = readFileSync(file);
  for (const [index, change] of [row => { row.pid = 1; }, row => { row.pgid = 0; }, row => { row.startTime = ""; }, row => { row.launchedAt = "bad"; }, row => { row.gateNonce = randomUUID(); }, row => { row.binding.runId = "other"; }].entries()) {
    writeFileSync(file, original); resign(f.capability, file, change);
    const result = await (await beginResourceAudit({ ...f, output: join(f.base, `invalid-${index}.json`) })).finish();
    assert.equal(result.status, "unknown"); assert.throws(() => validateResourceAudit(result, f.binding), /audit|history/);
  }
  writeFileSync(file, original);
  const unsigned = join(f.home, "unsigned.json"); writeFileSync(unsigned, JSON.stringify(readGroupHistory(f.capability).identities));
  const result = await (await beginResourceAudit({ ...f, registryFiles: [unsigned] })).finish();
  assert.equal(result.status, "unknown");
  await assert.rejects(beginResourceAudit({ ...f, processCapability: { ...f.capability, directory: join(f.base, "foreign/verification-leases") } }), /outside owned home/);
});

test("authenticated pending leader surviving its creator is residual, without signaling it", async t => {
  const f = fixture(t);
  const script = `import {spawn} from 'node:child_process';import {readFileSync} from 'node:fs';import {startGroupHistory} from ${JSON.stringify(new URL("../server/verification-group-history.ts", import.meta.url).href)};const cap=JSON.parse(readFileSync(process.argv[1]));const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)','--','owned-survivor-${f.capability.gateNonce}'],{detached:true,stdio:'ignore'});await startGroupHistory(p,cap,'surviving-root').ready;console.log(p.pid);p.unref();`;
  const root = spawn(process.execPath, ["--input-type=module", "-e", script, join(f.home, "verification-bootstrap.json")], { stdio: ["ignore", "pipe", "pipe"] });
  let text = ""; let errors = ""; root.stdout.on("data", chunk => { text += chunk; }); root.stderr.on("data", chunk => { errors += chunk; }); await once(root, "close");
  assert.equal(root.exitCode, 0, errors); const pid = Number(text.trim());
  const row = (await listProcesses()).find(row => row.pid === pid); assert.ok(row?.args.includes(`owned-survivor-${f.capability.gateNonce}`));
  t.after(async () => {
    const current = (await listProcesses()).find(row => row.pid === pid);
    if (current?.startTime === row.startTime && current.args === row.args) process.kill(pid, "SIGTERM");
    const until = Date.now() + 2000;
    while ((await listProcesses()).some(row => row.pid === pid)) { assert.ok(Date.now() < until); await new Promise(resolve => setTimeout(resolve, 20)); }
  });
  const result = await (await beginResourceAudit(f)).finish();
  assert.equal(result.status, "residual"); assert.equal(result.after.groups[0].present, true);
  assert.equal(readGroupHistory(f.capability).identities[0].status, "pending");
});


test("VerificationLifecycle IPC carries history capability to real spawnCli groups, while child bootstrap stays clean", async t => {
  const f = fixture(t);
  const lifecycle = new VerificationLifecycle({ capability: f.capability });
  const log = openSync(join(f.home, "server.log"), "a");
  try {
    const probe = new URL("./testing/verification-boundary-probe.mjs", import.meta.url).pathname;
    const started = lifecycle.start([probe, "server", "normal"], { cwd: new URL("../", import.meta.url).pathname,
      env: { HOME: lifecycle.dataDir, OMB_DATA_DIR: lifecycle.dataDir, PATH: process.env.PATH }, log });
    const ready = new Promise(resolve => lifecycle.child.on("message", value => { if (value?.type === "probe:ready") resolve(value); }));
    await started; await ready;
    const pending = readGroupHistory(f.capability).identities;
    assert.equal(pending.length, 1); assert.match(pending[0].creator, /^verification-scope:/);
    assert.equal(JSON.parse(readFileSync(join(lifecycle.dataDir, "inner-boundary.json"))).clean, true);
    assert.equal(JSON.parse(readFileSync(join(lifecycle.dataDir, "mcp-boundary.json"))).clean, true);
    await lifecycle.close();
    assert.equal(readGroupHistory(f.capability).identities[0].status, "stopped");
    assert.equal(assertGateLeases(f.capability), 1);
    validateResourceAudit(await (await beginResourceAudit(f)).finish(), f.binding);
  } finally { await lifecycle.close(); closeSync(log); }
});

test("stopped claim cannot hide same-group descendant after leader disappears", async t => {
  const f = fixture(t); const marker = `owned-descendant-${randomUUID()}`;
  const script = `const {spawn}=require('node:child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)','--',${JSON.stringify(marker)}],{stdio:'ignore'});console.log(p.pid);p.unref();setTimeout(()=>{},400);`;
  const leader = spawn(process.execPath, ["-e", script], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let text = ""; leader.stdout.on("data", chunk => { text += chunk; });
  const closed = once(leader, "close"); await once(leader, "spawn");
  const history = startGroupHistory(leader, f.capability, "owned-leader"); await history.ready; await closed;
  const pid = Number(text.trim()); const row = (await listProcesses()).find(row => row.pid === pid);
  assert.ok(row?.args.includes(marker));
  t.after(async () => {
    const current = (await listProcesses()).find(row => row.pid === pid);
    if (current?.startTime === row.startTime && current.args.includes(marker)) process.kill(pid, "SIGTERM");
    const until = Date.now() + 2000;
    while ((await listProcesses()).some(row => row.pid === pid)) { assert.ok(Date.now() < until); await new Promise(resolve => setTimeout(resolve, 20)); }
  });
  const file = readGroupHistory(f.capability).files[0];
  resign(f.capability, file, row => { row.status = "stopped"; });
  const result = await (await beginResourceAudit(f)).finish();
  assert.equal(result.after.processes.length, 0); assert.equal(result.after.groups[0].present, true);
  assert.equal(result.status, "residual"); assert.throws(() => validateResourceAudit(result, f.binding), /residual/);
});
