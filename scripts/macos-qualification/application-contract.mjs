import { join } from "node:path";
import { readFileSync } from "node:fs";
import { digest, exact, insist, safeArgv } from "../full-gate/core.mjs";
import { identity } from "../full-gate/dispositions.mjs";
import { vitestCommand } from "../full-gate/vitest-command.mjs";
import { gateBootstrapArgs } from "../testing/verification-lifecycle.ts";

export const APPLICATION_GROUPS = [...Array.from({ length: 10 }, (_, i) => `main-vitest-${String(i + 1).padStart(2, "0")}`), "electron-node", "static-checks"];
export function applicationCommands({ root, group, capability, out, files }) {
  insist(APPLICATION_GROUPS.includes(group), "unknown macOS application group");
  if (group.startsWith("main-vitest-")) return vitestCommand({ root, cwd: root, group, capability, out });
  const commands = group === "electron-node" ? [[process.execPath, ...gateBootstrapArgs(capability), "--test", "--test-concurrency=2", "--test-reporter=tap", `--test-reporter-destination=${join(out, "report.tap")}`, `--test-reporter=${join(root, "scripts/full-gate/node-reporter.mjs")}`, `--test-reporter-destination=${join(out, "node-events.jsonl")}`, ...files]] : [
    ["/usr/bin/git", "diff", "--check"],
    [join(root, "node_modules/.bin/oxlint"), "--deny-warnings", "."],
    [join(root, "node_modules/.bin/tsc"), "-p", "tsconfig.tools.json"],
    [join(root, "node_modules/.bin/tsc"), "-b"],
    [join(root, "node_modules/.bin/tsc"), "-p", "tsconfig.server.json"],
    [process.execPath, "scripts/entropybot-release.mjs", "check"],
    [process.execPath, "scripts/check-patches.mjs", "--verify"],
  ];
  if (group === "electron-node") exact(files, files, "Node entries");
  commands.forEach(safeArgv);
  return { commands };
}
const assertionKey = row => JSON.stringify([row.file, row.fullName]);
const concrete = value => typeof value === "string" && value.trim().length > 3 && !/^(unknown|unresolved|pending|todo|tbd)$/i.test(value);
export function diagnosticDispositions(tests, catalog, root, binding) {
  insist(catalog.schemaVersion === 1 && Array.isArray(catalog.entries), "invalid diagnostic declarations");
  insist(new Set(catalog.entries.map(assertionKey)).size === catalog.entries.length, "duplicate diagnostic declaration");
  const entries = tests.filter(t => t.status === "skipped").map(test => {
    const declaration = catalog.entries.find(row => assertionKey(row) === assertionKey(test));
    insist(declaration, `undeclared skip: ${identity(test)}`);
    insist(digest(readFileSync(join(root, test.file))) === declaration.sourceHash, `skip source changed: ${test.file}`);
    return { ...declaration, group: test.group };
  });
  return { kind: "macos-application-diagnostic-dispositions", ...binding, entries };
}
export function reconcileDiagnostic(tests, bundle, binding, policy, catalog = JSON.parse(readFileSync(new URL("./skip-declarations.json", import.meta.url), "utf8"))) {
  insist(tests.length > 0 && new Set(tests.map(identity)).size === tests.length, "empty/duplicate test identities");
  insist(tests.every(t => ["passed", "skipped"].includes(t.status)), "failure/todo/nonterminal test");
  insist(bundle?.kind === "macos-application-diagnostic-dispositions" && ["sourceSha", "runId", "attempt"].every(k => bundle[k] === binding[k]) && binding.attempt === "1", "diagnostic disposition binding mismatch");
  const skipped = tests.filter(t => t.status === "skipped");
  insist(Array.isArray(bundle.entries) && bundle.entries.length === skipped.length, "undeclared/extra diagnostic skip");
  insist(new Set(bundle.entries.map(identity)).size === bundle.entries.length, "duplicate diagnostic disposition");
  const actual = new Set(skipped.map(identity));
  for (const entry of bundle.entries) {
    insist(actual.has(identity(entry)), "mismatched diagnostic skip");
    const declared = catalog.entries.find(row => assertionKey(row) === assertionKey(entry));
    insist(declared && Object.entries(declared).every(([key, value]) => entry[key] === value), "diagnostic classification differs from source-bound declaration");
    insist(Object.keys(entry).sort().join() === ["group", "file", "fullName", "class", "reason", "targetPlatform", "sourceHash", "evidenceRef", "missingCapability", "policyRef", "targetEvidence"].sort().join(), "unexpected diagnostic disposition fields");
    insist(["platform-specific", "environment-not-provisioned", "policy-prohibited"].includes(entry.class), "invalid diagnostic class");
    insist(concrete(entry.reason) && /^[a-f0-9]{64}$/.test(entry.sourceHash) && entry.evidenceRef === `${entry.file}#sha256=${entry.sourceHash}`, "invalid diagnostic source/reason reference");
    if (entry.class === "platform-specific") {
      insist(["linux", "win32"].includes(entry.targetPlatform) && entry.targetEvidence === "not-supplied" && entry.policyRef === null && entry.missingCapability === null, "invalid platform-specific diagnostic disposition");
    } else if (entry.class === "environment-not-provisioned") {
      insist(entry.targetPlatform === "darwin" && concrete(entry.missingCapability) && entry.policyRef === null && entry.targetEvidence === null, "missing capability or misclassified environment disposition");
    } else {
      const prefix = "scripts/full-gate/policy.json#policyExclusions/";
      const index = typeof entry.policyRef === "string" && entry.policyRef.startsWith(prefix) ? entry.policyRef.slice(prefix.length) : "";
      const exclusion = /^(0|[1-9]\d*)$/.test(index) ? policy.policyExclusions[Number(index)] : null;
      insist(exclusion?.file === entry.file && entry.reason === exclusion.reason && entry.targetPlatform === "darwin" && entry.missingCapability === null && entry.targetEvidence === null, "invalid policy exclusion citation");
    }
  }
  return { total: tests.length, passed: tests.length - skipped.length, skipped: skipped.length, failed: 0, todo: 0, retries: 0,
    strictGreen: skipped.length === 0, completeQualification: false, completeCleanup: false,
    status: skipped.length ? "diagnostic-only-with-skips" : "diagnostic-only", targetPlatformEvidence: "not-supplied", formalDispositionAcceptance: false };
}
export function applicationCoverage(records) {
  exact(records.map(r => r.group), APPLICATION_GROUPS, "macOS application groups");
  const main = records.filter(r => r.group.startsWith("main-vitest-"));
  insist(main.every(r => JSON.stringify(r.discovered) === JSON.stringify(main[0].discovered)), "discovery changed between shards");
  exact(main.flatMap(r => r.files), main[0].discovered, "macOS main shard coverage");
  const nodes = records.find(r => r.group === "electron-node");
  exact(nodes.files, nodes.discovered, "macOS Node coverage");
  insist(records.find(r => r.group === "static-checks").commands === 7, "incomplete static checks");
}
