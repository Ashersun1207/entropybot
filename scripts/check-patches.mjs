import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
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

export function verifyPatchBehavior(root = repositoryRoot) {
  const failures = checkPatchContracts(root);
  if (failures.length) throw new Error(failures.join("\n"));
  const temporary = mkdtempSync(join(tmpdir(), "entropybot-patch-gate-"));
  const report = join(temporary, "vitest.json");
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TMPDIR", "TEMP", "TMP", "CI"].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  Object.assign(env, { HOME: temporary, USERPROFILE: temporary, OMB_VITEST_WORKERS: "1" });
  const run = (args) => {
    const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" });
    if (result.error || result.status !== 0) throw new Error(`behavior command failed (${result.status ?? result.error?.message}): node ${args.join(" ")}`);
  };
  try {
    run([join(root, "node_modules/vitest/vitest.mjs"), "run", "--root", root, "--config", join(root, "vite.config.ts"), "--configLoader", "native", "--reporter=default", "--reporter=json", `--outputFile.json=${report}`, ...vitestFiles]);
    const results = JSON.parse(readFileSync(report, "utf8"));
    for (const file of vitestFiles) {
      const suite = results.testResults.find(result => resolve(root, result.name) === resolve(root, file));
      if (!suite?.assertionResults.length || suite.status !== "passed" || suite.assertionResults.some(test => test.status !== "passed")) {
        throw new Error(`[behavior] ${file}: missing, failed or skipped tests`);
      }
    }
    for (const file of nodeTestFiles) {
      const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", file], { cwd: root, env, encoding: "utf8" });
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
      const count = Number(/(?:^|\n)# tests (\d+)/.exec(result.stdout ?? "")?.[1]);
      const skipped = /(?:^|\n)# (?:skipped|todo) [1-9]/.test(result.stdout ?? "");
      if (result.error || result.status !== 0 || !(count > 0) || skipped) throw new Error(`[behavior] ${file}: failed, empty or skipped Node tests`);
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--verify") || args.length > 1) throw new Error("Usage: node scripts/check-patches.mjs [--verify] (repository selected by script location)");
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Patch contracts require Node >=24");
  const failures = checkPatchContracts();
  if (failures.length) throw new Error(`Patch contracts failed:\n${failures.join("\n")}`);
  console.log(`Patch structure OK (${callContracts.length + valueContracts.length} contracts); behavior ${args.length ? "running" : "NOT RUN (use --verify)"}`);
  if (args.length) {
    verifyPatchBehavior();
    console.log("Patch behavior gate OK");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
