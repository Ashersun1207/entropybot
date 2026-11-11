import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { digest, source, unchanged } from "./full-gate/core.mjs";
import { producerClosure, verifyPins } from "./full-gate/trust.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const original = JSON.parse(readFileSync(join(ROOT, "scripts/full-gate/candidate-pins.json"), "utf8"));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "fg-closure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of Object.keys(original)) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    cpSync(join(ROOT, file), join(root, file));
  }
  const pins = { ...original };
  const put = (file, bytes) => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), bytes); };
  const read = file => readFileSync(join(root, file), "utf8");
  const repin = file => { pins[file] = digest(readFileSync(join(root, file))); };
  return { root, pins, put, read, repin };
}
function tinySource(t) {
  const root = mkdtempSync(join(tmpdir(), "fg-source-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
  writeFileSync(join(root, "file"), "synthetic source");
  git(["init", "--quiet"]); git(["add", "."]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture"]);
  writeFileSync(join(root, ".git/info/exclude"), "server\n");
  return { root, git, sha: git(["rev-parse", "HEAD"]) };
}
test("public source boundary accepts unchanged tiny repo without application roots", t => {
  const f = tinySource(t); const before = source(f.root, f.sha);
  unchanged(before, source(f.root, f.sha));
  mkdirSync(join(f.root, "server"));
  unchanged(before, source(f.root, f.sha));
});
for (const kind of ["file", "dangling symlink"]) test(`public source boundary rejects ignored worker ${kind}`, t => {
  const f = tinySource(t); const before = source(f.root, f.sha);
  mkdirSync(join(f.root, "server"));
  const file = join(f.root, "server/message-search.worker.js");
  if (kind === "file") writeFileSync(file, "throw new Error('ignored fixture');");
  else symlinkSync("missing-worker.js", file);
  assert.equal(f.git(["status", "--porcelain", "--untracked-files=all"]), "");
  assert.throws(() => source(f.root, f.sha), /generated worker fallback/);
  rmSync(file); unchanged(before, source(f.root, f.sha));
});
for (const suffix of ["ts", "tsx"]) test(`literal js import resolves reviewed ${suffix} source`, t => {
  const f = fixture(t); const parent = "scripts/testing/verification-server-preload.ts";
  const child = `scripts/testing/review-child.${suffix}`;
  f.put(parent, f.read(parent) + '\nimport "./review-child.js";'); f.repin(parent);
  assert.throws(() => producerClosure(f.root), /missing producer dependency/);
  f.put(child, "export const fixture = true;");
  assert.ok(producerClosure(f.root).includes(child));
  assert.throws(() => verifyPins(f.root, f.pins), /missing or extra/);
  f.repin(child); verifyPins(f.root, f.pins);
  f.put(child, "export const fixture = false;");
  assert.throws(() => verifyPins(f.root, f.pins), /altered/);
});
for (const suffixes of [["js", "ts"], ["js", "tsx"], ["ts", "tsx"]]) test(`js source ambiguity rejects ${suffixes.join(" and ")} even when pinned`, t => {
  const f = fixture(t); const parent = "scripts/testing/verification-server-preload.ts";
  f.put(parent, f.read(parent) + '\nimport "./review-child.js";'); f.repin(parent);
  for (const suffix of suffixes) { const child = `scripts/testing/review-child.${suffix}`; f.put(child, "export default 1;"); f.repin(child); }
  assert.throws(() => verifyPins(f.root, f.pins), /ambiguous/);
});
for (const [suffix, kind] of [["ts", "symlink"], ["ts", "directory"], ["js", "directory"]]) test(`js resolution rejects nonregular ${suffix} ${kind}`, t => {
  const f = fixture(t); const parent = "scripts/testing/verification-server-preload.ts";
  f.put(parent, f.read(parent) + '\nimport "./review-child.js";'); f.repin(parent);
  const child = join(f.root, `scripts/testing/review-child.${suffix}`);
  if (kind === "symlink") symlinkSync("missing-fixture.ts", child);
  else mkdirSync(child);
  assert.throws(() => producerClosure(f.root), /nonregular/);
});
test("single reviewed js executable is pinned without source substitution", t => {
  const f = fixture(t); const parent = "scripts/testing/verification-server-preload.ts";
  const child = "scripts/testing/review-child.js";
  f.put(parent, f.read(parent) + '\nimport "./review-child.js";'); f.repin(parent);
  f.put(child, "export default 1;");
  assert.throws(() => verifyPins(f.root, f.pins), /missing or extra/);
  f.repin(child); verifyPins(f.root, f.pins);
  f.put(child, "export default 2;"); assert.throws(() => verifyPins(f.root, f.pins), /altered/);
});
for (const [specifier, unsupported] of [["js", "js.ts"], ["mjs", "mts"], ["cjs", "cts"]]) test(`no unsupported ${specifier} substitution`, t => {
  const f = fixture(t); const parent = "scripts/testing/verification-server-preload.ts";
  f.put(parent, f.read(parent) + `\nimport "./review-child.${specifier}";`); f.repin(parent);
  f.put(`scripts/testing/review-child.${unsupported}`, "export default 1;");
  assert.throws(() => producerClosure(f.root), /missing producer dependency/);
});
test("literal executable URL requires its exact filename", t => {
  const f = fixture(t); const parent = "scripts/testing/verification-server-preload.ts";
  f.put(parent, f.read(parent) + '\nnew URL("./review-child.js", import.meta.url);'); f.repin(parent);
  f.put("scripts/testing/review-child.ts", "export default 1;");
  assert.throws(() => producerClosure(f.root), /missing producer dependency/);
});
for (const kind of ["directory", "server symlink"]) test(`public source policy rejects ignored ${kind}`, t => {
  const f = tinySource(t);
  if (kind === "server symlink") symlinkSync("missing-server", join(f.root, "server"));
  else mkdirSync(join(f.root, "server/message-search.worker.js"), { recursive: true });
  assert.equal(f.git(["status", "--porcelain", "--untracked-files=all"]), "");
  assert.throws(() => source(f.root, f.sha), /generated worker fallback|nonregular source server/);
});
const observed = [
  "scripts/testing/verification-server-preload.ts", "server/message-search.worker.ts",
  "cloudflare/control-plane/wrangler.jsonc", "cloudflare/control-plane/migrations/0001_better_auth_1_7_1.sql",
  "apps/docs/package.json", "scripts/testing/ci-retry-runner.ts",
];
for (const file of observed) {
  test(`review input rejects tampered bytes: ${file}`, t => {
    const f = fixture(t);
    assert.equal(verifyPins(f.root, f.pins), Object.keys(f.pins).length);
    f.put(file, f.read(file) + "\n ");
    assert.throws(() => verifyPins(f.root, f.pins));
  });
  test(`review input rejects deletion: ${file}`, t => {
    const f = fixture(t); rmSync(join(f.root, file));
    assert.throws(() => verifyPins(f.root, f.pins));
  });
}
test("candidate map excludes itself and rejects missing/extra entries", t => {
  const f = fixture(t);
  assert.equal(producerClosure(f.root).includes("scripts/full-gate/candidate-pins.json"), false);
  delete f.pins[observed[0]]; assert.throws(() => verifyPins(f.root, f.pins), /missing or extra/);
  f.pins[observed[0]] = original[observed[0]]; f.pins["unreviewed.ts"] = "a".repeat(64);
  assert.throws(() => verifyPins(f.root, f.pins), /missing or extra/);
});
for (const [parent, expression] of [
  ["scripts/testing/verification-lifecycle.ts", 'spawn(process.execPath, ["--import", new URL("./fixture-preload.ts", import.meta.url)]);'],
  ["server/message-search-worker.ts", 'new Worker(new URL("./fixture-preload.ts", import.meta.url));'],
]) test(`new URL executable and transitive import require pins: ${parent}`, t => {
  const f = fixture(t); const base = parent.slice(0, parent.lastIndexOf("/") + 1);
  f.put(parent, f.read(parent) + "\n" + expression); f.repin(parent);
  assert.throws(() => producerClosure(f.root), /missing producer dependency/);
  f.put(base + "fixture-preload.ts", 'import "./fixture-child.ts";');
  assert.throws(() => producerClosure(f.root), /missing producer dependency/);
  f.put(base + "fixture-child.ts", "export const fixture = true;");
  assert.throws(() => verifyPins(f.root, f.pins), /missing or extra/);
  f.repin(base + "fixture-preload.ts"); f.repin(base + "fixture-child.ts");
  verifyPins(f.root, f.pins);
  f.put(base + "fixture-child.ts", "throw new Error('changed fixture');");
  assert.throws(() => verifyPins(f.root, f.pins), /altered/);
});
for (const file of [observed[0], observed[1], observed[3], "apps/docs/package.json"]) {
  test(`symlink input rejected: ${file}`, t => {
    const f = fixture(t); rmSync(join(f.root, file));
    symlinkSync(join(ROOT, file), join(f.root, file));
    assert.throws(() => verifyPins(f.root, f.pins), /symlink|nonregular/);
  });
  test(`directory input rejected: ${file}`, t => {
    const f = fixture(t); rmSync(join(f.root, file)); mkdirSync(join(f.root, file));
    assert.throws(() => verifyPins(f.root, f.pins));
  });
}
test("symlink directory component rejected", t => {
  const f = fixture(t); rmSync(join(f.root, "cloudflare/control-plane/migrations"), { recursive: true });
  symlinkSync(join(ROOT, "cloudflare/control-plane/migrations"), join(f.root, "cloudflare/control-plane/migrations"));
  assert.throws(() => verifyPins(f.root, f.pins), /nonregular/);
});
test("new recursive migration content requires pins", t => {
  const f = fixture(t); const file = "cloudflare/control-plane/migrations/nested/new-input.txt";
  f.put(file, "synthetic SQL input");
  assert.ok(producerClosure(f.root).includes(file));
  assert.throws(() => verifyPins(f.root, f.pins), /missing or extra/);
  f.repin(file); verifyPins(f.root, f.pins);
  f.put(file, "altered SQL input"); assert.throws(() => verifyPins(f.root, f.pins), /altered/);
});
test("new config-derived main and migration tree require pins", t => {
  const f = fixture(t); const config = "cloudflare/control-plane/wrangler.jsonc";
  f.put(config, JSON.stringify({ main: "src/fixture-main.ts", d1_databases: [{ migrations_dir: "fixture-migrations" }] })); f.repin(config);
  assert.throws(() => producerClosure(f.root));
  f.put("cloudflare/control-plane/src/fixture-main.ts", 'import "./fixture-dependency.ts";');
  f.put("cloudflare/control-plane/src/fixture-dependency.ts", "export default 1;");
  f.put("cloudflare/control-plane/fixture-migrations/deep/schema.sql", "select 1;");
  const closure = producerClosure(f.root);
  for (const name of ["src/fixture-main.ts", "src/fixture-dependency.ts", "fixture-migrations/deep/schema.sql"]) assert.ok(closure.includes("cloudflare/control-plane/" + name));
  assert.throws(() => verifyPins(f.root, f.pins), /missing or extra/);
});
for (const entry of ["../../../outside.ts", "/absolute.ts", "src\\escape.ts", "src/index.ts?override"]) test(`unsafe config input rejects ${entry}`, t => {
  const f = fixture(t); f.put("cloudflare/control-plane/wrangler.jsonc", JSON.stringify({ main: entry }));
  assert.throws(() => producerClosure(f.root), /unsafe|outside/);
});
test("config alias cannot hide a symlink component before dot-dot", t => {
  const f = fixture(t); symlinkSync(join(ROOT, "server"), join(f.root, "cloudflare/control-plane/alias"));
  f.put("cloudflare/control-plane/wrangler.jsonc", JSON.stringify({ main: "alias/../src/index.ts" }));
  assert.throws(() => producerClosure(f.root), /nonregular/);
});
test("special migration input rejected without opening it", t => {
  const f = fixture(t); const file = join(f.root, "cloudflare/control-plane/migrations/fixture-pipe");
  execFileSync("mkfifo", [file]);
  assert.throws(() => producerClosure(f.root), /nonregular/);
});
test("JSONC comments preserve strings and still discover nested config inputs", t => {
  const f = fixture(t); const config = "cloudflare/control-plane/wrangler.jsonc";
  f.put(config, '{/* fixture */"main":"src/index.ts","vars":{"url":"https://fixture.invalid/a//b"},"env":{"fixture":{"main":"src/fixture.ts"}}}');
  f.put("cloudflare/control-plane/src/fixture.ts", "export default {};"); f.repin(config);
  assert.ok(producerClosure(f.root).includes("cloudflare/control-plane/src/fixture.ts"));
  assert.throws(() => verifyPins(f.root, f.pins), /missing or extra/);
});
test("new workspace manifest and executable config are discovered", t => {
  const f = fixture(t);
  f.put("pnpm-workspace.yaml", f.read("pnpm-workspace.yaml").replace('  - "apps/docs"', '  - "apps/docs"\n  - "apps/fixture"')); f.repin("pnpm-workspace.yaml");
  assert.throws(() => producerClosure(f.root));
  f.put("apps/fixture/package.json", '{"name":"fixture"}');
  f.put("apps/fixture/vitest.config.mjs", 'import "./fixture-config-helper.mjs";');
  f.put("apps/fixture/fixture-config-helper.mjs", "export default {};");
  for (const file of ["package.json", "vitest.config.mjs", "fixture-config-helper.mjs"]) assert.ok(producerClosure(f.root).includes("apps/fixture/" + file));
  assert.throws(() => verifyPins(f.root, f.pins), /missing or extra/);
});
test("new root executable config and runner string require pins", t => {
  const f = fixture(t); f.put("vitest.config.mjs", 'export default {test:{runner:"./fixture-runner.ts"}};');
  assert.throws(() => producerClosure(f.root));
  f.put("fixture-runner.ts", "export default {};");
  assert.ok(producerClosure(f.root).includes("fixture-runner.ts"));
  assert.throws(() => verifyPins(f.root, f.pins), /missing or extra/);
});
test("new executable module suffixes cannot evade discovery or traversal", t => {
  const f = fixture(t); f.put("scripts/full-gate/fixture.cts", 'import "./fixture-child.mts";');
  assert.throws(() => producerClosure(f.root), /missing producer dependency/);
  f.put("scripts/full-gate/fixture-child.mts", "export default {};");
  assert.throws(() => verifyPins(f.root, f.pins), /missing or extra/);
});
test("unsupported workspace patterns fail closed", t => {
  const f = fixture(t); f.put("pnpm-workspace.yaml", 'packages: [".", "apps/*"]');
  assert.throws(() => producerClosure(f.root), /unsupported workspace/);
});
test("ignored generated worker cannot enter a clean source producer", t => {
  const f = fixture(t);
  const git = args => execFileSync("git", args, { cwd: f.root, encoding: "utf8", env: { PATH: process.env.PATH, HOME: f.root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
  git(["init", "--quiet"]); git(["add", "."]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture"]);
  f.put(".git/info/exclude", "server/message-search.worker.js\n");
  const sha = git(["rev-parse", "HEAD"]); const before = source(f.root, sha);
  f.put("server/message-search.worker.js", "throw new Error('ignored generated fixture');");
  assert.equal(git(["status", "--porcelain", "--untracked-files=all"]), "");
  assert.throws(() => source(f.root, sha), /generated worker fallback/);
  assert.throws(() => verifyPins(f.root, f.pins), /generated worker fallback/);
  rmSync(join(f.root, "server/message-search.worker.js")); unchanged(before, source(f.root, sha));
  f.put("server/message-search.worker.js", "throw new Error('ignored generated fixture');");
  rmSync(join(f.root, "server/message-search.worker.ts"));
  assert.throws(() => producerClosure(f.root), /generated worker fallback/);
});
