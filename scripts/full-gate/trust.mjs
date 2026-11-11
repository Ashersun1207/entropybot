import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { digest, exact, insist } from "./core.mjs";
import { sourcePath, localPath, configDependencies, discoveredInputs } from "./closure-inputs.mjs";

export const TRUST_ENTRIES = [
  ".github/workflows/entropybot-full-gate.yml", "scripts/full-gate/core.mjs", "scripts/full-gate/runner.mjs", "scripts/full-gate/verdict.mjs", "scripts/full-gate/trust.mjs", "scripts/full-gate/strict-runner.ts",
  "scripts/full-gate/action-sources.json", "scripts/full-gate/policy.json", "scripts/full-gate/platform-declarations.json", "scripts/full-gate/disposition-trust.json",
  "vite.config.ts", "cloudflare/composio-broker/vitest.config.ts", "cloudflare/control-plane/vitest.config.ts",
  "server/testing/setup.ts", "src/testing/all-locales.ts", "cloudflare/control-plane/test/setup.ts",
  "scripts/install-git-hooks.mjs", "scripts/testing/verification-server-preload.ts", "server/message-search.worker.ts",
  "cloudflare/control-plane/wrangler.jsonc", "scripts/testing/ci-retry-runner.ts",
  "scripts/check-patches.mjs", "scripts/entropybot-release.mjs", "scripts/testing/vitest-shard-weights.json", "scripts/testing/ci-retry-list.json",
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "cloudflare/control-plane/package.json",
  "tsconfig.json", "tsconfig.server.json", "tsconfig.tools.json", ".oxlintrc.json",
];
function resolveDependency(root, path, sourceImport) {
  const jsSource = sourceImport && path.endsWith(".js");
  const extensionless = !/\.[^/]+$/.test(path);
  const candidates = jsSource ? [path, path.slice(0, -3) + ".ts", path.slice(0, -3) + ".tsx"]
    : extensionless ? [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`] : [path];
  const found = candidates.filter(candidate => {
    let stat;
    try { stat = lstatSync(join(root, candidate)); }
    catch (error) { if (error.code === "ENOENT" || error.code === "ENOTDIR") return false; throw error; }
    if (extensionless && candidate === path && stat.isDirectory()) { sourcePath(root, candidate, true); return false; }
    sourcePath(root, candidate);
    return true;
  });
  insist(found.length > 0, `missing producer dependency: ${path}`);
  insist(found.length === 1, `ambiguous producer dependency: ${path}`);
  return found[0];
}
export function producerClosure(root) {
  const pending = [...TRUST_ENTRIES, ...discoveredInputs(root)];
  for (const file of readdirSync(sourcePath(root, "scripts/full-gate", true))) {
    if (/\.[cm]?[jt]sx?$/.test(file)) pending.push(`scripts/full-gate/${file}`);
  }
  const found = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (found.has(file)) continue;
    const bytes = readFileSync(sourcePath(root, file), "utf8");
    found.add(file);
    pending.push(...configDependencies(root, file, bytes));
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const imports = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g;
    const urls = /\bnew\s+URL\s*\(\s*["'](\.[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;
    const dependencies = [
      ...[...bytes.matchAll(imports)].map(match => ({ value: match[1], sourceImport: true })),
      ...[...bytes.matchAll(urls)].filter(match => /\.[\w]+$/.test(match[1])).map(match => ({ value: match[1], sourceImport: false })),
    ];
    for (const { value, sourceImport } of dependencies) {
      const path = localPath(root, file, value);
      if (file === "server/message-search-worker.ts" && path === "server/message-search.worker.js") continue;
      pending.push(resolveDependency(root, path, sourceImport));
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
