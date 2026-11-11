import { fileURLToPath } from "node:url";
import { mergeConfig } from "vitest/config";

export function strictConfig(base) {
  return mergeConfig(base, { test: { runner: fileURLToPath(new URL("./strict-runner.ts", import.meta.url)) } });
}
