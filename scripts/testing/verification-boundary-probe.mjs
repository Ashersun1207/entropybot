import { spawn } from "node:child_process";
import { appendFileSync, openSync, closeSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

const [role, mode] = process.argv.slice(2);
const file = import.meta.filename;
const send = value => process.send?.(value);
const home = process.env.HOME;

if (role === "inner" || role === "mcp") {
  process.on("SIGTERM", () => {});
  const heartbeat = join(home, `${role}-heartbeat`);
  writeFileSync(join(home, `${role}-boundary.json`), JSON.stringify({ pid: process.pid,
    clean: !process.execArgv.some(arg => /gate=|verification-server-preload/.test(arg)) && !Object.keys(process.env).some(key => /VERIFICATION_GATE/.test(key))
      && !process.getBuiltinModule("process")[Symbol.for("entropybot.verification.gate.bootstrap.v1")] }));
  setInterval(() => appendFileSync(heartbeat, "."), 20);
  setTimeout(() => { writeFileSync(join(home, "insurance"), role); process.exit(90); }, 8_000);
  if (role === "inner") {
    const mcp = spawn(process.execPath, [file, "mcp"], { env: process.env, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    mcp.once("message", () => send({ ready: true, mcp: mcp.pid }));
  } else send({ ready: true });
} else if (role === "server") {
  setTimeout(() => process.exit(90), 8_000).unref();
  const { createGracefulShutdown } = await import("../../server/graceful-shutdown.ts");
  const { spawnCli, killCliTree } = await import("../../server/procs.ts");
  const { verificationProcessScope } = await import("../../server/verification-process-scope.ts");
  const scope = verificationProcessScope();
  const identity = scope.identity;
  let readyFrame;
  const ready = extra => { readyFrame = { type: "probe:ready", identity, serverPid: process.pid, ...extra }; send(readyFrame); };
  process.on("message", message => { if (message.type === "probe:request" && readyFrame) send(readyFrame); });
  if (["bad-nonce", "bad-gate", "bad-fixture", "bad-pid", "bad-generation", "bad-dir", "bad-version", "failed-exit", "stale", "missing-receipt", "close-timeout", "startup-fail"].includes(mode)) {
    if (mode === "startup-fail") throw new Error("synthetic failure after INIT");
    process.on("SIGTERM", () => {
      if (mode === "close-timeout") return;
      if (mode !== "missing-receipt") {
        const changed = mode === "stale" ? JSON.parse(process.argv[4]) : { ...identity };
        if (mode === "bad-nonce") changed.serverNonce = "00000000-0000-0000-0000-000000000000";
        if (mode === "bad-gate") changed.gateNonce = "00000000-0000-0000-0000-000000000000";
        if (mode === "bad-fixture") changed.fixtureNonce = "00000000-0000-0000-0000-000000000000";
        if (mode === "bad-generation") changed.generation++;
        if (mode === "bad-dir") changed.dataDir += "-wrong";
        if (mode === "bad-version") changed.version = 2;
        process.send({ type: "verification:stopped", identity: changed, serverPid: mode === "bad-pid" ? process.pid + 1 : process.pid, status: "stopped", registered: 0, confirmed: 0 }, () => process.exit(mode === "failed-exit" ? 1 : 0));
      } else process.exit(0);
    });
    setInterval(() => {}, 100);
    setTimeout(() => process.exit(90), 8_000).unref();
    ready({});
  } else if (mode === "sealed") {
    const { default: cp } = await import("node:child_process");
    const { syncBuiltinESMExports } = await import("node:module");
    const original = cp.spawn;
    let spawnCalls = 0;
    cp.spawn = (...args) => { spawnCalls++; return original(...args); };
    syncBuiltinESMExports();
    scope.seal();
    let refused = false;
    try { spawnCli(process.execPath, ["-e", "process.exit(0)"], { box: false }); } catch { refused = true; }
    cp.spawn = original;
    syncBuiltinESMExports();
    process.on("SIGTERM", createGracefulShutdown({ cleanup: [], exit: code => process.exit(code) }));
    setInterval(() => {}, 100);
    ready({ refused, spawnCalls });
  } else if (mode === "registration-failure") {
    let adopted;
    scope.register = child => { adopted = child; throw new Error("synthetic registration failure"); };
    try { spawnCli(process.execPath, ["-e", "setInterval(()=>{},100);setTimeout(()=>process.exit(90),5000)"], { box: false, stdio: ["ignore", "pipe", "pipe"] }); } catch {}
    const receipt = await scope.drain();
    process.on("SIGTERM", createGracefulShutdown({ cleanup: [], exit: code => process.exit(code) }));
    setInterval(() => {}, 100);
    ready({ adoptedPid: adopted.pid, registered: receipt.registered, confirmed: receipt.confirmed, status: receipt.status });
  } else {
    const inner = spawnCli(process.execPath, [file, "inner"], { box: false, env: { HOME: home, PATH: dirname(process.execPath) }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    const grace = mode === "forced" ? 1_200 : 100;
    const cleanup = () => {
      const stopped = killCliTree(inner, grace).then(ok => { if (!ok) throw new Error("probe inner stop failed"); });
      if (mode === "unawaited") { void stopped; return; }
      return stopped;
    };
    process.on("SIGTERM", createGracefulShutdown({ cleanup: [cleanup], exit: code => process.exit(code) }));
    inner.once("message", message => ready({ innerPid: inner.pid, mcpPid: message.mcp }));
    setInterval(() => {}, 100);
  }
} else if (role === "coordinator") {
  const { VerificationLifecycle } = await import("./verification-lifecycle.ts");
  const { sameVerificationIdentity } = await import("../../server/verification-process-scope.ts");
  const lifecycle = new VerificationLifecycle();
  const log = openSync(join(lifecycle.dataDir, "probe.log"), "a");
  const launched = lifecycle.start([file, "server", mode], { cwd: process.cwd(), env: { HOME: lifecycle.dataDir, OMB_DATA_DIR: lifecycle.dataDir, PATH: dirname(process.execPath) }, log });
  let closing;
  const stop = () => closing ??= lifecycle.close().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); });
  process.on("SIGTERM", () => { void stop(); });
  lifecycle.child.on("message", message => {
    if (message.type === "probe:ready" && message.serverPid === lifecycle.child.pid && sameVerificationIdentity(message.identity, lifecycle.identity)) {
      console.log(JSON.stringify({ ...message, dataDir: lifecycle.dataDir }));
    }
  });
  try { await launched; } finally { closeSync(log); }
  setInterval(() => {}, 100);
  setTimeout(() => { console.error("coordinator insurance"); void stop(); }, 7_000).unref();
}
