import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launchVerificationServer } from "../control-omb.ts";
import { consumeGateCapability, gateBootstrapArgs } from "../testing/verification-lifecycle.ts";
import { identity, inventory, recordCommand, requireValue, writeReport } from "./contract.mjs";
import { windowCommands, requireWindowDist, requireWindowHealth, requireDrawnRegion, WINDOW_ORIGIN } from "./window-contract.mjs";

export async function applicationWindow({ root, reports, home, env, capability, pnpm, record = recordCommand }) {
  const commands = windowCommands(root, pnpm, home, gateBootstrapArgs(capability));
  const run = (name, argv, timeoutMs, childEnv = env) => record({ reports, name, executable: argv[0], argv: argv.slice(1), cwd: root, env: childEnv, timeoutMs, capability });
  requireValue(!existsSync(join(root, "dist")), "window build requires fresh dist");
  await run("window-source-build", commands.build, 900000, { ...env, NODE_OPTIONS: "--max-old-space-size=6144" });
  const dist = requireWindowDist(root);
  writeReport(reports, "window-build.json", { command: commands.build, output: inventory(dist), packaging: false });
  await run("window-readiness", [...commands.worker, reports], 240000);
}

export async function windowWorker(reports) {
  const root = resolve(import.meta.dirname, "../..");
  const dist = requireWindowDist(root);
  const capability = consumeGateCapability();
  const home = process.env.HOME;
  const fixture = await launchVerificationServer({ ...process.env, OMB_TEST_PORTS: "8799-8799" }, undefined, undefined, undefined, undefined, undefined, [], undefined, dist);
  const receipts = [];
  let exited = false, closed = false;
  fixture.child.on("message", message => { if (message?.type === "verification:stopped") receipts.push(message); });
  fixture.child.once("exit", () => { exited = true; });
  fixture.child.once("close", () => { closed = true; });
  try {
    requireValue(fixture.info.url === WINDOW_ORIGIN, "window fixture must use reviewed fixed port");
    const healthBefore = await requireWindowHealth({ pid: fixture.child.pid });
    const argv = windowCommands(root, null, home, []).electron;
    const executableBefore = identity(argv[0]);
    await recordCommand({ reports, name: "window-electron", executable: argv[0], argv: argv.slice(1), cwd: root,
      env: { ...process.env, ELECTRON_START_URL: WINDOW_ORIGIN, OMB_DATA_DIR: fixture.info.dataDir }, timeoutMs: 125000, capability });
    const observation = JSON.parse(readFileSync(join(home, "window-observation.json"), "utf8"));
    requireValue(observation.readyToShow === true && observation.didFinishLoad === true && observation.location === `${WINDOW_ORIGIN}/` && observation.platform === "darwin" && observation.bridge === "function", "application window readiness incomplete");
    const pixels = requireDrawnRegion(readFileSync(join(home, "window-region.png")));
    const healthAfter = await requireWindowHealth({ pid: fixture.child.pid });
    const executableAfter = identity(argv[0]);
    requireValue(executableBefore.sha256 === executableAfter.sha256, "window Electron executable changed");
    writeReport(reports, "window-health-frame.json", { healthBefore, healthAfter, observation, pixels, executableBefore, executableAfter,
      completeQualification: false, completeCleanup: false });
  } finally {
    try { await fixture.close(); }
    finally {
      writeReport(reports, "window-server-stop.json", { exited, closed, exitCode: fixture.child.exitCode, signal: fixture.child.signalCode,
        directoryRemoved: !existsSync(fixture.info.dataDir), receipts });
    }
  }
  requireValue(exited && closed && !existsSync(fixture.info.dataDir) && receipts.some(receipt => receipt.status === "stopped" && receipt.registered === receipt.confirmed), "window fixture stop evidence incomplete");
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv[2] !== "--worker") throw new Error("window worker requires explicit mode");
  await windowWorker(process.argv[3]);
}
