import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vitest/config";
import base from "../../vite.config.ts";

const declarations = JSON.parse(readFileSync(new URL("./platform-declarations.json", import.meta.url), "utf8")).entries;
const include = [...new Set(declarations.filter(row => row.class === "executed-in-this-run" && row.targetPlatform === process.env.FULL_GATE_TARGET_PLATFORM && !row.file.endsWith(".node-test.mjs")).map(row => row.file))];
if (!include.length) throw new Error("No declared platform test files");
export default mergeConfig(base, { test: { include, runner: fileURLToPath(new URL("./strict-runner.ts", import.meta.url)), maxWorkers: 1, fileParallelism: false } });
