import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isBuiltin, registerHooks } from "node:module";
import { createHash } from "node:crypto";

const entry = new URL("../macos-qualification/run.mjs", import.meta.url).href;
const original = readFileSync(new URL(entry), "utf8");
const boundary = original.indexOf("const [reportArgument, sha, runId, attempt, mode]");
assert.ok(boundary > 0, "qualification startup boundary missing");
const loaded = [];
const denied = [];
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (!isBuiltin(specifier) && !specifier.startsWith(".") && !specifier.startsWith("file:")) {
      denied.push(specifier);
      throw Object.assign(new Error("preinstall package unavailable"), { code: "ERR_MODULE_NOT_FOUND" });
    }
    const result = next(specifier, context);
    assert.ok(!result.url.includes("/node_modules/"), "preinstall resolved an installed dependency");
    return result;
  },
  load(url, context, next) {
    loaded.push(url);
    if (url !== entry) return next(url, context);
    // Import the real static startup graph without executing host checks, downloads, installation or diagnostics.
    return { format: "module", shortCircuit: true, source: original.slice(0, boundary) + "export const preinstallImported = true;\n" };
  },
});
try {
  const result = await import(entry);
  assert.equal(result.preinstallImported, true);
  assert.deepEqual(denied, []);
  const startupModules = [...loaded];
  assert.ok(!startupModules.some(url => url.endsWith("/macos-qualification/window.mjs") || url.endsWith("/control-omb.ts")));
  for (const name of ["yaml", "zod"]) await assert.rejects(import(name), { code: "ERR_MODULE_NOT_FOUND" });
  assert.deepEqual(denied, ["yaml", "zod"]);
  console.log(JSON.stringify({ mode: process.argv[3], preinstallImported: true, sourceSha256: createHash("sha256").update(original).digest("hex"), startupModules, deniedPackageControls: denied }));
} finally { hooks.deregister(); }
