import { lstatSync, realpathSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";
import { GateCommandRunner, GateCommandError } from "../patch-gate-process.ts";
import { installEnvironment, installDigest, validateInstallBinding, type InstallBinding } from "./install-policy.ts";

type SyntheticCommand = { root: string; tempRoot: string; entry: string; args: string[]; binding: InstallBinding; timeoutMs: number; executable?: string };
function ownedPath(path: string): string {
  if (!isAbsolute(path) || realpathSync.native(path) !== path || lstatSync(path).isSymbolicLink()) throw new Error("Noncanonical synthetic recorder path");
  return path;
}
function inside(root: string, path: string): void {
  const part = relative(root, path);
  if (!part || part === ".." || part.startsWith("../") || isAbsolute(part)) throw new Error("Synthetic recorder entry/root escapes owned fixture");
}
function sourceSnapshot(root: string) {
  return Object.fromEntries(["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"].map(file => {
    const path = ownedPath(join(root, file));
    if (!lstatSync(path).isFile()) throw new Error("Synthetic source snapshot requires regular files");
    return [file, installDigest(readFileSync(path))];
  }));
}
export async function recordSyntheticCommand(options: SyntheticCommand) {
  const { binding, timeoutMs, args } = options;
  validateInstallBinding(binding);
  if (binding.platform !== process.platform || binding.arch !== process.arch) throw new Error("Synthetic recorder target mismatch");
  const root = ownedPath(options.root);
  const tempRoot = ownedPath(options.tempRoot);
  inside(tempRoot, root);
  inside(root, options.entry);
  const entry = ownedPath(options.entry);
  if (!lstatSync(entry).isFile() || !entry.endsWith(".mjs")) throw new Error("Synthetic recorder requires owned mjs entry");
  if (!Array.isArray(args) || args.some(v => typeof v !== "string" || v.includes("\0"))) throw new Error("Invalid recorder argv");
  const executable = options.executable ?? process.execPath;
  if (options.executable !== undefined && options.executable !== join(tempRoot, "missing-node")) throw new Error("Executable override is restricted to the synthetic spawn-failure fixture");
  const before = sourceSnapshot(root);
  const entryBefore = installDigest(readFileSync(entry));
  const home = join(tempRoot, "install-home");
  mkdirSync(home);
  const env = installEnvironment({ home, platform: binding.platform, path: [dirname(process.execPath), "/usr/bin", "/bin"] });
  for (const key of ["XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "TMPDIR", "npm_config_cache", "npm_config_store_dir", "PNPM_HOME"]) mkdirSync(env[key], { recursive: true });
  writeFileSync(env.npm_config_userconfig, "registry=https://registry.npmjs.org/\nstrict-ssl=true\noptional=true\n", { flag: "wx" });
  writeFileSync(env.npm_config_globalconfig, "", { flag: "wx" });
  const policy: unknown = JSON.parse(readFileSync(new URL("./install-policy.json", import.meta.url), "utf8"));
  const runner = new GateCommandRunner({ commandTimeoutMs: timeoutMs, overallTimeoutMs: timeoutMs + 8000, graceMs: 100, killWaitMs: 1000, handleSignals: false });
  const startedAt = new Date().toISOString();
  let stdout = "";
  let stderr = "";
  let failure: GateCommandError | undefined;
  let evidence;
  let outputTruncated: boolean | null = null;
  try {
    const result = await runner.run(executable, [entry, ...args], { cwd: root, env, forwardOutput: false });
    ({ stdout, stderr, evidence, outputTruncated } = result);
  } catch (error) {
    if (!(error instanceof GateCommandError)) throw error;
    failure = error;
    evidence = error.evidence;
    stdout = error.output?.stdout ?? "";
    stderr = error.output?.stderr ?? "";
    outputTruncated = error.output?.outputTruncated ?? null;
  } finally { await runner.close(); }
  const finishedAt = new Date().toISOString();
  const after = sourceSnapshot(root);
  const receipt = {
    schemaVersion: 1, kind: "install-observation", synthetic: true, binding, policyHash: installDigest(JSON.stringify(policy)),
    source: { before, after, unchanged: JSON.stringify(before) === JSON.stringify(after), gitProvenance: "not-observed-synthetic-fixture" },
    command: { argv: [executable, entry, ...args], cwd: root, env }, startedAt, finishedAt,
    tools: { node: { path: executable, version: null, launcherVersion: process.versions.node, sha256: null, approval: "unqualified" }, entry: { path: entry, beforeSha256: entryBefore, afterSha256: installDigest(readFileSync(entry)) }, pnpm: null, corepack: null },
    outcome: { spawned: evidence?.pid !== undefined, exitCode: evidence?.exitCode ?? null, signal: evidence?.signal ?? null, timedOut: failure?.kind === "timeout", stdioClosed: evidence?.closeAt !== undefined, ownedGroupStopped: runner.ownedGroupStopped, failureKind: failure?.kind ?? null, evidence },
    logs: { stdout: { sha256: installDigest(stdout), bytes: Buffer.byteLength(stdout) }, stderr: { sha256: installDigest(stderr), bytes: Buffer.byteLength(stderr) }, outputTruncated },
    stdout, stderr, frozen: null, installedEntries: [], lifecycle: { status: "not-observed", invocations: [], outputs: [], networkHistory: "unknown" },
    qualification: { complete: false, limits: ["Synthetic recorder only; no dependency installation performed", "Launcher Node startup environment/identity unqualified", "No native lifecycle/network history observation", "No installed dependency entry approval", "Bounded POSIX process group supervision is not an OS sandbox or egress policy"] },
  };
  writeFileSync(join(tempRoot, "synthetic-install-observation.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  return receipt;
}
