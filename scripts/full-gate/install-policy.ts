import { createHash } from "node:crypto";
import { readFileSync, realpathSync, constants, openSync, closeSync, fstatSync, readSync } from "node:fs";
import { posix, win32, join } from "node:path";

type RecordValue = Record<string, unknown>;
export type InstallBinding = { sourceSha: string; runId: string; attempt: string; job: string; platform: string; arch: string };
export type ToolApproval = { version: string; executable: string; executableSha256: string; archiveUrl: string; archiveSha256: string; entry?: string; entrySha256?: string };
export type InstallTarget = { platform: string; arch: string; node: ToolApproval; pnpm: ToolApproval; corepack?: ToolApproval };
export type InstallEnvironmentOptions = { home: string; platform: string; path: string[]; fixedWindows?: Record<string, string> };
export const installDigest = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
function requireValue(value: unknown, message: string): asserts value { if (!value) throw new Error(`Full gate installation blocked: ${message}`); }
function record(value: unknown): RecordValue { requireValue(value && typeof value === "object" && !Array.isArray(value), "missing object"); return value as RecordValue; }
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0 && !/[\0\r\n]/.test(value); }
function sha256(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
export function validateInstallBinding(binding: InstallBinding): void {
  requireValue(/^[a-f0-9]{40}$/.test(binding.sourceSha) && /^[1-9]\d*$/.test(binding.runId) && binding.attempt === "1", "invalid source/run/attempt");
  requireValue(/^(?:main-vitest-(?:0[1-9]|10)|static-checks|electron-node|broker-vitest|control-plane-vitest)$/.test(binding.job), "invalid producer job");
  requireValue(["darwin", "linux", "win32"].includes(binding.platform) && ["arm64", "x64"].includes(binding.arch), "invalid platform/architecture");
}
export function installEnvironment(options: InstallEnvironmentOptions): Record<string, string> {
  const { home, platform, path, fixedWindows = {} } = options;
  const names = Object.keys(fixedWindows).map(k => k.toUpperCase());
  requireValue(new Set(names).size === names.length, "case-insensitive duplicate environment keys");
  const paths = platform === "win32" ? win32 : posix;
  requireValue(text(home) && paths.isAbsolute(home) && paths.normalize(home) === home, "noncanonical synthetic home");
  requireValue(path.length > 0 && path.every(p => text(p) && paths.isAbsolute(p) && !p.includes(paths.delimiter) && paths.normalize(p) === p), "invalid fixed executable path");
  const env: Record<string, string> = {
    HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: paths.join(home, "config"), XDG_CACHE_HOME: paths.join(home, "cache"), XDG_DATA_HOME: paths.join(home, "data"), XDG_STATE_HOME: paths.join(home, "state"),
    TMPDIR: paths.join(home, "tmp"), TMP: paths.join(home, "tmp"), TEMP: paths.join(home, "tmp"), PATH: path.join(paths.delimiter),
    CI: "true", OMB_EVAL_LIVE: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: platform === "win32" ? "NUL" : "/dev/null",
    npm_config_userconfig: paths.join(home, "npmrc"), npm_config_globalconfig: paths.join(home, "global-npmrc"), npm_config_cache: paths.join(home, "npm-cache"),
    npm_config_registry: "https://registry.npmjs.org/", npm_config_strict_ssl: "true", npm_config_optional: "true", npm_config_store_dir: paths.join(home, "store"),
    PNPM_HOME: paths.join(home, "pnpm"),
  };
  if (platform === "win32") {
    const expected = { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", ComSpec: "C:\\Windows\\System32\\cmd.exe", PATHEXT: ".COM;.EXE;.BAT;.CMD", SystemDrive: "C:" };
    requireValue(JSON.stringify(Object.keys(fixedWindows).sort()) === JSON.stringify(Object.keys(expected).sort()) && Object.entries(expected).every(([k,v]) => fixedWindows[k] === v), "Windows fixed OS environment is unapproved");
    Object.assign(env, expected, { APPDATA: paths.join(home,"AppData","Roaming"), LOCALAPPDATA: paths.join(home,"AppData","Local") });
  } else requireValue(Object.keys(fixedWindows).length === 0, "unexpected Windows environment");
  requireValue(Object.values(env).every(text), "invalid environment value");
  return env;
}
function approvedTool(value: unknown, paths: typeof posix, origins: string[]): RecordValue {
  const tool = record(value);
  requireValue(text(tool.version) && /^\d+\.\d+\.\d+$/.test(tool.version), "exact tool version approval missing");
  requireValue(text(tool.executable) && paths.isAbsolute(tool.executable) && sha256(tool.executableSha256) && sha256(tool.archiveSha256), "tool executable/archive approval missing");
  requireValue(text(tool.archiveUrl), "tool archive URL approval missing");
  const url = new URL(tool.archiveUrl);
  requireValue(url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.search && origins.includes(url.origin), "tool archive origin unapproved");
  return tool;
}
export function validateInstallPolicy(value: unknown, binding: InstallBinding): InstallTarget {
  validateInstallBinding(binding);
  const policy = record(value);
  requireValue(policy.schemaVersion === 1 && policy.registry === "https://registry.npmjs.org/" && policy.pnpmVersion === "10.33.0", "unsupported policy or package-manager version");
  requireValue(Array.isArray(policy.targets), "target approvals missing");
  const matches = policy.targets.map(record).filter(t => t.platform === binding.platform && t.arch === binding.arch);
  requireValue(matches.length === 1, "exact platform/architecture toolchain approval missing");
  const target = matches[0];
  const paths = binding.platform === "win32" ? win32 : posix;
  const node = approvedTool(target.node, paths, ["https://nodejs.org"]);
  requireValue(typeof node.version === "string" && Number(node.version.split(".")[0]) >= 24, "Node version approval incompatible");
  const pnpm = approvedTool(target.pnpm, paths, ["https://registry.npmjs.org"]);
  requireValue(pnpm.version === "10.33.0" && text(pnpm.entry) && paths.isAbsolute(pnpm.entry) && sha256(pnpm.entrySha256), "pnpm entry/version/digest approval missing");
  if (target.corepack !== undefined) approvedTool(target.corepack, paths, ["https://registry.npmjs.org"]);
  const hashes = record(policy.sourceHashes);
  requireValue(["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"].every(k => sha256(hashes[k])), "manifest/workspace/lock approvals missing");
  requireValue(policy.bootstrap !== null && policy.bootstrap !== undefined, "pre-JavaScript bootstrap approval missing");
  // This implementation cannot establish bootstrap or native hook network history from caller-supplied fields.
  throw new Error("Full gate installation blocked: bootstrap and lifecycle qualification are not implemented");
}
export function requireInstallation(value: unknown, binding: InstallBinding, policy: unknown): never {
  validateInstallBinding(binding);
  const receipt = record(value);
  requireValue(receipt.schemaVersion === 1 && receipt.kind === "install-observation", "legacy or missing installation observation");
  const observed = record(receipt.binding);
  requireValue(Object.entries(binding).every(([key, expected]) => observed[key] === expected), "installation source/run/attempt/job/platform/arch mismatch");
  requireValue(receipt.policyHash === installDigest(JSON.stringify(policy)), "installation policy hash mismatch");
  const outcome = record(receipt.outcome);
  requireValue(outcome.exitCode === 0 && outcome.signal === null && outcome.timedOut === false && outcome.stdioClosed === true && outcome.spawned === true, "failed or incomplete installation command");
  requireValue(receipt.synthetic === false && receipt.frozen === true && record(receipt.qualification).complete === true, "synthetic or incomplete installation observation");
  validateInstallPolicy(policy, binding);
  throw new Error("Full gate installation blocked: no qualified installation producer");
}
function observationBytes(path: string): Buffer {
  requireValue(Number.isInteger(constants.O_NONBLOCK) && constants.O_NONBLOCK !== 0 && Number.isInteger(constants.O_NOFOLLOW) && constants.O_NOFOLLOW !== 0, "nonblocking regular-file receipt opening unavailable");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const sizeLimit = 1_048_576;
    const stat = fstatSync(fd);
    requireValue(stat.isFile() && stat.size > 0 && stat.size <= sizeLimit, "nonregular, empty or oversized installation observation");
    const bytes = Buffer.alloc(sizeLimit + 1);
    let count = 0;
    while (count <= sizeLimit) {
      const read = readSync(fd, bytes, count, bytes.length - count, null);
      if (read === 0) break;
      count += read;
    }
    requireValue(count <= sizeLimit, "installation observation grew beyond bound");
    return bytes.subarray(0, count);
  } finally { closeSync(fd); }
}
export function readInstallation(root: string, env: NodeJS.ProcessEnv): never {
  const binding: InstallBinding = { sourceSha: env.GITHUB_SHA ?? "", runId: env.GITHUB_RUN_ID ?? "", attempt: env.GITHUB_RUN_ATTEMPT ?? "", job: env.GITHUB_JOB ?? "", platform: process.platform, arch: process.arch };
  validateInstallBinding(binding);
  requireValue(process.platform !== "win32", "Windows installation filesystem and containment are unqualified");
  const policy: unknown = JSON.parse(readFileSync(new URL("./install-policy.json", import.meta.url), "utf8"));
  requireValue(text(env.RUNNER_TEMP) && posix.isAbsolute(env.RUNNER_TEMP) && realpathSync.native(env.RUNNER_TEMP) === env.RUNNER_TEMP, "noncanonical installation temporary root");
  const receipt: unknown = JSON.parse(observationBytes(join(env.RUNNER_TEMP, "full-gate-install.json")).toString("utf8"));
  requireValue(text(root), "checkout root missing");
  return requireInstallation(receipt, binding, policy);
}
export async function productionInstall(_options: { root: string; tempRoot: string; binding: InstallBinding }): Promise<never> {
  throw new Error("Full gate installation blocked: pre-JavaScript bootstrap and lifecycle history unqualified; no installer spawned");
}
