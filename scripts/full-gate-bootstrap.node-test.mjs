import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, rmSync, existsSync, symlinkSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { stageReviewedBootstrap } from "./full-gate/bootstrap-stage.ts";
import { installDigest as hash, installEnvironment, requireInstallation, validateBootstrapPolicy, validateInstallPolicy } from "./full-gate/install-policy.ts";
const binding = { sourceSha: "a".repeat(40), runId: "9", attempt: "1", job: "main-vitest-01", platform: "darwin", arch: "arm64" };
const production = JSON.parse(readFileSync(new URL("./full-gate/install-policy.json", import.meta.url)));
const evidence = process.env.FULL_GATE_BOOTSTRAP_EVIDENCE;
function retain(name, value) {
  if (!evidence) return;
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, `${name}.json`), JSON.stringify(value, null, 2), { flag: "wx" });
}
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fg-bootstrap-")));
  for (const dir of ["archives", "node/bin", "node/lib", "pnpm/bin", "pnpm/lib", "source", "fake-path"]) mkdirSync(join(root, dir), { recursive: true });
  const put = (path, content, mode = 0o600) => writeFileSync(join(root, path), content, { mode });
  put("archives/node.fixture", "owned fixture node archive bytes; no extraction asserted\n");
  put("archives/pnpm.fixture", "owned fixture pnpm archive bytes; no extraction asserted\n");
  put("node/bin/node", '#!/bin/bash\nset -eu\nprintf "%s\\n" "$@" >> "${HOME%/home}/marker"\nexec /bin/bash --noprofile --norc "$@"\n', 0o700);
  put("node/lib/runtime.fixture", "owned complete runtime inventory\n");
  put("pnpm/lib/module.fixture", "owned complete module inventory\n");
  put("source/entry.mjs", 'printf "first-stage-fixture\\n"\n/usr/bin/env\n');
  put("pnpm/bin/pnpm.cjs", '[[ $1 == --version ]] || exit 42\nprintf "pnpm-standin-10.33.0\\n"\n/usr/bin/env\n');
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) put(`source/${file}`, `synthetic ${file}\n`);
  for (const file of ["bootstrap-stage.ts", "install-policy.ts"]) copyFileSync(new URL(`./full-gate/${file}`, import.meta.url), join(root, "source", file));
  copyFileSync(new URL("./patch-gate-process.ts", import.meta.url), join(root, "source/patch-gate-process.ts"));
  copyFileSync(new URL("../server/verification-group-history.ts", import.meta.url), join(root, "source/verification-group-history.ts"));
  copyFileSync(new URL("../server/browser/chrome/processes.ts", import.meta.url), join(root, "source/chrome-processes.ts"));
  const launcher = join(root, "verified-bootstrap-darwin.sh");
  copyFileSync(new URL("./full-gate/verified-bootstrap-darwin.sh", import.meta.url), launcher);
  const node = { version: "24.22.2", executable: join(root, "node/bin/node"), executableSha256: hash(readFileSync(join(root, "node/bin/node"))), archiveUrl: "https://nodejs.org/owned-fixture", archiveSha256: hash(readFileSync(join(root, "archives/node.fixture"))) };
  const pnpm = { ...node, version: "10.33.0", archiveUrl: "https://registry.npmjs.org/owned-fixture", archiveSha256: hash(readFileSync(join(root, "archives/pnpm.fixture"))), entry: join(root, "pnpm/bin/pnpm.cjs"), entrySha256: hash(readFileSync(join(root, "pnpm/bin/pnpm.cjs"))) };
  const policy = { ...production, classification: "reviewed-owned-fixture-staging", targets: [{ platform: "darwin", arch: "arm64", node, pnpm }], sourceHashes: Object.fromEntries(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"].map(f => [f, hash(readFileSync(join(root, "source", f)))])), bootstrap: { provisioning: "reviewed-fixture-inventory-not-extraction-proof", nodeDistribution: "node", pnpmDistribution: "pnpm" } };
  put("source/policy.json", JSON.stringify(policy));
  let manifest = "reviewed-owned-fixture-staging|darwin|arm64|24.22.2|10.33.0|inventory-not-extraction-proof\n";
  function inventory(dir) {
    for (const name of readdirSync(join(root, dir)).sort()) {
      const path = `${dir}/${name}`;
      const directory = lstatSync(join(root, path)).isDirectory();
      manifest += `${directory ? "D|-" : `F|${hash(readFileSync(join(root, path)))}`}|${path}\n`;
      if (directory) inventory(path);
    }
  }
  for (const dir of ["archives", "node", "pnpm", "source"]) inventory(dir);
  put("reviewed-bootstrap.manifest", manifest);
  for (const name of ["node", "pnpm", "corepack"]) put(`fake-path/${name}`, `#!/bin/bash\nprintf fake >> '${root}/fake-marker'\nexit 42\n`, 0o700);
  return { root, launcher, review: { classification: "reviewed-owned-fixture-staging", manifestSha256: hash(manifest), launcherSha256: hash(readFileSync(launcher)), policy }, binding, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}
function shell(f, env = {}, controlled = true) {
  const args = controlled ? ["-i", `HOME=${f.root}`, `PATH=${f.root}/fake-path:/usr/bin:/bin`, "/bin/bash", "--noprofile", "--norc", f.launcher, f.root, f.review.manifestSha256, f.review.launcherSha256] : ["/bin/bash", "--noprofile", "--norc", f.launcher, f.root, f.review.manifestSha256, f.review.launcherSha256];
  const startedAt = new Date().toISOString();
  const result = spawnSync("/usr/bin/env", args, { env: { HOME: f.root, PATH: "/usr/bin:/bin", ...env }, encoding: "utf8", timeout: 3000 });
  retain(`shell-${serial++}`, { argv: ["/usr/bin/env", ...args], env, startedAt, finishedAt: new Date().toISOString(), ...result });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}
let serial = 0;
test("reviewed owned stand-ins launch only after native verification; typed post-Node profile and incomplete receipt", async () => {
  const f = fixture();
  try {
    const receipt = await stageReviewedBootstrap({ ...f, ownedRoot: f.root });
    retain("positive-stage", receipt);
    assert.equal(receipt.kind, "bootstrap-stage");
    assert.equal(receipt.installation, "not-attempted");
    assert.equal(receipt.qualification.complete, false);
    assert.deepEqual(receipt.sourceAndDistribution.expected, receipt.sourceAndDistribution.observed);
    assert.equal(receipt.commands.length, 2);
    assert.match(receipt.commands[0].stdout, /first-stage-fixture/);
    assert.match(receipt.commands[1].stdout, /pnpm-standin-10.33.0/);
    const observedEnvs = receipt.commands.map(command => Object.fromEntries(command.stdout.trim().split("\n").slice(1).map(line => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; })));
    for (const key of ["HOME", "USERPROFILE", "PATH", "CI", "OMB_EVAL_LIVE"]) assert.equal(observedEnvs[0][key], receipt.commands[0].env[key]);
    for (const [key, value] of Object.entries(receipt.commands[1].env)) assert.equal(observedEnvs[1][key], value);
    for (const env of observedEnvs) for (const key of ["BASH_ENV", "ENV", "NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES"]) assert.equal(env[key], undefined);
    assert.deepEqual(receipt.commands[1].env, installEnvironment({ home: join(f.root, "home"), platform: "darwin", path: [join(f.root, "node/bin"), "/usr/bin", "/bin"] }));
    for (const command of receipt.commands) {
      assert.equal(command.evidence.exitCode, 0);
      assert.ok(command.evidence.closeAt);
      assert.equal(command.outputTruncated, false);
    }
    assert.equal(existsSync(join(f.root, "fake-marker")), false);
    assert.equal(existsSync(join(f.root, "full-gate-install.json")), false);
    for (const job of ["main-vitest-01", "static-checks", "electron-node", "broker-vitest", "control-plane-vitest"]) for (const complete of [false, true]) assert.throws(() => requireInstallation({ ...receipt, qualification: { complete } }, { ...binding, job }, f.review.policy), /legacy or missing/);
    assert.throws(() => validateInstallPolicy(f.review.policy, binding), /not implemented/);
  } finally { f.cleanup(); }
});
for (const file of ["archives/node.fixture", "node/bin/node", "archives/pnpm.fixture", "pnpm/bin/pnpm.cjs", "node/lib/runtime.fixture", "pnpm/lib/module.fixture", "source/entry.mjs", "source/bootstrap-stage.ts", "source/install-policy.ts", "source/verification-group-history.ts", "source/chrome-processes.ts", "source/package.json", "source/pnpm-lock.yaml", "source/policy.json"]) test(`tampered ${file} rejects before owned execution`, () => {
  const f = fixture();
  try { writeFileSync(join(f.root, file), "tampered\n"); assert.notEqual(shell(f).status, 0); assert.equal(existsSync(join(f.root, "marker")), false); } finally { f.cleanup(); }
});
for (const kind of ["missing", "extra", "link", "fifo", "directory", "preexisting-deps", "preexisting-store", "config-drift", "manifest-fifo", "bad-root", "no-approval", "launcher-drift"]) test(`${kind} rejects before opening/executing candidates`, () => {
  const f = fixture();
  try {
    const path = join(f.root, "node/lib/runtime.fixture");
    if (["missing", "link", "fifo", "directory"].includes(kind)) rmSync(path);
    if (kind === "link") symlinkSync(join(f.root, "pnpm/lib/module.fixture"), path);
    if (kind === "fifo") execFileSync("/usr/bin/mkfifo", [path]);
    if (kind === "directory") mkdirSync(path);
    if (kind === "extra") writeFileSync(join(f.root, "pnpm/lib/extra"), "extra");
    if (kind === "preexisting-deps") mkdirSync(join(f.root, "source/node_modules"));
    if (kind === "preexisting-store") mkdirSync(join(f.root, "home/store"), { recursive: true });
    if (kind === "config-drift") writeFileSync(join(f.root, "source/.npmrc"), "unreviewed");
    if (kind === "manifest-fifo") { rmSync(join(f.root, "reviewed-bootstrap.manifest")); execFileSync("/usr/bin/mkfifo", [join(f.root, "reviewed-bootstrap.manifest")]); }
    if (kind === "bad-root") f.root += "/../" + f.root.split("/").at(-1);
    if (kind === "no-approval") f.review.manifestSha256 = "";
    if (kind === "launcher-drift") writeFileSync(f.launcher, readFileSync(f.launcher, "utf8") + "\n# drift\n");
    assert.notEqual(shell(f).status, 0);
    assert.equal(existsSync(join(f.root, "marker")), false);
  } finally { f.cleanup(); }
});
test("empty production approvals and candidate metadata never launch Node or pnpm", async () => {
  const f = fixture();
  try {
    for (const policy of [production, { ...production, candidates: f.review.policy.targets }]) await assert.rejects(stageReviewedBootstrap({ ...f, ownedRoot: f.root, review: { ...f.review, policy } }), /staging profile|approval/);
    await assert.rejects(stageReviewedBootstrap({ ...f, ownedRoot: f.root, review: undefined }), /review required/);
    assert.equal(existsSync(join(f.root, "marker")), false);
  } finally { f.cleanup(); }
});
for (const platform of ["linux", "win32"]) test(`${platform} is explicitly unsupported before candidates`, () => {
  const f = fixture();
  try { assert.throws(() => validateBootstrapPolicy(f.review.policy, { ...binding, platform }), /unsupported/); assert.equal(existsSync(join(f.root, "marker")), false); } finally { f.cleanup(); }
});
test("actual BASH_ENV/ENV startup canaries are removed by the controlled outer env launcher", () => {
  const f = fixture();
  try {
    const canary = join(f.root, "shell-canary");
    const marker = join(f.root, "startup-marker");
    writeFileSync(canary, `printf canary >> '${marker}'\n`);
    const control = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", ":"], { env: { BASH_ENV: canary }, timeout: 2000 });
    assert.equal(control.status, 0); assert.ok(existsSync(marker)); rmSync(marker);
    const envControl = spawnSync("/bin/sh", ["-i", "-c", ":"], { env: { ENV: canary }, encoding: "utf8", timeout: 2000 });
    assert.equal(envControl.status, 0); assert.ok(existsSync(marker)); rmSync(marker);
    const result = shell(f, { BASH_ENV: canary, ENV: canary });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(join(f.root, "fake-marker")), false);
  } finally { f.cleanup(); }
});
test("actual owned Node preload canary demonstrates initial runtime boundary and env-i removal", () => {
  const f = fixture();
  try {
    const marker = join(f.root, "preload-marker");
    const canary = join(f.root, "preload.cjs");
    writeFileSync(canary, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'loaded');`);
    const env = { HOME: f.root, PATH: "/usr/bin:/bin", NODE_OPTIONS: `--require=${canary}`, NODE_PATH: f.root };
    const positive = spawnSync(process.execPath, ["-e", ""], { env, timeout: 2000 });
    assert.equal(positive.status, 0); assert.ok(existsSync(marker)); rmSync(marker);
    const clean = spawnSync("/usr/bin/env", ["-i", `HOME=${f.root}`, process.execPath, "-e", ""], { env, timeout: 2000 });
    assert.equal(clean.status, 0); assert.equal(existsSync(marker), false);
    assert.equal(shell(f, env).status, 0);
    assert.equal(existsSync(marker), false);
  } finally { f.cleanup(); }
});
for (const key of ["ENV", "NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD"]) test(`unclean direct shell refuses ${key} before candidate execution`, () => {
  const f = fixture();
  try { const result = shell(f, { [key]: "owned-startup-canary" }, false); assert.notEqual(result.status, 0); assert.match(result.stderr, /inherited .* control/); assert.equal(existsSync(join(f.root, "marker")), false); } finally { f.cleanup(); }
});
