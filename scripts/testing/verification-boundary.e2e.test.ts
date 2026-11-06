import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it, onTestFinished } from "vitest";
import { GateCommandError, GateCommandRunner } from "../patch-gate-process.ts";
import { assertGateLeases, createGateCapability, gateBootstrapArgs, gateVitestWorkerArg } from "./verification-lifecycle.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const probe = fileURLToPath(new URL("./verification-boundary-probe.mjs", import.meta.url));
const preload = fileURLToPath(new URL("./verification-server-preload.ts", import.meta.url));

function temporary() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "verification-boundary-")));
  onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

it.each(["awaited", "unawaited", "forced"])("production spawnCli/shutdown: %s stops or preserves the actual fixture HOME", async mode => {
  const home = temporary();
  const capability = createGateCapability(home);
  const controller = new AbortController();
  const controlRunner = new GateCommandRunner({ signal: controller.signal, commandTimeoutMs: 5_000, overallTimeoutMs: 6_000, graceMs: 100, killWaitMs: 1_000 });
  onTestFinished(() => controlRunner.close());
  const controlFile = join(home, "control-heartbeat");
  const control = controlRunner.run(process.execPath, ["-e", "const fs=require('node:fs');setInterval(()=>fs.appendFileSync(process.argv[1],'.'),20);setTimeout(()=>process.exit(90),5500);", controlFile], {
    cwd: root, env: { PATH: process.env.PATH, HOME: home }, forwardOutput: false,
  }).catch(error => error as GateCommandError);
  let proof: { dataDir: string; identity: { serverNonce: string }; serverPid: number; innerPid: number; mcpPid: number } | undefined;
  let buffered = "";
  let retired = false;
  const cancelled = new AbortController();
  const managed = new GateCommandRunner({ signal: cancelled.signal, commandTimeoutMs: 5_000, overallTimeoutMs: 6_000, graceMs: mode === "forced" ? 100 : 1_000, killWaitMs: 1_000 });
  onTestFinished(() => managed.close());
  const outcome = managed.run(process.execPath, [...gateBootstrapArgs(capability), probe, "coordinator", mode], { cwd: root,
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home }, forwardOutput: false,
    onStdout: chunk => {
      buffered += chunk;
      const lines = buffered.split("\n"); buffered = lines.pop()!;
      for (const line of lines) if (line.startsWith("{")) proof = JSON.parse(line);
    },
  }).catch(error => error as GateCommandError);
  onTestFinished(async () => {
    await managed.close();
    if (proof?.innerPid && !retired) {
      try { process.kill(-proof.innerPid, 0); process.kill(-proof.innerPid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      await expect.poll(() => { try { process.kill(-proof!.innerPid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; } }, { timeout: 1_000 }).toBe(false);
      retired = true;
      rmSync(proof.dataDir, { recursive: true, force: true });
    }
    controller.abort(); await control;
  });
  await expect.poll(() => Boolean(proof), { timeout: 2_000 }).toBe(true);
  const owned = proof!;
  expect(owned.innerPid).toBeGreaterThan(1);
  expect(owned.innerPid).not.toBe(process.pid);
  await expect.poll(() => { try { return readFileSync(join(owned.dataDir, "inner-heartbeat"), "utf8").length; } catch { return 0; } }).toBeGreaterThan(0);
  const before = readFileSync(controlFile, "utf8").length;
  expect(JSON.parse(readFileSync(join(owned.dataDir, "inner-boundary.json"), "utf8")).clean).toBe(true);
  expect(JSON.parse(readFileSync(join(owned.dataDir, "mcp-boundary.json"), "utf8")).clean).toBe(true);
  cancelled.abort();
  const result = await outcome as GateCommandError;
  expect(result).toMatchObject({ kind: "cancelled", ownedGroupStopped: true });
  await expect.poll(() => readFileSync(controlFile, "utf8").length).toBeGreaterThan(before);
  if (mode === "forced") {
    expect(existsSync(owned.dataDir)).toBe(true);
    expect(() => assertGateLeases(capability)).toThrow("pending or unknown");
    const count = readFileSync(join(owned.dataDir, "inner-heartbeat"), "utf8").length;
    await expect.poll(() => readFileSync(join(owned.dataDir, "inner-heartbeat"), "utf8").length).toBeGreaterThan(count);
    expect(existsSync(join(owned.dataDir, "insurance"))).toBe(false);
  } else {
    expect(existsSync(owned.dataDir)).toBe(false);
    expect(assertGateLeases(capability)).toBe(1);
    let gone = false;
    try { process.kill(-owned.innerPid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") gone = true; else throw error; }
    expect(gone).toBe(true);
    retired = true;
  }
  process.stdout.write(JSON.stringify({ scenario: mode, proof: owned, ownedGroupEvidence: result.evidence,
    fixtureDirectoryPreserved: existsSync(owned.dataDir), controlResponsive: true, internalReceiptConfirmed: mode !== "forced" }) + "\n");
});

it.each([1, 2])("keeps authenticated file and fixture leases across isolated files with %s worker(s)", async workers => {
  const home = temporary();
  symlinkSync(join(root, "node_modules"), join(home, "node_modules"), "junction");
  writeFileSync(join(home, "package.json"), '{"type":"module"}');
  const capability = createGateCapability(home);
  const controlUrl = pathToFileURL(join(root, "scripts/control-omb.ts")).href;
  const helperUrl = pathToFileURL(join(root, "scripts/testing/verification-lifecycle.ts")).href;
  const files = ["first", "second"].map(name => {
    const path = join(home, `${name}.test.mjs`);
    writeFileSync(path, `import { it, expect } from 'vitest'; import { writeFileSync, existsSync } from 'node:fs';
      import { launchVerificationServer } from ${JSON.stringify(controlUrl)};
      import { consumeGateCapability } from ${JSON.stringify(helperUrl)};
      it('isolated ${name} owns its fixture lease', async () => {
        const capability = consumeGateCapability(); expect(capability).toBeDefined();
        expect(process.execArgv.some(arg => arg.includes('gate='))).toBe(false);
        const session = await launchVerificationServer();
        const dataDir = session.info.dataDir;
        try {
          expect(session.child.pid).toBeGreaterThan(1);
          ${name === "second" ? "const oldPid = session.child.pid; await session.restart(); expect(session.child.pid).not.toBe(oldPid);" : ""}
        } finally { await session.close(); }
        writeFileSync(${JSON.stringify(join(home, `${name}.json`))}, JSON.stringify({ pid:process.pid, nonce:capability.gateNonce, deleted:!existsSync(dataDir) }));
      });`);
    return path;
  });
  const config = join(home, "vitest.config.mjs");
  writeFileSync(config, `import original from ${JSON.stringify(pathToFileURL(join(root, "vite.config.ts")).href)};
    export default { ...original, root:${JSON.stringify(home)}, test:{ ...original.test, include:['*.test.mjs'],
      setupFiles:[${JSON.stringify(join(root, "server/testing/setup.ts"))},${JSON.stringify(join(root, "src/testing/all-locales.ts"))}],
      runner:${JSON.stringify(join(root, "scripts/testing/ci-retry-runner.ts"))}, sequence:{}, pool:${JSON.stringify(workers === 1 ? "vmForks" : "forks")}, maxWorkers:${workers}, fileParallelism:${workers > 1} } };`);
  const runner = new GateCommandRunner({ commandTimeoutMs: 20_000, overallTimeoutMs: 25_000 });
  onTestFinished(() => runner.close());
  const result = await runner.run(process.execPath, [...gateBootstrapArgs(capability), join(root, "node_modules/vitest/vitest.mjs"), "run", "--root", home, "--config", config, "--configLoader", "native", gateVitestWorkerArg(capability)], {
    cwd: root, env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home }, forwardOutput: true,
  });
  expect(result.stdout).toContain("2 passed");
  expect(assertGateLeases(capability, files)).toBe(5);
  const first = JSON.parse(readFileSync(join(home, "first.json"), "utf8"));
  const second = JSON.parse(readFileSync(join(home, "second.json"), "utf8"));
  expect(first.nonce).toBe(capability.gateNonce);
  expect(second.nonce).toBe(capability.gateNonce);
  expect(first.deleted && second.deleted).toBe(true);
  if (workers === 1) expect(first.pid).toBe(second.pid);
  else expect(first.pid).not.toBe(second.pid);
  process.stdout.write(JSON.stringify({ scenario: "worker-isolation", workers, pool: workers === 1 ? "vmForks" : "forks", pids: [first.pid, second.pid], authenticatedLeases: 5, restartConfirmed: true, bothDirectoriesDeleted: true }) + "\n");
}, 30_000);

it.each(["wrong-init", "disconnect"])("does not execute a managed entry on %s", async mode => {
  const home = temporary();
  const marker = join(home, "entered");
  const child = spawn(process.execPath, ["--import", preload, "--input-type=module", "-e", `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'entered')`], {
    cwd: root, env: { HOME: home, OMB_DATA_DIR: home, PATH: process.env.PATH }, stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let closed = false;
  let exited = false;
  let outputClosed = false;
  let stderr = "";
  child.stderr!.on("data", chunk => { stderr += chunk; });
  child.once("close", () => { closed = true; });
  child.once("exit", () => { exited = true; });
  child.stderr!.once("close", () => { outputClosed = true; });
  onTestFinished(async () => {
    if (!exited) child.kill("SIGKILL");
    await expect.poll(() => exited && outputClosed, { timeout: 1_000 }).toBe(true);
    child.unref(); child.channel?.unref();
  });
  child.once("message", () => {
    if (mode === "disconnect") child.disconnect();
    else child.send({ type: "verification:init", identity: { version: 1, gateNonce: randomUUID(), fixtureNonce: randomUUID(), serverNonce: randomUUID(), generation: 1, dataDir: home + "-wrong" } });
  });
  try { await expect.poll(() => exited && outputClosed, { timeout: 4_000 }).toBe(true); }
  catch (error) { process.stdout.write(JSON.stringify({ mode, pid: child.pid, exit: child.exitCode, signal: child.signalCode, connected: child.connected, stderr }) + "\n"); throw error; }
  expect(child.exitCode).not.toBe(0);
  expect(existsSync(marker)).toBe(false);
  process.stdout.write(JSON.stringify({ scenario: mode, entryExecuted: false, exitObserved: exited, outputClosed, closeObserved: closed }) + "\n");
});

it.each(["missing", "invalid-version"])("fails closed before entry when managed bootstrap is %s", async mode => {
  const home = temporary();
  const capability = createGateCapability(home);
  const descriptor = join(home, "verification-bootstrap.json");
  if (mode === "missing") rmSync(descriptor);
  else writeFileSync(descriptor, JSON.stringify({ ...capability, version: 2 }));
  const marker = join(home, "entered");
  const runner = new GateCommandRunner({ commandTimeoutMs: 1_000, overallTimeoutMs: 2_000 });
  onTestFinished(() => runner.close());
  await expect(runner.run(process.execPath, [...gateBootstrapArgs(capability), "--input-type=module", "-e", `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'entered')`], {
    cwd: root, env: { HOME: home, PATH: process.env.PATH }, forwardOutput: false,
  })).rejects.toMatchObject({ kind: "exit", ownedGroupStopped: true });
  expect(existsSync(marker)).toBe(false);
});
