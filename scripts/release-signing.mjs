import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASES_URL, UPDATE_MODE } from "../electron/update-policy.mjs";

export const runCommand = (command, args) => execFileSync(command, args, {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: command === "pnpm" ? 1_800_000 : 180_000, maxBuffer: 16 * 1024 * 1024,
});
export const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

export function signingConfig(env) {
  if ("CSC_LINK" in env || "CSC_INSTALLER_LINK" in env) throw new Error("Certificate import variables are forbidden in this prepared flow");
  const identity = env.ENTROPYBOT_SIGNING_IDENTITY;
  const team = env.ENTROPYBOT_SIGNING_TEAM;
  const profile = env.ENTROPYBOT_NOTARY_PROFILE;
  if (!identity || !team || !profile) {
    throw new Error("Official release requires ENTROPYBOT_SIGNING_IDENTITY, ENTROPYBOT_SIGNING_TEAM and ENTROPYBOT_NOTARY_PROFILE; no commands were run");
  }
  if (!/^[A-Z0-9]{10}$/.test(team) || !identity.startsWith("Developer ID Application: ") || !identity.endsWith(`(${team})`)) {
    throw new Error("Expected a Developer ID Application identity with the configured Team ID");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(profile)) throw new Error("Use a simple notary keychain profile name");
  // The prepared path only consumes an existing identity/profile. It never imports credentials.
  return { identity, team, profile };
}

export function preflight(env, run = runCommand) {
  const config = signingConfig(env);
  const identities = run("security", ["find-identity", "-v", "-p", "codesigning"]);
  if (!identities.split("\n").some(line => line.includes(`"${config.identity}"`))) {
    throw new Error("Configured Developer ID identity is not available");
  }
  return config;
}

export function sourceRecord(run = runCommand) {
  if (UPDATE_MODE !== "manual" || RELEASES_URL !== "https://github.com/Ashersun1207/entropybot/releases") {
    throw new Error("Official release source or update policy mismatch");
  }
  if (run("git", ["status", "--porcelain", "--untracked-files=all"]).trim()) {
    throw new Error("Commit the version and all source changes before an official build");
  }
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const committed = JSON.parse(run("git", ["show", "HEAD:package.json"]));
  if (pkg.name !== "entropybot" || pkg.version !== committed.version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
    throw new Error("Committed package identity/version mismatch");
  }
  return {
    sourceCommit: run("git", ["rev-parse", "HEAD"]).trim(),
    sourceTree: run("git", ["rev-parse", "HEAD^{tree}"]).trim(),
    version: pkg.version, lockSha256: sha256("pnpm-lock.yaml"),
    createdAt: new Date().toISOString(),
  };
}

export function verifySignature(text, config, expectedIdentifier, requireRuntime = true) {
  const fields = Object.fromEntries(text.split("\n").filter(line => line.includes("=")).map(line => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at + 1)];
  }));
  if (!text.split("\n").includes(`Authority=${config.identity}`) || fields.TeamIdentifier !== config.team) {
    throw new Error("Final signature identity/team mismatch (ad-hoc is forbidden)");
  }
  if (expectedIdentifier && fields.Identifier !== expectedIdentifier) throw new Error("Final bundle identifier mismatch");
  if ((requireRuntime && !/flags=.*\bruntime\b/.test(text)) || !fields.Timestamp || fields.Timestamp === "none" || !/^[a-f0-9]{40,64}$/i.test(fields.CDHash ?? "")) {
    throw new Error("Final signature lacks hardened runtime, secure timestamp or CDHash");
  }
  return { identifier: fields.Identifier, team: fields.TeamIdentifier, identity: config.identity, cdhash: fields.CDHash, timestamp: fields.Timestamp };
}

function inspectSignature(target, config, identifier, run) {
  run("codesign", ["--verify", "--deep", "--strict", target]);
  // codesign writes metadata to stderr, so the default runner merges only for this read.
  const text = run("codesign", ["-d", "--verbose=4", target]);
  return verifySignature(text, config, identifier);
}

function inspectDmgSignature(target, config, run) {
  run("codesign", ["--verify", "--strict", target]);
  // A DMG is a signed data container, not a Mach-O executable with hardened-runtime flags.
  return verifySignature(run("codesign", ["-d", "--verbose=4", target]), config, undefined, false);
}

// execFileSync returns stdout only. Keep the stderr signature channel explicit.
export function signingCommand(command, args) {
  if (command === "codesign" && args[0] === "-d") {
    const result = spawnMetadata(command, args);
    return result;
  }
  return runCommand(command, args);
}

function spawnMetadata(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 180_000 });
  if (result.error || result.status !== 0) throw new Error("Cannot inspect final code signature");
  return result.stderr;
}

export function localSigningEvidence(app, run = signingCommand) {
  try {
    run("codesign", ["--verify", "--deep", "--strict", app]);
    const metadata = run("codesign", ["-d", "--verbose=4", app]);
    return {
      status: metadata.split("\n").includes("Signature=adhoc") ? "observed-ad-hoc-bundle" : "observed-signed-bundle",
      scope: "local unpacked bundle only; archive equivalence and notarization unverified",
    };
  } catch {
    return { status: "unverified", scope: "signature not inspected successfully" };
  }
}

export function verifyBundle(app, version, config, run = signingCommand) {
  const info = path.join(app, "Contents/Info.plist");
  const bundle = run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", info]).trim();
  const actualVersion = run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", info]).trim();
  if (bundle !== "ai.entropybot.desktop" || actualVersion !== version) throw new Error("Final bundle ID/version mismatch");
  const signature = inspectSignature(app, config, bundle, run);
  // Discover every Mach-O instead of maintaining an incomplete helper allowlist.
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        const descriptor = openSync(file, "r");
        const header = Buffer.alloc(4);
        let length;
        try { length = readSync(descriptor, header, 0, 4, 0); }
        finally { closeSync(descriptor); }
        const magic = length === 4 ? header.toString("hex") : "";
        if (["feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"].includes(magic)) {
          inspectSignature(file, config, undefined, run);
        }
      }
    }
  };
  walk(path.join(app, "Contents"));
  return signature;
}

export function officialBuild(env = process.env, run = signingCommand) {
  const config = preflight(env, run);
  const source = sourceRecord(run);
  // Never consume artifacts from an earlier build or delete them automatically.
  if (existsSync("release") && readdirSync("release").length) throw new Error("Use an empty release directory in a dedicated checkout");
  mkdirSync("release", { recursive: true });
  const record = { schema: 1, status: "building", ...source,
    runtime: { node: process.version, platform: process.platform, arch: process.arch }, expectedSigning: config };
  const save = () => writeFileSync("release/entropybot-build-record.json", JSON.stringify(record, null, 2) + "\n");
  save();
  writeFileSync("release/official-builder.json", JSON.stringify({
    extends: path.resolve("electron-builder.yml"),
    mac: { identity: config.identity, forceCodeSigning: true, hardenedRuntime: true, notarize: false },
    dmg: { sign: true },
  }, null, 2) + "\n");
  for (const script of ["package:prepare", "build:speech", "build:cua"]) run("pnpm", [script]);
  run("pnpm", ["exec", "electron-builder", "--config", "release/official-builder.json", "--mac", "--arm64", "--publish", "never"]);
  record.signature = verifyBundle("release/mac-arm64/Entropybot.app", source.version, config, run);
  record.dmgSignature = inspectDmgSignature(`release/Entropybot-${source.version}-arm64.dmg`, config, run);
  const after = sourceRecord(run);
  if (after.sourceCommit !== source.sourceCommit || after.sourceTree !== source.sourceTree || after.lockSha256 !== source.lockSha256) {
    throw new Error("Source changed during build");
  }
  record.status = "signed-awaiting-manual-notarization";
  record.builtArtifacts = ["dmg", "zip"].map(ext => {
    const name = `Entropybot-${source.version}-arm64.${ext}`;
    return { name, sha256: sha256(path.join("release", name)) };
  });
  save();
}

export function finalizeOfficial(env = process.env, run = signingCommand) {
  const config = preflight(env, run);
  const record = JSON.parse(readFileSync("release/entropybot-build-record.json", "utf8"));
  const source = sourceRecord(run);
  if (record.schema !== 1 || record.status !== "signed-awaiting-manual-notarization" ||
      source.sourceCommit !== record.sourceCommit || source.sourceTree !== record.sourceTree ||
      source.version !== record.version || source.lockSha256 !== record.lockSha256 ||
      JSON.stringify(config) !== JSON.stringify(record.expectedSigning)) throw new Error("Build record/source/signing mismatch");
  const app = "release/mac-arm64/Entropybot.app";
  const signature = verifyBundle(app, record.version, config, run);
  if (signature.cdhash !== record.signature.cdhash) throw new Error("App signature changed after build");
  const dmg = `release/Entropybot-${record.version}-arm64.dmg`;
  const dmgSignature = inspectDmgSignature(dmg, config, run);
  if (dmgSignature.cdhash !== record.dmgSignature?.cdhash) throw new Error("DMG signature changed after build");
  const mount = mkdtempSync("release/dmg-check-");
  let attached = false;
  try {
    run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", path.resolve(mount), dmg]);
    attached = true;
    const embedded = verifyBundle(path.join(mount, "Entropybot.app"), record.version, config, run);
    if (embedded.cdhash !== signature.cdhash) throw new Error("DMG contains a different build");
  } finally {
    // Detach failure must stop finalization and leave the mount point for diagnosis.
    if (attached) run("hdiutil", ["detach", path.resolve(mount)]);
    rmdirSync(mount);
  }
  // Staple changes bytes; Accepted server status alone is not the final acceptance gate.
  for (const target of [app, dmg]) run("xcrun", ["stapler", "validate", target]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=4", app]);
  run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=4", dmg]);
  const zip = `release/Entropybot-${record.version}-arm64.zip`;
  // ditto updates existing archives: require the operator to remove the pre-staple ZIP first.
  if (existsSync(zip)) throw new Error("Remove the recorded pre-staple ZIP before finalizing; the final ZIP must be newly created");
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
  const artifacts = [dmg, zip].map(file => ({ name: path.basename(file), sha256: sha256(file) }));
  const generated = sourceRecord(run);
  if (generated.sourceCommit !== record.sourceCommit || generated.sourceTree !== record.sourceTree || generated.lockSha256 !== record.lockSha256) {
    throw new Error("Source changed during final validation");
  }
  const manifest = {
    product: "entropybot", version: record.version, tag: `entropybot-v${record.version}`,
    commit: record.sourceCommit, sourceCommit: record.sourceCommit, sourceStatus: "recorded-clean-build",
    manifestGeneratedHead: generated.sourceCommit, buildRecordSha256: sha256("release/entropybot-build-record.json"),
    updateMode: UPDATE_MODE, releasesUrl: RELEASES_URL,
    signing: { status: "developer-id-stapled-verified", ...signature }, dmgSigning: dmgSignature, artifacts,
  };
  writeFileSync("release/entropybot-build.json", JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync("release/SHA256SUMS", artifacts.map(file => `${file.sha256}  ${file.name}\n`).join(""));
  // No tag, upload, certificate import or notary submission occurs here.
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "preflight") preflight(process.env);
    else if (process.argv[2] === "build") officialBuild();
    else if (process.argv[2] === "finalize") finalizeOfficial();
    else throw new Error("Usage: node scripts/release-signing.mjs preflight|build|finalize");
  } catch {
    // Command errors may include tool stderr and environment-related diagnostics. Keep CLI output bounded.
    console.error("Official release stopped. Check configuration and local validation evidence; no publication was attempted.");
    process.exitCode = 1;
  }
}
