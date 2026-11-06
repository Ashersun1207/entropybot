import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const [mode, heartbeat] = process.argv.slice(2);
const event = (name, extra = {}) => console.log(JSON.stringify({ event: name, pid: process.pid, at: Date.now(), ...extra }));
const insurance = setTimeout(() => { event("insurance"); process.exit(90); }, 8_000);
insurance.unref();

if (mode === "normal") {
  event("normal");
  console.error("synthetic stderr");
} else if (mode === "nonzero") {
  event("nonzero");
  process.exitCode = 7;
} else if (mode === "gap") {
  const { GateCommandRunner } = await import("../patch-gate-process.ts");
  const runner = new GateCommandRunner({ overallTimeoutMs: 3_000 });
  try {
    await runner.run(process.execPath, ["-e", ""], { cwd: process.cwd(), env: process.env, forwardOutput: false });
    event("between");
    await new Promise(resolve => setTimeout(resolve, 200));
    await runner.run(process.execPath, ["-e", "console.log('unexpected-next-command')"], { cwd: process.cwd(), env: process.env });
  } catch (error) {
    event("gap-rejected", { kind: error.kind });
    process.exitCode = 1;
  } finally { await runner.close(); }
} else if (mode?.startsWith("tree-") || mode?.startsWith("orphan-")) {
  const child = spawn(process.execPath, [import.meta.filename, "descendant", heartbeat], {
    stdio: ["ignore", mode.endsWith("closed") ? "ignore" : "inherit", mode.endsWith("closed") ? "ignore" : "inherit", "ipc"],
  });
  child.once("message", () => {
    event("root-ready", { descendant: child.pid });
    if (mode.startsWith("orphan-")) process.exit(0);
    else setInterval(() => {}, 100);
  });
} else {
  process.on("SIGTERM", () => event("term"));
  if (heartbeat) setInterval(() => appendFileSync(heartbeat, "."), 25);
  else setInterval(() => {}, 100);
  if (process.send) process.send({ ready: true });
  event("root-ready");
}
