import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digest, insist } from "./core.mjs";

export const REQUIRED_ASSETS = ["OMB_AGENT_BROWSER_PATH", "OMB_CDP_CHROME", "OMB_UI_DIST", "OMB_UI_PLAYWRIGHT_CORE", "NODE_EXTRA_CA_CERTS", "OMB_CLINE_NATIVE_PATH", "OMB_OPENCODE_E2E_CLI", "OMB_OPENCODE2_E2E_CLI"];
export function assetDigest(path) {
  const stat = lstatSync(path);
  insist(!stat.isSymbolicLink(), "asset symlink is not approved");
  if (stat.isFile()) return digest(readFileSync(path));
  insist(stat.isDirectory(), "asset must be regular file or directory");
  return digest(readdirSync(path).sort().map(name => `${name}\0${assetDigest(join(path, name))}`).join("\n"));
}
export function assetIssues(env, approvals) {
  const issues = [];
  for (const key of REQUIRED_ASSETS) {
    try {
      if (!env[key] || !existsSync(env[key])) issues.push(`missing pre-provisioned asset ${key}; downloads forbidden`);
      else if (!/^[a-f0-9]{64}$/.test(approvals[key] ?? "")) issues.push(`missing approved SHA-256 for ${key}`);
      else if (assetDigest(env[key]) !== approvals[key]) issues.push(`asset digest mismatch ${key}`);
    } catch (error) { issues.push(`asset ${key}: ${error.message}`); }
  }
  return issues;
}
export function preflight(env, { approvals = {}, tempRoot, platform = process.platform } = {}) {
  const issues = assetIssues(env, approvals);
  if (platform === "win32") issues.push("Windows owned-process containment is unavailable");
  try { execFileSync("python3", ["-I", "-c", "from PIL import Image"], { env, timeout: 5000, stdio: "pipe" }); }
  catch { issues.push("missing isolated python3 -I Pillow capability"); }
  let directory;
  try {
    directory = mkdtempSync(join(tempRoot, "fg-case-"));
    writeFileSync(join(directory, "case"), "synthetic");
    if (existsSync(join(directory, "CASE"))) issues.push("missing case-sensitive temporary filesystem");
    if (Buffer.byteLength(directory) > 90) issues.push("temporary path too long for socket fixtures");
  } catch { issues.push("missing writable short temporary filesystem"); }
  finally { if (directory) rmSync(directory, { recursive: true, force: true }); }
  issues.push("disposable loopback Postfix/Dovecot fixture and CA qualification unavailable (11993/11143/11465/11587; synthetic omb-test.example accounts)");
  return { ready: issues.length === 0, issues };
}
