import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GROUPS, STEPS, insist, coverage, vitestResults, strictTap, safeArgv, validateReceipt, unchanged, source, digest, nodeFiles, exact } from "./core.mjs";
import { nodeResults } from "./node-results.mjs";
import { reconcile } from "./dispositions.mjs";
import { regularBytes } from "./artifact-input.mjs";
import { loadSameRun } from "./same-run.mjs";
import { ROOT, provenance } from "./runner.mjs";
import { validateResourceAudit } from "./resource-audit.mjs";
import { requireInstallation } from "./install-policy.ts";

export function verdict(check, directory, env = process.env) {
  insist(STEPS.includes(check), "unknown verdict invariant");
  const before = provenance(env);
  const entries = readdirSync(directory).sort();
  insist(JSON.stringify(entries) === JSON.stringify([...GROUPS, "static-checks", "collection.json"].sort()), "missing/extra artifact directories");
  const installPolicy = JSON.parse(readFileSync(new URL("./install-policy.json", import.meta.url), "utf8"));
  for (const job of [...GROUPS, "static-checks"]) {
    const observation = JSON.parse(regularBytes(join(directory, job, "install-observation.json")));
    requireInstallation(observation, { sourceSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, job, platform: job === "broker-vitest" ? "linux" : job === "control-plane-vitest" ? "win32" : "darwin", arch: observation.binding?.arch }, installPolicy);
  }
  const records = GROUPS.map(group => {
    const record = JSON.parse(regularBytes(join(directory, group, "receipt.json")));
    insist(record.group === group && record.sha === env.GITHUB_SHA && record.attempt === "1", "receipt identity mismatch");
    return record;
  });
  const parsed = records.map(record => {
    const raw = regularBytes(join(directory, record.group, record.group === "electron-node" ? "report.tap" : "report.json"));
    insist(digest(raw) === record.reportHash, "report altered");
    let result;
    if (record.group === "electron-node") {
      const totals = strictTap(raw.toString());
      result = nodeResults(regularBytes(join(directory, record.group, "node-events.jsonl")).toString(), ROOT, record.group);
      insist(result.total === totals.tests && result.passed === totals.pass && result.skipped === totals.skipped, "TAP/event totals mismatch");
    } else result = vitestResults(JSON.parse(raw), ROOT, record.group);
    exact(result.files, record.files, "report/receipt file coverage");
    return result;
  });
  if (check === STEPS[0]) {
    const main = records.filter(r => r.group.startsWith("main-vitest-"));
    insist(main.every(r => JSON.stringify(r.discovered) === JSON.stringify(main[0].discovered)), "shard discovery changed");
    const nodes = nodeFiles(ROOT);
    exact(records[12].files, nodes, "final-tree Node discovery");
    exact(records[12].argv.slice(-nodes.length), nodes, "exact Node argv");
    coverage(records, { main: main[0].discovered, "broker-vitest": records[10].discovered, "control-plane-vitest": records[11].discovered, "electron-node": nodes });
  } else if (check === STEPS[1]) {
    for (const record of records) {
      safeArgv(record.argv);
      insist(record.exitCode === 0 && record.timedOut === false, "nonzero or timeout");
    }
  } else if (check === STEPS[2]) {
    for (const record of records) {
      const auditBytes = regularBytes(join(directory, record.group, "resource-audit.json"));
      insist(digest(auditBytes) === record.resources?.resourceAuditHash, "independent resource audit altered");
      validateResourceAudit(JSON.parse(auditBytes), { sourceSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, group: record.group });
      validateReceipt(record, env.GITHUB_SHA);
      for (const phase of ["before", "after"]) insist(regularBytes(join(directory, record.group, `processes-${phase}.log`)).length > 0, "missing process evidence");
    }
    insist(false, "detached-resource audit not implemented; receipt assertions alone are insufficient");
  } else if (check === STEPS[3]) {
    const reviewDirectory = join(directory, "../full-gate-dispositions");
    const bundle = JSON.parse(regularBytes(join(reviewDirectory, "platform-dispositions.json")));
    const trust = JSON.parse(readFileSync(join(ROOT, "scripts/full-gate/disposition-trust.json"), "utf8"));
    const binding = { sourceSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID };
    const sameRun = loadSameRun(directory, binding, digest(readFileSync(join(ROOT, "pnpm-lock.yaml"))), { mailFixture: trust.mailFixture });
    const result = reconcile(parsed.flatMap(r => r.tests), bundle, binding, { publicKeys: trust.controllerPublicKeys, sameRun });
    writeFileSync(join(reviewDirectory, "verdict.json"), JSON.stringify(result));
  } else {
    for (const record of records) { unchanged(before, record.before); unchanged(before, record.after); }
    const statics = JSON.parse(regularBytes(join(directory, "static-checks/static.json")));
    insist(statics.success === true && statics.commands === 7, "static checks incomplete");
    unchanged(before, statics.before); unchanged(before, statics.after);
  }
  unchanged(before, source(ROOT, env.GITHUB_SHA));
  return { invariant: check, sha: env.GITHUB_SHA, verified: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(verdict(process.argv[2], process.argv[3]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
