import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launchVerificationServer, FIXTURE_STARTER_BOT_NAME } from "../control-omb.ts";
import { consumeGateCapability } from "../testing/verification-lifecycle.ts";
import { recordCommand, requireValue, writeReport } from "./contract.mjs";

const reports = process.argv[2];
const root = process.cwd();
const session = await launchVerificationServer(process.env);
const capability = consumeGateCapability();
const dataDir = session.info.dataDir;
const messages = [];
session.child.on("message", message => { if (message?.type === "verification:stopped") messages.push(message); });
let exited = false;
let closed = false;
session.child.once("exit", () => { exited = true; });
session.child.once("close", () => { closed = true; });
try {
  const health = await fetch(`${session.info.url}/api/health`, { signal: AbortSignal.timeout(5000) });
  requireValue(health.ok, "actual fixture health failed");
  writeReport(reports, "http-health.json", { url: health.url, status: health.status, body: await health.text(), pid: session.child.pid });
  const command = async (name, argv) => recordCommand({ reports, name, executable: process.execPath,
    argv: [join(root, "server/entropybot.ts"), ...argv, "--json"], cwd: root, env: process.env, timeoutMs: 90000, capability });
  const doctor = JSON.parse((await command("http-doctor", ["doctor", "--url", session.info.url])).stdout);
  requireValue(doctor.ok === true, "doctor did not confirm actual fixture");
  const result = JSON.parse((await command("http-normal", ["run", FIXTURE_STARTER_BOT_NAME, "Reply to this synthetic qualification message.", "--url", session.info.url, "--wait", "job", "--timeout", "60s"])).stdout);
  requireValue(result.ok === true && result.state === "completed" && typeof result.reply?.text === "string" && result.reply.text.length > 0, "normal fake-engine job did not complete with reply");
} finally {
  try { await session.close(); }
  finally {
    writeReport(reports, "http-stop.json", { exited, closed, exitCode: session.child.exitCode, signal: session.child.signalCode,
      dataDir, directoryRemoved: !existsSync(dataDir), receipts: messages });
    if (existsSync(session.info.logPath)) writeReport(reports, "http-server.log", readFileSync(session.info.logPath, "utf8"));
  }
}
requireValue(exited && closed && !existsSync(dataDir) && messages.some(message => message.status === "stopped" && message.registered === message.confirmed), "actual fixture stop evidence missing");
