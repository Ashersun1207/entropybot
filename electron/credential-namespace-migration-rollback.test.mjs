import { spawn } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attemptLegacyCredentialMigration, runLegacyCredentialRead } from "./credential-namespace-migration-runner.mjs";
import { sha256 } from "./credential-namespace-migration.mjs";
import { createSecureCredentialIO } from "./secure-credential-io.mjs";
import { readSecureCredentials } from "./secure-credentials.mjs";

const owned = [];
const fixture = () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "credential-rollback-fixture-"));
  owned.push(directory);
  const file = path.join(directory, "credentials.bin");
  const credentials = { memoryEmbeddingKey: "synthetic-rollback-canary", xaiApiKey: "synthetic-other-key" };
  const original = Buffer.from(`old:${JSON.stringify(credentials)}`);
  fs.writeFileSync(file, original, { mode: 0o600 });
  const storage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => Buffer.from(`new:${value}`),
    decryptStringAsync: async (bytes) => {
      if (!bytes.toString().startsWith("new:")) throw new Error("synthetic wrong namespace");
      return { result: bytes.toString().slice(4) };
    },
  };
  return { directory, file, credentials, original, storage };
};
afterEach(() => {
  for (const directory of owned.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});
const open = (f, readLegacy, storage = f.storage) => createSecureCredentialIO({
  file: f.file, safeStorage: storage, isPackaged: true, platform: "darwin",
  read: (options) => readSecureCredentials({ ...options, delays: [] }),
  migrate: (options) => attemptLegacyCredentialMigration({ ...options, readLegacy }),
});

describe("isolated restart and rollback transactions", () => {
  it.each(["denied", "locked"])("preserves store and synthetic plaintext config across %s and restart", async (reason) => {
    const f = fixture();
    const config = path.join(f.directory, "config.json");
    const plaintext = '{"memoryEmbeddingKey":"synthetic-plaintext-preserved"}';
    fs.writeFileSync(config, plaintext);
    const readLegacy = vi.fn().mockResolvedValue({ ok: false, error: `synthetic ${reason}` });
    const storage = reason === "locked" ? { ...f.storage, isAsyncEncryptionAvailable: async () => false } : f.storage;
    for (let restart = 0; restart < 2; restart++) {
      const io = open(f, readLegacy, storage);
      expect(await io.load()).toEqual({});
      expect(io.unavailable()).toBe(true);
      await expect(io.save({ key: "synthetic-must-not-overwrite" })).rejects.toThrow(/could not be read/);
      expect(fs.readFileSync(f.file)).toEqual(f.original);
      expect(fs.readFileSync(config, "utf8")).toBe(plaintext);
    }
    expect(readLegacy).toHaveBeenCalledTimes(1);
    const marker = fs.readFileSync(path.join(f.directory, "credential-namespace-migration.json"), "utf8");
    expect(marker).toContain(`synthetic ${reason}`);
    expect(marker).not.toContain(f.credentials.memoryEmbeddingKey);
  });

  it("reloads migrated credentials after restart and migrates restored backup a second time", async () => {
    const f = fixture();
    const readLegacy = vi.fn().mockResolvedValue({ ok: true, credentials: f.credentials });
    expect(await open(f, readLegacy).load()).toEqual(f.credentials);
    const migrated = fs.readFileSync(f.file);
    expect(migrated).not.toEqual(f.original);
    expect(await open(f, readLegacy).load()).toEqual(f.credentials);
    expect(readLegacy).toHaveBeenCalledTimes(1);
    const backup = `${f.file}.legacy-${sha256(f.original).slice(0, 12)}.bak`;
    expect(fs.readFileSync(backup)).toEqual(f.original);
    fs.copyFileSync(backup, f.file);
    expect(await open(f, readLegacy).load()).toEqual(f.credentials);
    expect(readLegacy).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(backup)).toEqual(f.original);
    expect(await open(f, readLegacy).load()).toEqual(f.credentials);
    expect(readLegacy).toHaveBeenCalledTimes(2);
  });
});

it("terminates and reaps a real synthetic Node child before removing its profile", async () => {
  const f = fixture();
  const script = path.join(f.directory, "child.cjs");
  const ready = path.join(f.directory, "ready");
  fs.writeFileSync(script, `const fs = require('node:fs');
process.on('SIGTERM', () => fs.writeFileSync(${JSON.stringify(path.join(f.directory, "term"))}, 'received'));
fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid));
setInterval(() => {}, 50);
`);
  let child;
  let childProfile;
  try {
    const result = await runLegacyCredentialRead({
      credentialsFile: f.file, tempRoot: f.directory, timeoutMs: 500, termGraceMs: 100, abandonMs: 2000,
      spawnImpl: (execPath, _args, options) => {
        childProfile = options.env.ENTROPYBOT_LEGACY_PROFILE;
        child = spawn(execPath, [script], { ...options, env: { HOME: f.directory, PATH: process.env.PATH } });
        return child;
      },
    });
    expect(result).toEqual({ ok: false, error: "the legacy credential read timed out" });
    expect(Number(fs.readFileSync(ready, "utf8"))).toBe(child.pid);
    expect(fs.readFileSync(path.join(f.directory, "term"), "utf8")).toBe("received");
    expect(() => process.kill(child.pid, 0)).toThrow();
    expect(fs.existsSync(childProfile)).toBe(false);
    expect(fs.readFileSync(f.file)).toEqual(f.original);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("close", resolve));
    }
  }
});
