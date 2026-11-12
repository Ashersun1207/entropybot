import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { digest, vitestResults } from "../full-gate/core.mjs";
import { identity as fullGateIdentity } from "../full-gate/dispositions.mjs";
import { diagnosticOccurrences, diagnosticIdentity, assertDiagnosticIdentities, diagnosticNodeResults } from "./diagnostic-identities.mjs";
import { diagnosticDispositions, reconcileDiagnostic, applicationCommands, loadSkipCatalog } from "./application-contract.mjs";

const group = "main-vitest-01";
const binding = { sourceSha: "a".repeat(40), runId: "42", attempt: "1" };
const row = (status = "passed") => ({ group, file: "synthetic.test.ts", fullName: "same title", status });
function report(root, statuses) {
  return { success: true, numTotalTests: statuses.length, numPassedTests: statuses.filter(s => s === "passed").length, numPendingTests: statuses.filter(s => s === "skipped").length,
    numFailedTests: 0, numTodoTests: 0, numFailedTestSuites: 0, numPendingTestSuites: 0,
    testResults: [{ name: join(root, "synthetic.test.ts"), status: "passed", assertionResults: statuses.map(status => ({ fullName: "same title", status })) }] };
}
for (const statuses of [["passed", "passed"], ["skipped", "skipped"], ["passed", "skipped"]]) test(`public Vitest parser retains both identical titles (${statuses.join("/")})`, () => {
  const root = resolve(import.meta.dirname, "../..");
  const raw = report(root, statuses);
  const parsed = vitestResults(raw, root, group);
  assert.equal(new Set(parsed.tests.map(fullGateIdentity)).size, 1);
  const tests = diagnosticOccurrences(parsed.tests);
  assert.equal(tests.length, statuses.length);
  assert.deepEqual(tests.map(t => t.status), statuses);
  assert.deepEqual(tests.map(t => t.occurrence), [0, 1]);
  assert.equal(new Set(tests.map(diagnosticIdentity)).size, 2);
  assertDiagnosticIdentities(tests);
  assert.deepEqual(diagnosticOccurrences(vitestResults(JSON.parse(JSON.stringify(raw)), root, group).tests), tests);
});
test("only colliding names get ordinals; unrelated assertions do not change their occurrence keys", () => {
  const unique = { ...row(), fullName: "unique title" };
  const a = diagnosticOccurrences([row(), unique, row("skipped")]);
  const b = diagnosticOccurrences([unique, row(), row("skipped")]);
  assert.equal(Object.hasOwn(a[1], "occurrence"), false);
  assert.equal(diagnosticIdentity(a[1]), fullGateIdentity(unique));
  assert.deepEqual(a.filter(t => t.fullName === "same title"), b.filter(t => t.fullName === "same title"));
  assert.throws(() => diagnosticOccurrences(a), /already assigned/);
});
for (const [name, tests] of [
  ["unassigned duplicate", [row(), row()]],
  ["duplicate ordinal", [{ ...row(), occurrence: 0 }, { ...row(), occurrence: 0 }]],
  ["missing ordinal", [{ ...row(), occurrence: 0 }, row()]],
  ["gap", [{ ...row(), occurrence: 0 }, { ...row(), occurrence: 2 }]],
  ["negative", [{ ...row(), occurrence: -1 }, { ...row(), occurrence: 1 }]],
  ["singleton ordinal", [{ ...row(), occurrence: 0 }]],
]) test(`diagnostic identity rejects ${name}`, () => assert.throws(() => assertDiagnosticIdentities(tests)));
test("duplicate skips each require their own source-bound declaration and exact occurrence disposition", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ma-occurrence-")));
  try {
    writeFileSync(join(root, "synthetic.test.ts"), "synthetic source");
    const sourceHash = digest("synthetic source");
    const declaration = { file: "synthetic.test.ts", fullName: "same title", class: "environment-not-provisioned", reason: "Full Chrome unavailable", targetPlatform: "darwin", sourceHash,
      evidenceRef: `synthetic.test.ts#sha256=${sourceHash}`, missingCapability: "pre-provisioned full Chrome", policyRef: null, targetEvidence: null };
    const base = loadSkipCatalog().catalog;
    const catalog = { ...base, entries: [0, 1].map(occurrence => ({ ...declaration, occurrence })) };
    const catalogPath = join(root, "catalog.json");
    writeFileSync(catalogPath, JSON.stringify(catalog));
    const loaded = loadSkipCatalog(catalogPath).catalog;
    for (const statuses of [["skipped", "skipped"], ["passed", "skipped"], ["passed", "passed"]]) {
      const tests = diagnosticOccurrences(statuses.map(row));
      const bundle = diagnosticDispositions(tests, loaded, root, binding);
      const check = b => reconcileDiagnostic(tests, b, binding, { policyExclusions: [] }, loaded);
      const result = check(bundle);
      assert.equal(result.total, 2); assert.equal(result.skipped, statuses.filter(s => s === "skipped").length);
      assert.equal(result.passed, statuses.filter(s => s === "passed").length);
      if (bundle.entries.length) {
        const missing = structuredClone(bundle); missing.entries.pop(); assert.throws(() => check(missing));
        const mismatch = structuredClone(bundle); mismatch.entries[0].occurrence = 9; assert.throws(() => check(mismatch));
        const noOrdinal = structuredClone(bundle); delete noOrdinal.entries[0].occurrence; assert.throws(() => check(noOrdinal));
        const extra = structuredClone(bundle); extra.entries.push(bundle.entries[0]); assert.throws(() => check(extra));
        const changed = structuredClone(bundle); changed.entries[0].sourceHash = "b".repeat(64); assert.throws(() => check(changed));
      }
    }
    assert.throws(() => diagnosticDispositions(diagnosticOccurrences([row("skipped"), row("skipped")]), { ...base, entries: [declaration] }, root, binding), /undeclared/);
    writeFileSync(catalogPath, JSON.stringify({ ...catalog, entries: [{ ...declaration, occurrence: -1 }] }));
    assert.throws(() => loadSkipCatalog(catalogPath), /shape/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("Node duplicate ordinals follow declaration testId rather than completion order", () => {
  const root = resolve(import.meta.dirname, "../..");
  const file = join(root, "synthetic.node-test.mjs");
  const declarations = [1, 2].map(testId => ({ type: "test:enqueue", data: { entryFile: file, file, testId, parentId: 0, name: "same title" } }));
  const terminal = declarations.map(event => ({ type: "test:pass", data: { ...event.data, skip: event.data.testId === 1, details: { type: "test" } } }));
  const summary = { type: "test:summary", data: { success: true, counts: { tests: 2, passed: 1, skipped: 1, failed: 0, cancelled: 0, todo: 0 } } };
  const parse = events => diagnosticNodeResults([...declarations, ...events, summary].map(e => JSON.stringify(e)).join("\n"), root);
  const a = parse(terminal); const b = parse([...terminal].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual(a.tests.map(t => [t.occurrence, t.status]), [[0, "skipped"], [1, "passed"]]);
  assertDiagnosticIdentities(a.tests);
});
test("all three static TypeScript commands use the fixed ordinary-CI heap argv and actual JS entry", () => {
  const root = resolve(import.meta.dirname, "../..");
  const commands = applicationCommands({ root, group: "static-checks" }).commands;
  assert.equal(commands.length, 7);
  const types = commands.slice(2, 5);
  assert.deepEqual(types.map(argv => argv.slice(0, 3)), Array.from({ length: 3 }, () => [process.execPath, "--max-old-space-size=6144", join(root, "node_modules/typescript/bin/tsc")]));
  assert.deepEqual(types.map(argv => argv.slice(3)), [["-p", "tsconfig.tools.json"], ["-b"], ["-p", "tsconfig.server.json"]]);
  const env = { PATH: "/usr/bin:/bin", HOME: tmpdir() };
  const version = spawnSync(types[0][0], [...types[0].slice(1, 3), "--version"], { env, encoding: "utf8", timeout: 10000 });
  assert.equal(version.status, 0, version.stderr); assert.match(version.stdout, /^Version /);
  const heap = spawnSync(types[0][0], [types[0][1], "--input-type=module", "-e", "import {getHeapStatistics} from 'node:v8'; console.log(getHeapStatistics().heap_size_limit)"], { env, encoding: "utf8", timeout: 10000 });
  assert.equal(heap.status, 0, heap.stderr); assert.ok(Number(heap.stdout) >= 6144 * 1024 ** 2);
  assert.equal(Object.hasOwn(env, "NODE_OPTIONS"), false);
});
