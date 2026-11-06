import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { finalizeOfficial, localSigningEvidence, officialBuild, preflight, signingConfig, sourceRecord, verifySignature } from "./release-signing.mjs";

const env = {
  ENTROPYBOT_SIGNING_IDENTITY: "Developer ID Application: Synthetic Fixture (ABCDEFGHIJ)",
  ENTROPYBOT_SIGNING_TEAM: "ABCDEFGHIJ",
  ENTROPYBOT_NOTARY_PROFILE: "synthetic-notary-profile",
};
const config = signingConfig(env);
const metadata = (overrides = {}) => Object.entries({
  Identifier: "ai.entropybot.desktop", Authority: config.identity, TeamIdentifier: config.team,
  CodeDirectory: "v=20500 size=100 flags=0x10000(runtime)", Timestamp: "Nov 7, 2026 at 00:00:00", CDHash: "a".repeat(40), ...overrides,
}).map(([key, value]) => `${key}=${value}`).join("\n");
const script = fileURLToPath(new URL("./entropybot-release.mjs", import.meta.url));

function fixture(fn) {
  const previous = process.cwd();
  const directory = mkdtempSync(path.join(tmpdir(), "release-signing-"));
  process.chdir(directory);
  try {
    writeFileSync("package.json", JSON.stringify({ name: "entropybot", version: "0.2.5" }));
    writeFileSync("pnpm-lock.yaml", "synthetic lock\n");
    writeFileSync("electron-builder.yml", "appId: ai.entropybot.desktop\nowner: Ashersun1207\nrepo: entropybot\n");
    writeFileSync(".gitignore", "release/\n");
    for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]]) {
      execFileSync("git", args, { stdio: "pipe" });
    }
    return fn(directory);
  } finally {
    process.chdir(previous);
    rmSync(directory, { recursive: true, force: true });
  }
}

function fakeCommands(fail = () => false) {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    if (fail(command, args)) throw new Error("synthetic command failure");
    if (command === "git") return execFileSync(command, args, { encoding: "utf8" });
    if (command === "security") return `1) 000000 "${config.identity}"\n1 valid identities found`;
    if (command === "pnpm" && args[0] === "exec") {
      mkdirSync("release/mac-arm64/Entropybot.app/Contents/MacOS", { recursive: true });
      writeFileSync("release/mac-arm64/Entropybot.app/Contents/MacOS/fixture", Buffer.from("cffaedfe", "hex"));
      writeFileSync("release/Entropybot-0.2.5-arm64.dmg", "synthetic dmg");
      writeFileSync("release/Entropybot-0.2.5-arm64.zip", "synthetic initial zip");
    }
    if (command === "/usr/libexec/PlistBuddy") return args[1].includes("Identifier") ? "ai.entropybot.desktop\n" : "0.2.5\n";
    if (command === "codesign" && args[0] === "-d") {
      return args.at(-1).endsWith(".dmg")
        ? metadata({ Identifier: "fixture.dmg", CodeDirectory: "flags=0x0(none)", CDHash: "c".repeat(40) })
        : metadata();
    }
    if (command === "hdiutil" && args[0] === "attach") cpSync("release/mac-arm64/Entropybot.app", path.join(args[4], "Entropybot.app"), { recursive: true });
    if (command === "hdiutil" && args[0] === "detach") rmSync(path.join(args[1], "Entropybot.app"), { recursive: true });
    if (command === "ditto") writeFileSync(args.at(-1), "synthetic final zip with stapled app");
    return "";
  };
  return { run, calls };
}

test("missing configuration fails before any command; auto-import variables are rejected", () => {
  for (const key of Object.keys(env)) {
    const missing = { ...env };
    delete missing[key];
    let calls = 0;
    for (const entry of [preflight, officialBuild, finalizeOfficial]) {
      assert.throws(() => entry(missing, () => { calls++; }), /requires/);
    }
    assert.equal(calls, 0);
  }
  assert.throws(() => signingConfig({ ...env, CSC_LINK: "synthetic-import-forbidden" }), /import/);
});

test("wrong identity/team and unavailable identity stop without build or network", () => {
  assert.throws(() => signingConfig({ ...env, ENTROPYBOT_SIGNING_IDENTITY: "-" }), /Developer ID/);
  assert.throws(() => signingConfig({ ...env, ENTROPYBOT_SIGNING_TEAM: "ZZZZZZZZZZ" }), /Developer ID/);
  const calls = [];
  assert.throws(() => preflight(env, (...args) => { calls.push(args); return "0 valid identities"; }), /not available/);
  assert.deepEqual(calls.map(call => call[0]), ["security"]);
});

test("final signature requires actual identity, team, bundle, runtime and timestamp", () => {
  assert.equal(verifySignature(metadata(), config, "ai.entropybot.desktop").cdhash, "a".repeat(40));
  for (const replacement of [
    { Authority: "ad-hoc" }, { TeamIdentifier: "ZZZZZZZZZZ" }, { Identifier: "wrong.bundle" },
    { CodeDirectory: "flags=0x0(none)" }, { Timestamp: "" }, { Timestamp: "none" }, { CDHash: "" },
  ]) assert.throws(() => verifySignature(metadata(replacement), config, "ai.entropybot.desktop"));
});

test("source record refuses dirty or untracked source before building", () => fixture(() => {
  const before = sourceRecord();
  assert.match(before.sourceCommit, /^[a-f0-9]{40}$/);
  writeFileSync("uncommitted-version.txt", "pending");
  const fake = fakeCommands();
  assert.throws(() => officialBuild(env, fake.run), /Commit the version/);
  assert.equal(fake.calls.some(([command]) => command === "pnpm"), false);
}));

test("clean build records source then verifies app and every Mach-O; finalize gates ticket and final hashes", () => fixture(() => {
  const fake = fakeCommands();
  officialBuild(env, fake.run);
  const record = JSON.parse(readFileSync("release/entropybot-build-record.json"));
  assert.equal(record.status, "signed-awaiting-manual-notarization");
  assert.equal(record.sourceCommit, sourceRecord().sourceCommit);
  const builder = JSON.parse(readFileSync("release/official-builder.json"));
  assert.equal(builder.mac.identity, config.identity);
  assert.equal(builder.mac.forceCodeSigning, true);
  assert.equal(builder.mac.notarize, false);
  assert.equal(builder.dmg.sign, true);
  assert.ok(fake.calls.some(([command, args]) => command === "codesign" && args.at(-1).endsWith("MacOS/fixture")));
  assert.throws(() => finalizeOfficial(env, fake.run), /pre-staple ZIP/);
  unlinkSync("release/Entropybot-0.2.5-arm64.zip");
  finalizeOfficial(env, fake.run);
  const manifest = JSON.parse(readFileSync("release/entropybot-build.json"));
  assert.equal(manifest.sourceCommit, record.sourceCommit);
  assert.equal(manifest.sourceStatus, "recorded-clean-build");
  assert.equal(manifest.signing.status, "developer-id-stapled-verified");
  assert.notEqual(manifest.artifacts[1].sha256, record.builtArtifacts[1].sha256);
  assert.equal(fake.calls.filter(([command]) => command === "ditto").length, 1);
  assert.equal(fake.calls.some(([command]) => ["gh", "curl"].includes(command)), false);
}));

test("notary ticket validation failure prevents final ZIP and manifest", () => fixture(() => {
  const fake = fakeCommands();
  officialBuild(env, fake.run);
  unlinkSync("release/Entropybot-0.2.5-arm64.zip");
  const rejected = fakeCommands(command => command === "xcrun");
  assert.throws(() => finalizeOfficial(env, rejected.run), /synthetic command failure/);
  assert.equal(rejected.calls.some(([command]) => command === "ditto"), false);
  assert.throws(() => readFileSync("release/entropybot-build.json"), /ENOENT/);
}));

test("finalize rejects wrong team, different DMG payload and Gatekeeper failure before writing a manifest", () => {
  for (const failure of ["team", "dmg", "gatekeeper"]) fixture(() => {
    const fake = fakeCommands();
    officialBuild(env, fake.run);
    unlinkSync("release/Entropybot-0.2.5-arm64.zip");
    const run = (command, args) => {
      if (command === "codesign" && args[0] === "-d") {
        if (failure === "team") return metadata({ TeamIdentifier: "ZZZZZZZZZZ" });
        if (failure === "dmg" && args.at(-1).includes("dmg-check-")) return metadata({ CDHash: "b".repeat(40) });
      }
      if (failure === "gatekeeper" && command === "spctl") throw new Error("Gatekeeper refused synthetic bundle");
      return fake.run(command, args);
    };
    assert.throws(() => finalizeOfficial(env, run), /mismatch|different build|Gatekeeper refused/);
    assert.equal(fake.calls.some(([command]) => command === "ditto"), false);
    assert.throws(() => readFileSync("release/entropybot-build.json"), /ENOENT/);
  });
});

test("DMG signature, container tickets, container Gatekeeper and nested code failures block final archives", () => {
  for (const failure of ["dmg-team", "dmg-adhoc", "dmg-changed", "dmg-staple", "dmg-gatekeeper", "nested-code"]) fixture(() => {
    const fake = fakeCommands();
    officialBuild(env, fake.run);
    unlinkSync("release/Entropybot-0.2.5-arm64.zip");
    const run = (command, args) => {
      const target = args.at(-1);
      if (command === "codesign" && args[0] === "-d" && target.endsWith(".dmg")) {
        if (failure === "dmg-team") return metadata({ TeamIdentifier: "ZZZZZZZZZZ" });
        if (failure === "dmg-adhoc") return "Signature=adhoc\n";
        if (failure === "dmg-changed") return metadata({ CDHash: "d".repeat(40) });
      }
      if (failure === "nested-code" && command === "codesign" && target.endsWith("MacOS/fixture")) throw new Error("synthetic nested code rejected");
      if (failure === "dmg-staple" && command === "xcrun" && target.endsWith(".dmg")) throw new Error("synthetic DMG ticket rejected");
      if (failure === "dmg-gatekeeper" && command === "spctl" && args.includes("open")) throw new Error("synthetic DMG Gatekeeper rejected");
      return fake.run(command, args);
    };
    assert.throws(() => finalizeOfficial(env, run), /mismatch|changed|synthetic/);
    assert.equal(fake.calls.some(([command]) => command === "ditto"), false);
    assert.throws(() => readFileSync("release/entropybot-build.json"), /ENOENT/);
  });
});

test("official record blocks legacy manifest from replacing formal evidence", () => fixture(() => {
  mkdirSync("release");
  writeFileSync("release/entropybot-build-record.json", "{}");
  assert.throws(() => execFileSync(process.execPath, [script, "manifest"], { stdio: "pipe" }));
  assert.throws(() => readFileSync("release/entropybot-build.json"), /ENOENT/);
}));

test("changed source cannot inherit a successful build record", () => fixture(() => {
  const fake = fakeCommands();
  officialBuild(env, fake.run);
  writeFileSync("pnpm-lock.yaml", "changed");
  assert.throws(() => finalizeOfficial(env, fake.run), /Commit the version/);
}));

test("local signing status follows command evidence and remains scoped to unpacked bundle", () => {
  assert.equal(localSigningEvidence("fixture", () => { throw new Error("missing"); }).status, "unverified");
  assert.equal(localSigningEvidence("fixture", () => "Signature=adhoc\n").status, "observed-ad-hoc-bundle");
  assert.equal(localSigningEvidence("fixture", () => "Authority=synthetic\n").status, "observed-signed-bundle");
});

test("legacy check/manifest works with old archives and never claims current HEAD built them", () => fixture(() => {
  mkdirSync("release");
  for (const ext of ["dmg", "zip"]) writeFileSync(`release/Entropybot-0.2.5-arm64.${ext}`, "old synthetic archive");
  for (const action of ["check", "manifest"]) execFileSync(process.execPath, [script, action], { stdio: "pipe" });
  const manifest = JSON.parse(readFileSync("release/entropybot-build.json"));
  assert.equal(manifest.commit, null);
  assert.equal(manifest.sourceCommit, null);
  assert.equal(manifest.sourceStatus, "unverified-source");
  assert.equal(manifest.manifestGeneratedHead, sourceRecord().sourceCommit);
  assert.equal(manifest.signing.status, "unverified");
  assert.equal(manifest.artifacts.length, 2);
}));
