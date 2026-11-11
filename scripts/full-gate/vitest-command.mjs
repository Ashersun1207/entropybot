import { join } from "node:path";
import { insist, safeArgv } from "./core.mjs";
import { gateBootstrapArgs, gateVitestWorkerArg } from "../testing/verification-lifecycle.ts";

export function vitestCommand({ root, cwd, group, capability, out, platform = false }) {
  const main = /^main-vitest-(?:0[1-9]|10)$/.test(group);
  insist(main || ["broker-vitest", "control-plane-vitest"].includes(group), "unknown Vitest lane");
  const config = join(root, "scripts/full-gate", platform ? "platform-vitest.config.mjs" : main ? "main-vitest.config.mjs" : `${group}.config.mjs`);
  const entry = join(cwd, "node_modules/vitest/vitest.mjs");
  const list = [process.execPath, entry, "list", "--filesOnly", "--json", "--config", config];
  const argv = [process.execPath, ...gateBootstrapArgs(capability), entry, "run", "--config", config, gateVitestWorkerArg(capability), "--maxWorkers", main && !platform ? "2" : "1", "--reporter=json", `--outputFile=${join(out, platform ? "platform-report.json" : "report.json")}`];
  if (main && !platform) argv.push(`--shard=${Number(group.slice(-2))}/10`);
  safeArgv(argv);
  return { list, argv };
}
