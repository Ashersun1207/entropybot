import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GateCommandRunner } from "./patch-gate-process.ts";
import { assertGateLeases, createGateCapability, gateBootstrapArgs, gateVitestWorkerArg } from "./testing/verification-lifecycle.ts";
import ts from "typescript";
import { parse as parseYaml } from "yaml";
import { callContracts, valueContracts, vitestFiles, nodeTestFiles, inventory } from "./patch-contracts.mjs";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(node, predicate) {
  const found = [];
  function visit(child) {
    if (predicate(child)) found.push(child);
    ts.forEachChild(child, visit);
  }
  visit(node);
  return found;
}

function nameOf(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : undefined;
}

export function checkPatchContracts(root = repositoryRoot) {
  const failures = [];
  if (!vitestFiles.length || !nodeTestFiles.length || !callContracts.length || !valueContracts.length) failures.push("[manifest] contract and behavior test lists must be non-empty");
  const trees = new Map();
  const read = (file) => {
    const path = resolve(root, file);
    const inside = relative(root, path);
    if (inside.startsWith("..") || isAbsolute(inside)) throw new Error(`outside repository: ${file}`);
    return readFileSync(path, "utf8");
  };
  const tree = (file) => {
    if (!trees.has(file)) {
      const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
      if (source.parseDiagnostics.length) throw new Error(`cannot parse ${file}`);
      trees.set(file, source);
    }
    return trees.get(file);
  };
  for (const file of new Set([...inventory, ...vitestFiles, ...nodeTestFiles])) {
    try { read(file); } catch { failures.push(`[inventory] missing/unreadable file: ${file}`); }
  }
  for (const { id, file, symbol, from, minimum = 1 } of callContracts) {
    try {
      const source = tree(file);
      let local = symbol;
      if (from) {
        const imports = source.statements.filter(node => ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && node.moduleSpecifier.text === from);
        const specifier = imports.flatMap(node => node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
          ? node.importClause.namedBindings.elements : []).find(node => !node.isTypeOnly && nameOf(node.propertyName ?? node.name) === symbol);
        if (!specifier) throw new Error(`missing value import ${symbol} from ${from}`);
        local = specifier.name.text;
      }
      const calls = walk(source, child => ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === local);
      if (calls.length < minimum) throw new Error(`expected >=${minimum} call(s) to ${symbol}; found ${calls.length}`);
    } catch (error) { failures.push(`[${id}] ${file}: ${error.message}`); }
  }
  for (const { id, file, variable, path, expected } of valueContracts) {
    try {
      let value;
      if (file.endsWith(".yml")) {
        value = parseYaml(read(file));
      } else {
        const declarations = walk(tree(file), node => ts.isVariableDeclaration(node) && nameOf(node.name) === variable);
        if (declarations.length !== 1) throw new Error(`expected one declaration of ${variable}`);
        const literal = declarations[0].initializer;
        if (!literal || !ts.isStringLiteral(literal)) throw new Error(`${variable} must be a string literal`);
        value = literal.text;
      }
      for (const key of path ?? []) value = value?.[key];
      if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error(`${variable ?? path.join(".")} expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
    } catch (error) { failures.push(`[${id}] ${file}: ${error.message}`); }
  }
  return failures.map(failure => `${failure}\n  Behavior gate: node "${join(root, "scripts/check-patches.mjs")}" --verify`);
}

export function validateVitestReport(results, root = repositoryRoot) {
  if (!Array.isArray(results?.testResults)) throw new Error("[behavior] invalid Vitest report");
  for (const file of vitestFiles) {
    const suite = results.testResults.find(result => typeof result?.name === "string" && resolve(root, result.name) === resolve(root, file));
    if (!Array.isArray(suite?.assertionResults) || !suite.assertionResults.length || suite.status !== "passed" || suite.assertionResults.some(test => test?.status !== "passed")) {
      throw new Error(`[behavior] ${file}: missing, failed or skipped tests`);
    }
  }
}

export function validateNodeReport(stdout, file) {
  const count = (name) => Number(new RegExp(`(?:^|\\n)# ${name} (\\d+)(?:\\r?\\n|$)`).exec(stdout)?.[1]);
  if (!(count("tests") > 0) || count("pass") !== count("tests") || ["fail", "cancelled", "skipped", "todo"].some(name => count(name) !== 0)) {
    throw new Error(`[behavior] ${file}: incomplete, empty, failed or skipped Node tests`);
  }
}

export async function verifyPatchBehavior(root = repositoryRoot, options = {}) {
  root = realpathSync(root);
  const failures = checkPatchContracts(root);
  if (failures.length) throw new Error(failures.join("\n"));
  const runner = new GateCommandRunner(options);
  let temporary;
  let primaryError;
  let internalResourcesConfirmed = false;
  try {
    runner.assertActive();
    temporary = mkdtempSync(join(tmpdir(), "entropybot-patch-gate-"));
    const report = join(temporary, "vitest.json");
    const capability = createGateCapability(temporary);
    const bootstrap = gateBootstrapArgs(capability);
    const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TMPDIR", "TEMP", "TMP", "CI", "OMB_VITEST_RETRY_LOG", "OMB_VITEST_RETRY_RUN_ID", "OMB_VITEST_RETRY_BATCH_ID"].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    Object.assign(env, { HOME: temporary, USERPROFILE: temporary, OMB_VITEST_WORKERS: "1" });
    await runner.run(process.execPath, [...bootstrap, join(root, "node_modules/vitest/vitest.mjs"), "run", "--root", root, "--config", join(root, "vite.config.ts"), "--configLoader", "native", gateVitestWorkerArg(capability), "--reporter=default", "--reporter=json", `--outputFile.json=${report}`, ...vitestFiles], { cwd: root, env }, "Vitest patch suites");
    validateVitestReport(JSON.parse(readFileSync(report, "utf8")), root);
    assertGateLeases(capability, vitestFiles.map(file => resolve(root, file)));
    for (const file of nodeTestFiles) {
      const result = await runner.run(process.execPath, [...bootstrap, "--test", "--test-reporter=tap", file], { cwd: root, env, timeoutMs: 120_000 }, file);
      validateNodeReport(result.stdout, file);
    }
    runner.assertActive();
    assertGateLeases(capability, vitestFiles.map(file => resolve(root, file)));
    internalResourcesConfirmed = true;
  } catch (error) {
    primaryError = error;
  } finally {
    await runner.close();
    if (temporary) {
      if (!primaryError && runner.ownedGroupStopped && internalResourcesConfirmed) {
        try { rmSync(temporary, { recursive: true, force: true }); } catch (error) {
          const message = `[cleanup] could not remove temporary data ${temporary}: ${error.message}`;
          if (primaryError) console.error(message);
          else primaryError = new Error(message, { cause: error });
        }
      }
      if (primaryError || !runner.ownedGroupStopped || !internalResourcesConfirmed) {
        primaryError ??= new Error("Verification resources not confirmed");
        console.error(`[cleanup] retained temporary data (gate failed or verification resources unknown): ${temporary}`);
        try {
          writeFileSync(join(temporary, "lifecycle-failure.json"), JSON.stringify({ kind: primaryError?.kind, message: primaryError?.message, ownedGroupStopped: runner.ownedGroupStopped, internalResourcesConfirmed, evidence: primaryError?.evidence }), { mode: 0o600 });
        } catch (error) { console.error(`[cleanup] could not write lifecycle evidence: ${error.message}`); }
      }
    }
  }
  if (primaryError) throw primaryError;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--verify") || args.length > 1) throw new Error("Usage: node scripts/check-patches.mjs [--verify] (repository selected by script location)");
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Patch contracts require Node >=24");
  const failures = checkPatchContracts();
  if (failures.length) throw new Error(`Patch contracts failed:\n${failures.join("\n")}`);
  console.log(`Patch structure OK (${callContracts.length + valueContracts.length} contracts); behavior ${args.length ? "running" : "NOT RUN (use --verify)"}`);
  if (args.length) {
    await verifyPatchBehavior();
    console.log("Patch behavior gate OK");
  }
}

function invokedAsMain() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href; } catch { return false; }
}

if (invokedAsMain()) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
