import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { source, unchanged, exact, nodeFiles, vitestResults, strictTap, digest, insist } from "../full-gate/core.mjs";
import { nodeResults } from "../full-gate/node-results.mjs";
import { regularBytes } from "../full-gate/artifact-input.mjs";
import { beginResourceAudit, validateResourceAudit } from "../full-gate/resource-audit.mjs";
import { createGateCapability, assertGateLeases } from "../testing/verification-lifecycle.ts";
import { environment, recordCommand, writeReport, sealReports } from "./contract.mjs";
import { APPLICATION_GROUPS, applicationCommands, applicationCoverage, diagnosticDispositions, reconcileDiagnostic, loadSkipCatalog } from "./application-contract.mjs";

export function provisionDiagnosticCache(root, home) {
  const links = [".vite", ".vite-temp"].map(name => {
    const target = join(home, name);
    const path = join(root, "node_modules", name);
    insist(!existsSync(path), "diagnostic cache must be fresh before dependency snapshot");
    mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, path);
    return { path, target, purpose: "mutable Vite output outside executable dependency inventory; link itself inventoried" };
  });
  return links;
}
export async function applicationGroup({ root, reports, binding, group, before }) {
  const home = realpathSync(mkdtempSync("/private/tmp/ma-"));
  const env = { ...environment(home, dirname(realpathSync(process.execPath))), OMB_VITEST_WORKERS: "2" };
  for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "TMPDIR", "npm_config_cache", "npm_config_store_dir", "PNPM_HOME"]) mkdirSync(env[key], { recursive: true, mode: 0o700 });
  for (const key of ["npm_config_userconfig", "npm_config_globalconfig"]) writeFileSync(env[key], "", { flag: "wx", mode: 0o600 });
  mkdirSync(join(home, "server-logs"), { mode: 0o700 });
  env.OMB_VERIFICATION_EVIDENCE_DIR = join(home, "server-logs");
  const laneBinding = { ...binding, group };
  const capability = createGateCapability(home, laneBinding);
  const out = join(home, "reports"); mkdirSync(out, { mode: 0o700 });
  const auditPath = join(reports, `${group}-resource-audit.json`);
  const audit = await beginResourceAudit({ root, home, binding: laneBinding, output: auditPath, processCapability: capability });
  const receipt = { kind: "macos-application-diagnostic-group", binding: laneBinding, before, home, startedAt: new Date().toISOString(), completeQualification: false, completeCleanup: false, commands: 0 };
  const originals = group === "electron-node" ? [["report.tap", "tap.txt"], ["node-events.jsonl", "events.log"]] : group.startsWith("main-vitest-") ? [["report.json", "results.json"]] : [];
  const run = async (argv, name, timeoutMs) => {
    unchanged(before, source(root, binding.sourceSha));
    const result = await recordCommand({ reports, name: `${group}-${name}`, executable: argv[0], argv: argv.slice(1), cwd: root, env, timeoutMs, capability });
    receipt.commands++;
    unchanged(before, source(root, binding.sourceSha));
    return result.stdout;
  };
  let failure;
  try {
    const files = group === "electron-node" ? nodeFiles(root) : undefined;
    const command = applicationCommands({ root, group, capability, out, files });
    let parsed;
    if (command.list) {
      const discovered = JSON.parse(await run(command.list, "discover", 120000));
      insist(Array.isArray(discovered) && discovered.length > 0 && discovered.every(f => typeof f.file === "string" && !f.projectName), "invalid application discovery");
      receipt.discovered = discovered.map(f => resolve(root, f.file).slice(root.length + 1)).sort();
      await run(command.argv, "run", 1500000);
      parsed = vitestResults(JSON.parse(regularBytes(join(out, "report.json"))), root, group);
    } else {
      for (const [index, argv] of command.commands.entries()) await run(argv, `command-${index + 1}`, group === "electron-node" ? 1500000 : 900000);
      if (group === "electron-node") {
        const totals = strictTap(regularBytes(join(out, "report.tap")).toString());
        parsed = nodeResults(regularBytes(join(out, "node-events.jsonl")).toString(), root, group);
        insist(parsed.total === totals.tests && parsed.passed === totals.pass && parsed.skipped === totals.skipped, "application TAP/event mismatch");
        receipt.discovered = files;
        exact(parsed.files, files, "application Node discovery");
      }
    }
    if (parsed) {
      receipt.files = parsed.files;
      const { catalog, bytes } = loadSkipCatalog();
      receipt.skipCatalogHash = digest(bytes);
      const policy = JSON.parse(readFileSync(new URL("../full-gate/policy.json", import.meta.url), "utf8"));
      writeReport(reports, `${group}-identities.json`, parsed.tests);
      const dispositions = diagnosticDispositions(parsed.tests, catalog, root, binding);
      writeReport(reports, `${group}-dispositions.json`, dispositions);
      receipt.counts = reconcileDiagnostic(parsed.tests, dispositions, binding, policy, catalog);
    }
    assertGateLeases(capability, receipt.files?.map(file => join(root, file)));
    receipt.success = true;
  } catch (error) { failure = error; receipt.success = false; receipt.error = String(error); }
  finally {
    try {
      for (const [input, output] of originals) if (existsSync(join(out, input))) writeReport(reports, `${group}-${output}`, regularBytes(join(out, input)).toString());
    } catch (error) { failure ??= error; receipt.success = false; receipt.reportError = String(error); }
    try {
      const result = await audit.finish();
      receipt.resourceAuditHash = digest(readFileSync(auditPath));
      validateResourceAudit(result, laneBinding);
      receipt.after = source(root, binding.sourceSha);
      unchanged(before, receipt.after);
    } catch (error) { failure ??= error; receipt.success = false; receipt.finalizationError = String(error); }
    receipt.finishedAt = new Date().toISOString();
    writeReport(reports, `${group}-receipt.json`, receipt);
    sealReports(reports, mkdtempSync(join(dirname(reports), "ma-quarantine-")), capability.secret);
  }
  if (failure) throw failure;
  return receipt;
}
export async function applicationSuites({ root, reports, binding, before, phase }) {
  const records = [];
  for (const group of APPLICATION_GROUPS) await phase(`application-${group}`, async () => {
    records.push(await applicationGroup({ root, reports, binding, group, before }));
  });
  await phase("application-exact-coverage", async () => {
    applicationCoverage(records);
    const counts = records.filter(r => r.counts).reduce((sum, r) => ({ total: sum.total + r.counts.total, passed: sum.passed + r.counts.passed, skipped: sum.skipped + r.counts.skipped }), { total: 0, passed: 0, skipped: 0 });
    writeReport(reports, "application-summary.json", { kind: "macos-application-diagnostic", binding, groups: APPLICATION_GROUPS, ...counts, failed: 0, todo: 0, retries: 0, completeQualification: false, completeCleanup: false, formalDispositionAcceptance: false });
  });
}
