import { EventEmitter } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { encodeLegacyCredentialResult, sha256 } from "./credential-namespace-migration.mjs";
import { attemptLegacyCredentialMigration, runLegacyCredentialRead } from "./credential-namespace-migration-runner.mjs";

const directories = [];
const workspace = () => {
  const directory = mkdtempSync(join(tmpdir(), "entropybot-legacy-runner-"));
  directories.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const setup = () => {
  const directory = workspace();
  const file = join(directory, "credentials.bin");
  writeFileSync(file, "old-store", { mode: 0o600 });
  return { directory, file, markerFile: join(directory, "credential-namespace-migration.json") };
};
const codec = {
  encrypt: async (value) => Buffer.from(value, "utf8"),
  decrypt: async (buffer) => buffer.toString("utf8"),
};

function fakeChild({ stdout = "", stderr = "", code = 0, close = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  if (close) {
    setImmediate(() => {
      if (stdout) child.stdout.emit("data", stdout);
      if (stderr) child.stderr.emit("data", stderr);
      child.emit("close", code);
    });
  }
  return child;
}

describe("runLegacyCredentialRead", () => {
  it("parses a successful child result and removes its temporary profile", async () => {
    const tempRoot = workspace();
    const credentials = { memoryEmbeddingKey: "synthetic" };
    const result = await runLegacyCredentialRead({
      credentialsFile: "/unused/credentials.bin",
      tempRoot,
      spawnImpl: () => fakeChild({ stdout: `log line\n${encodeLegacyCredentialResult(credentials)}` }),
    });
    expect(result).toEqual({ ok: true, credentials });
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it("reports the child's last stderr line instead of returning credentials on failure", async () => {
    const result = await runLegacyCredentialRead({
      credentialsFile: "/unused/credentials.bin",
      tempRoot: workspace(),
      spawnImpl: () => fakeChild({ stderr: "legacy credential read failed: denied\n", code: 1 }),
    });
    expect(result).toEqual({ ok: false, error: "legacy credential read failed: denied" });
  });

  it("keeps the temporary profile when a timed-out child never confirms exit", async () => {
    const tempRoot = workspace();
    const child = fakeChild({ close: false });
    const result = await runLegacyCredentialRead({
      credentialsFile: "/unused/credentials.bin",
      tempRoot,
      spawnImpl: () => child,
      timeoutMs: 5,
      termGraceMs: 5,
      abandonMs: 30,
    });
    expect(result).toEqual({ ok: false, error: "the legacy credential read timed out", retainedProfile: expect.any(String) });
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(readdirSync(tempRoot)).toHaveLength(1);
  });

  it("keeps a live child's profile after kill errors until close confirms exit", async () => {
    const tempRoot = workspace();
    const child = fakeChild({ close: false });
    child.pid = 12345;
    child.kill.mockImplementation(() => { child.emit("error", new Error("synthetic kill denied")); });
    const pending = runLegacyCredentialRead({
      credentialsFile: "/unused/credentials.bin", tempRoot, spawnImpl: () => child,
      timeoutMs: 5, termGraceMs: 5, abandonMs: 100,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readdirSync(tempRoot)).toHaveLength(1);
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    child.emit("close", null);
    await expect(pending).resolves.toEqual({ ok: false, error: "the legacy credential read timed out" });
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it("retains evidence on a post-spawn error with no close confirmation", async () => {
    const tempRoot = workspace();
    const child = fakeChild({ close: false });
    child.pid = 12345;
    const pending = runLegacyCredentialRead({
      credentialsFile: "/unused/credentials.bin", tempRoot, spawnImpl: () => child,
      timeoutMs: 100, termGraceMs: 5, abandonMs: 15,
    });
    child.emit("error", new Error("synthetic control failure"));
    const result = await pending;
    expect(result).toEqual({ ok: false, error: "the legacy credential read process could not be controlled", retainedProfile: expect.any(String) });
    expect(readdirSync(tempRoot)).toHaveLength(1);
    child.emit("close", null);
    expect(readdirSync(tempRoot)).toHaveLength(1);
  });

  it("returns a failed result and removes the profile when spawning throws", async () => {
    const tempRoot = workspace();
    const result = await runLegacyCredentialRead({
      credentialsFile: "/unused/credentials.bin",
      tempRoot,
      spawnImpl: () => { throw new Error("spawn denied"); },
    });
    expect(result).toEqual({ ok: false, error: "the legacy credential read could not start: spawn denied" });
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it("removes the profile when it cannot be made private", async () => {
    const tempRoot = workspace();
    const result = await runLegacyCredentialRead({
      credentialsFile: "/unused/credentials.bin",
      tempRoot,
      chmodProfile: () => { throw new Error("chmod denied"); },
      spawnImpl: () => fakeChild(),
    });
    expect(result).toEqual({ ok: false, error: "the legacy credential read could not start: chmod denied" });
    expect(readdirSync(tempRoot)).toEqual([]);
  });
});

describe("attemptLegacyCredentialMigration", () => {
  it("migrates once and records the backup and marker", async () => {
    const paths = setup();
    const log = vi.fn();
    const credentials = { memoryEmbeddingKey: "synthetic" };
    const result = await attemptLegacyCredentialMigration({
      ...paths,
      ...codec,
      log,
      readLegacy: async () => ({ ok: true, credentials }),
    });
    expect(result).toEqual(credentials);
    expect(JSON.parse(readFileSync(paths.file, "utf8"))).toEqual(credentials);
    expect(readFileSync(`${paths.file}.legacy-${sha256(Buffer.from("old-store")).slice(0, 12)}.bak`, "utf8")).toBe("old-store");
    expect(JSON.parse(readFileSync(paths.markerFile, "utf8"))).toMatchObject({ status: "migrated" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("migrated to the current keychain entry"));
  });

  it("records a failed attempt without touching the old store or retrying the same bytes", async () => {
    const paths = setup();
    const readLegacy = vi.fn().mockResolvedValue({ ok: false, error: "keychain denied" });
    await expect(attemptLegacyCredentialMigration({ ...paths, ...codec, readLegacy })).resolves.toBeNull();
    expect(readFileSync(paths.file, "utf8")).toBe("old-store");
    expect(JSON.parse(readFileSync(paths.markerFile, "utf8"))).toMatchObject({ status: "failed", error: "keychain denied" });
    await expect(attemptLegacyCredentialMigration({ ...paths, ...codec, readLegacy })).resolves.toBeNull();
    expect(readLegacy).toHaveBeenCalledTimes(1);
  });

  it("retries after the store bytes change", async () => {
    const paths = setup();
    const readLegacy = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "denied" })
      .mockResolvedValueOnce({ ok: true, credentials: { key: "value" } });
    await attemptLegacyCredentialMigration({ ...paths, ...codec, readLegacy });
    writeFileSync(paths.file, "replaced-store", { mode: 0o600 });
    await expect(attemptLegacyCredentialMigration({ ...paths, ...codec, readLegacy })).resolves.toEqual({ key: "value" });
    expect(readLegacy).toHaveBeenCalledTimes(2);
  });

  it("reports retained evidence when the reader cannot confirm child exit", async () => {
    const paths = setup();
    const log = vi.fn();
    await expect(attemptLegacyCredentialMigration({
      ...paths, ...codec, log,
      readLegacy: async () => ({ ok: false, error: "synthetic timeout", retainedProfile: "/synthetic/private-profile" }),
    })).resolves.toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("temporary profile retained: /synthetic/private-profile"));
    expect(readFileSync(paths.file, "utf8")).toBe("old-store");
  });

  it("normalizes a rejected reader instead of aborting startup", async () => {
    const paths = setup();
    await expect(attemptLegacyCredentialMigration({
      ...paths,
      ...codec,
      readLegacy: async () => { throw new Error("child setup failed"); },
    })).resolves.toBeNull();
    expect(readFileSync(paths.file, "utf8")).toBe("old-store");
    expect(JSON.parse(readFileSync(paths.markerFile, "utf8"))).toMatchObject({ status: "failed", error: "child setup failed" });
  });

  it("does nothing when the store file is absent", async () => {
    const paths = setup();
    rmSync(paths.file);
    await expect(attemptLegacyCredentialMigration({ ...paths, ...codec, readLegacy: vi.fn() })).resolves.toBeNull();
  });
});
