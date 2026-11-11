import { constants, openSync, closeSync, fstatSync, readSync, lstatSync, realpathSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GateCommandRunner, GateCommandError } from "../patch-gate-process.ts";
import { installDigest, installEnvironment, validateBootstrapPolicy, type InstallBinding } from "./install-policy.ts";

type FixtureReview = { classification: "reviewed-owned-fixture-staging"; manifestSha256: string; launcherSha256: string; policy: unknown };
type BootstrapOptions = { ownedRoot: string; launcher: string; review: FixtureReview; binding: InstallBinding };
function insist(value: unknown, reason: string): asserts value { if (!value) throw new Error(`Bootstrap staging blocked: ${reason}`); }
function canonical(path: string): string {
  insist(/^\/[a-zA-Z0-9_./-]+$/.test(path) && realpathSync.native(path) === path && !lstatSync(path).isSymbolicLink(), "noncanonical fixture path");
  return path;
}
function bytes(path: string): Buffer {
  insist(Number.isInteger(constants.O_NOFOLLOW) && constants.O_NOFOLLOW !== 0 && Number.isInteger(constants.O_NONBLOCK) && constants.O_NONBLOCK !== 0, "safe file opening unavailable");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    insist(stat.isFile() && stat.size > 0 && stat.size <= 1_048_576, "nonregular or oversized fixture input");
    const result = Buffer.alloc(1_048_577);
    let count = 0;
    while (count < result.length) {
      const n = readSync(fd, result, count, result.length - count, null);
      if (n === 0) break;
      count += n;
    }
    insist(count > 0 && count <= 1_048_576, "fixture read bound exceeded");
    return result.subarray(0, count);
  } finally { closeSync(fd); }
}
// This API's caller is a trusted application runner reviewing owned fixture bytes, not an external receipt authority.
export async function stageReviewedBootstrap(options: BootstrapOptions) {
  insist(process.platform === "darwin" && process.arch === "arm64", "unsupported host (Darwin arm64 only)");
  const { review, binding } = options;
  insist(review?.classification === "reviewed-owned-fixture-staging", "explicit fixture review required");
  const target = validateBootstrapPolicy(review.policy, binding);
  const root = canonical(options.ownedRoot);
  insist(lstatSync(root).isDirectory(), "owned root is not a directory");
  const launcher = canonical(options.launcher);
  insist(launcher === join(root, "verified-bootstrap-darwin.sh"), "launcher outside owned root");
  insist(installDigest(bytes(launcher)) === review.launcherSha256, "launcher approval mismatch");
  const manifest = bytes(join(root, "reviewed-bootstrap.manifest"));
  insist(installDigest(manifest) === review.manifestSha256, "manifest approval mismatch");
  const rows = manifest.toString("utf8").trimEnd().split("\n");
  insist(rows.shift() === "reviewed-owned-fixture-staging|darwin|arm64|24.22.2|10.33.0|inventory-not-extraction-proof", "unsupported inventory profile");
  insist(rows.length > 0 && rows.length <= 256, "inventory bound");
  const files: Record<string, string> = {};
  const names = new Set<string>();
  for (const row of rows) {
    const [kind, hash, path, extra] = row.split("|");
    insist(extra === undefined && /^(?:archives|node|pnpm|source)\/[a-zA-Z0-9_./-]+$/.test(path ?? "") && !names.has(path), "invalid or duplicate inventory row");
    insist(kind === "D" && hash === "-" || kind === "F" && /^[a-f0-9]{64}$/.test(hash), "invalid inventory type/hash");
    names.add(path);
    if (kind === "F") files[path] = hash;
  }
  const policy = review.policy as { sourceHashes: Record<string, string> };
  const expected = {
    "node/bin/node": target.node.executableSha256, "archives/node.fixture": target.node.archiveSha256,
    "pnpm/bin/pnpm.cjs": target.pnpm.entrySha256, "archives/pnpm.fixture": target.pnpm.archiveSha256,
    "source/policy.json": installDigest(JSON.stringify(review.policy)),
    ...Object.fromEntries(Object.entries(policy.sourceHashes).map(([key, hash]) => [`source/${key}`, hash])),
  };
  insist(target.node.executable === join(root, "node/bin/node") && target.pnpm.executable === target.node.executable && target.pnpm.executableSha256 === target.node.executableSha256 && target.pnpm.entry === join(root, "pnpm/bin/pnpm.cjs"), "reviewed tool paths mismatch");
  for (const [path, hash] of Object.entries(expected)) insist(files[path] === hash, "policy/inventory mismatch");
  insist(files["source/entry.mjs"], "missing source entry identity");
  for (const [path, url] of [["source/bootstrap-stage.ts", import.meta.url], ["source/install-policy.ts", new URL("./install-policy.ts", import.meta.url)], ["source/patch-gate-process.ts", new URL("../patch-gate-process.ts", import.meta.url)]] as const) {
    const sourcePath = typeof url === "string" ? new URL(url) : url;
    insist(files[path] === installDigest(bytes(fileURLToPath(sourcePath))), "source closure identity mismatch");
  }
  const home = join(root, "home");
  insist(!existsSync(home) && !existsSync(join(root, "source/node_modules")), "preexisting dependencies/profile/store");
  const outerEnv = { HOME: root, USERPROFILE: root, PATH: "/usr/bin:/bin", CI: "true", OMB_EVAL_LIVE: "0" };
  const launcherArgv = ["/usr/bin/env", "-i", ...Object.entries(outerEnv).map(([key, value]) => `${key}=${value}`), "/bin/bash", "--noprofile", "--norc", launcher, root, review.manifestSha256, review.launcherSha256];
  const runner = new GateCommandRunner({ commandTimeoutMs: 5000, overallTimeoutMs: 15000, graceMs: 100, killWaitMs: 1000, handleSignals: false });
  const startedAt = new Date().toISOString();
  const commands = [];
  try {
    const first = await runner.run(launcherArgv[0], launcherArgv.slice(1), { cwd: root, env: outerEnv, forwardOutput: false });
    commands.push({ argv: launcherArgv, env: outerEnv, ...first });
    mkdirSync(home);
    const env = installEnvironment({ home, platform: binding.platform, path: [dirname(target.node.executable), "/usr/bin", "/bin"] });
    for (const key of ["XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "TMPDIR", "npm_config_cache", "npm_config_store_dir", "PNPM_HOME"]) mkdirSync(env[key], { recursive: true });
    writeFileSync(env.npm_config_userconfig, "registry=https://registry.npmjs.org/\nstrict-ssl=true\noptional=true\n", { flag: "wx" });
    writeFileSync(env.npm_config_globalconfig, "", { flag: "wx" });
    const argv = [target.node.executable, target.pnpm.entry!, "--version"];
    const second = await runner.run(argv[0], argv.slice(1), { cwd: join(root, "source"), env, forwardOutput: false });
    commands.push({ argv, env, ...second });
  } catch (error) {
    if (!(error instanceof GateCommandError)) throw error;
    throw new Error(`Bootstrap staging blocked: owned command failed (${error.kind}): ${error.output?.stderr ?? ""}`);
  } finally { await runner.close(); }
  const observed = Object.fromEntries(Object.keys(files).map(path => [path, installDigest(bytes(join(root, path)))]));
  insist(Object.entries(files).every(([path, hash]) => observed[path] === hash), "fixture changed during execution");
  const receipt = {
    schemaVersion: 1, kind: "bootstrap-stage", classification: review.classification, binding,
    bindingAuthority: "caller assertions; not authenticated GitHub job metadata",
    installation: "not-attempted", policyHash: installDigest(JSON.stringify(review.policy)),
    launcher: { path: launcher, expected: review.launcherSha256, observed: installDigest(bytes(launcher)) },
    manifest: { expected: review.manifestSha256, observed: installDigest(bytes(join(root, "reviewed-bootstrap.manifest"))) },
    tools: { node: target.node, pnpm: target.pnpm, corepack: "not-invoked" },
    sourceAndDistribution: { expected: files, observed }, commands, startedAt, finishedAt: new Date().toISOString(),
    qualification: { complete: false, blockers: ["Owned stand-ins only; real Node/pnpm archives and provisioning unqualified", "Application Node after trusted OS launcher only; earlier workflow JavaScript unqualified", "No installation, lifecycle, workspace hooks, assets or resource qualification", "Trusted disposable host/kernel/loader/runner/OS utilities/initial environment; no concurrent writers; no TOCTOU or in-kernel deadline guarantee"] },
  };
  insist(receipt.launcher.observed === receipt.launcher.expected && receipt.manifest.observed === receipt.manifest.expected, "launcher/manifest drift");
  writeFileSync(join(root, "bootstrap-stage.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  return receipt;
}
