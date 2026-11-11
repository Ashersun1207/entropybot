import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { digest, exact, insist } from "./core.mjs";

export const TRUST_ENTRIES = [
  ".github/workflows/entropybot-full-gate.yml", "scripts/full-gate/core.mjs", "scripts/full-gate/runner.mjs", "scripts/full-gate/verdict.mjs", "scripts/full-gate/trust.mjs", "scripts/full-gate/strict-runner.ts",
  "scripts/full-gate/policy.json", "scripts/full-gate/platform-declarations.json", "scripts/full-gate/disposition-trust.json",
  "vite.config.ts", "cloudflare/composio-broker/vitest.config.ts", "cloudflare/control-plane/vitest.config.ts",
  "server/testing/setup.ts", "src/testing/all-locales.ts", "cloudflare/control-plane/test/setup.ts",
  "scripts/install-git-hooks.mjs",
  "scripts/check-patches.mjs", "scripts/entropybot-release.mjs", "scripts/testing/vitest-shard-weights.json", "scripts/testing/ci-retry-list.json",
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "cloudflare/control-plane/package.json",
  "tsconfig.json", "tsconfig.server.json", "tsconfig.tools.json", ".oxlintrc.json",
];
export function producerClosure(root) {
  const pending = [...TRUST_ENTRIES];
  for (const file of readdirSync(join(root, "scripts/full-gate"))) {
    if (/\.(?:mjs|ts)$/.test(file)) pending.push(`scripts/full-gate/${file}`);
  }
  const found = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (found.has(file)) continue;
    insist(!file.startsWith("../"), "producer dependency outside tree");
    const bytes = readFileSync(join(root, file), "utf8");
    found.add(file);
    if (!/\.(?:mjs|cjs|[jt]sx?)$/.test(file)) continue;
    const imports = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g;
    for (const match of bytes.matchAll(imports)) {
      const path = relative(root, resolve(root, dirname(file), match[1]));
      const resolved = [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`].find(candidate => existsSync(join(root, candidate)));
      insist(resolved, `missing producer dependency: ${path}`);
      pending.push(resolved);
    }
  }
  return [...found].sort();
}
export function verifyPins(root, pins) {
  const files = producerClosure(root);
  exact(Object.keys(pins), files, "producer pins");
  for (const file of files) insist(pins[file] === digest(readFileSync(join(root, file))), `altered producer bytes: ${file}`);
  return files.length;
}
