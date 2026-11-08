import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const required = [
  "scripts/patch-gate-process.ts",
  "scripts/verification-receipt/bridge.ts",
  "scripts/testing/verification-lifecycle.ts",
  "scripts/testing/verification-external-stop.ts",
  "scripts/testing/verification-server-preload.ts",
];

function parse(config) {
  const result = ts.parseJsonConfigFileContent(config, ts.sys, root);
  assert.deepEqual(result.errors, []);
  return result;
}

function coverage(config) {
  const result = parse(config);
  assert.equal(result.options.strict, true);
  assert.equal(result.options.noEmit, true);
  assert.equal(result.options.erasableSyntaxOnly, true);
  for (const file of required) assert.ok(result.fileNames.includes(resolve(root, file)), `missing tool root: ${file}`);
  return result;
}

const load = () => {
  const result = ts.readConfigFile(join(root, "tsconfig.tools.json"), ts.sys.readFile);
  assert.equal(result.error, undefined, "tool config must be readable");
  return result.config;
};

test("tool compiler project explicitly includes critical entries with strict no-emit options", () => {
  const parsed = coverage(load());
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  assert.ok(program.getSourceFile(join(root, "server/verification-process-scope.ts")), "transitive lifecycle contract must be resolved");
});

test("coverage rejects a dropped entry or disabled strictness", () => {
  const config = load();
  for (const file of required) {
    assert.throws(() => coverage({ ...config, files: config.files.filter((entry) => entry !== file) }), /missing tool root/);
  }
  assert.throws(() => coverage({ ...config, compilerOptions: { ...config.compilerOptions, strict: false } }));
});

test("real tsc accepts clean copied sources and rejects independent type errors", () => {
  const parsed = coverage(load());
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const scratch = mkdtempSync(join(tmpdir(), "tool-types-"));
  try {
    for (const file of ["package.json", "tsconfig.tools.json", "tsconfig.server.json"]) cpSync(join(root, file), join(scratch, file));
    for (const source of program.getSourceFiles()) {
      const name = relative(root, source.fileName);
      if (name.startsWith("..") || isAbsolute(name) || name.split(/[\\/]/).includes("node_modules")) continue;
      const destination = join(scratch, name);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(source.fileName, destination);
    }
    symlinkSync(resolve(root, "node_modules"), join(scratch, "node_modules"), "dir");
    const compile = () => spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", join(scratch, "tsconfig.tools.json"), "--pretty", "false"], {
      cwd: scratch, timeout: 20_000, encoding: "utf8", maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: scratch, USERPROFILE: scratch, LANG: "en_US.UTF-8" },
    });
    const healthy = compile();
    assert.equal(healthy.status, 0, `${healthy.error ?? ""}\n${healthy.stdout}\n${healthy.stderr}`);
    for (const file of ["scripts/verification-receipt/bridge.ts", "scripts/testing/verification-server-preload.ts"]) {
      const target = join(scratch, file);
      const original = readFileSync(target, "utf8");
      writeFileSync(target, `${original}\nconst injected: number = "independent type error";\nvoid injected;\n`);
      const broken = compile();
      assert.notEqual(broken.status, 0);
      assert.match(broken.stdout, /TS2322/);
      assert.ok(broken.stdout.includes(file));
      writeFileSync(target, original);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
