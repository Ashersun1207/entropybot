import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  LEGACY_MARKER_VERSION,
  LEGACY_RESULT_PREFIX,
  encodeLegacyCredentialResult,
  migrateLegacyCredentialStore,
  parseLegacyCredentialResult,
  recordLegacyMigrationFailure,
  sha256,
  shouldAttemptLegacyMigration,
} from "./credential-namespace-migration.mjs";

const directories = [];
const workspace = () => {
  const directory = mkdtempSync(join(tmpdir(), "entropybot-credential-migration-"));
  directories.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const setup = (bytes = "old-encrypted-store") => {
  const directory = workspace();
  const file = join(directory, "credentials.bin");
  const backupFile = join(directory, "credentials.bin.legacy.bak");
  const markerFile = join(directory, "credential-namespace-migration.json");
  writeFileSync(file, bytes, { mode: 0o600 });
  return { file, backupFile, markerFile, fileSha256: sha256(Buffer.from(bytes)) };
};

const plaintextCodec = {
  encrypt: async (value) => Buffer.from(value, "utf8"),
  decrypt: async (buffer) => buffer.toString("utf8"),
};

describe("legacy credential result framing", () => {
  it("round-trips a credential document through the child stdout protocol", () => {
    const credentials = { memoryEmbeddingKey: "synthetic-key", xaiApiKey: "" };
    const line = encodeLegacyCredentialResult(credentials);
    expect(parseLegacyCredentialResult(`Chromium noise\n${line}more noise\n`)).toEqual(credentials);
  });

  it("uses the last marked line after unrelated diagnostics", () => {
    const first = encodeLegacyCredentialResult({ stale: "value" });
    const second = encodeLegacyCredentialResult({ fresh: "value" });
    expect(parseLegacyCredentialResult(first + second)).toEqual({ fresh: "value" });
  });

  it("rejects missing, oversized, malformed and unsafe payloads", () => {
    expect(() => parseLegacyCredentialResult("plain logs only")).toThrow(/no result/);
    expect(() => parseLegacyCredentialResult(`${LEGACY_RESULT_PREFIX}${"A".repeat(2_000_000)}`)).toThrow(/oversized/);
    expect(() => parseLegacyCredentialResult(`${LEGACY_RESULT_PREFIX}!!!`)).toThrow(/invalid base64/);
    const array = Buffer.from("[1,2,3]").toString("base64");
    expect(() => parseLegacyCredentialResult(`${LEGACY_RESULT_PREFIX}${array}`)).toThrow(/unsafe/);
    const proto = Buffer.from('{"__proto__":{"polluted":true}}').toString("base64");
    expect(() => parseLegacyCredentialResult(`${LEGACY_RESULT_PREFIX}${proto}`)).toThrow(/unsafe/);
  });

  it("refuses to encode an unsafe document", () => {
    const value = {};
    Object.defineProperty(value, "__proto__", { value: { polluted: true }, enumerable: true });
    expect(() => encodeLegacyCredentialResult(value)).toThrow(/Unsafe/);
  });
});

describe("shouldAttemptLegacyMigration", () => {
  const fileSha256 = "abc";
  it("attempts when no marker exists or the marker is from another format", () => {
    expect(shouldAttemptLegacyMigration({ marker: null, fileSha256 })).toBe(true);
    expect(shouldAttemptLegacyMigration({ marker: { version: 0, status: "migrated" }, fileSha256 })).toBe(true);
  });

  it("does not repeat a completed migration for the store it produced, or a failed attempt for the same bytes", () => {
    const migrated = { version: LEGACY_MARKER_VERSION, status: "migrated", fileSha256: "old", resultSha256: fileSha256 };
    expect(shouldAttemptLegacyMigration({ marker: migrated, fileSha256 })).toBe(false);
    expect(shouldAttemptLegacyMigration({ marker: { version: LEGACY_MARKER_VERSION, status: "failed", fileSha256 }, fileSha256 })).toBe(false);
  });

  it("recovers a restored old store after a completed migration, or a marker from an older format", () => {
    expect(shouldAttemptLegacyMigration({ marker: { version: LEGACY_MARKER_VERSION, status: "migrated", fileSha256, resultSha256: "new" }, fileSha256 })).toBe(true);
    expect(shouldAttemptLegacyMigration({ marker: { version: LEGACY_MARKER_VERSION, status: "migrated", fileSha256 }, fileSha256 })).toBe(true);
  });

  it("retries after the old store changes", () => {
    expect(shouldAttemptLegacyMigration({ marker: { version: LEGACY_MARKER_VERSION, status: "failed", fileSha256: "older" }, fileSha256 })).toBe(true);
  });
});

describe("migrateLegacyCredentialStore", () => {
  it("backs up the old bytes, writes the new store and verifies it before replacing", async () => {
    const paths = setup();
    const credentials = { memoryEmbeddingKey: "synthetic-memory-key", xaiApiKey: "synthetic-xai" };
    const result = await migrateLegacyCredentialStore({ ...paths, credentials, ...plaintextCodec });
    expect(result).toEqual(credentials);
    expect(JSON.parse(readFileSync(paths.file, "utf8"))).toEqual(credentials);
    expect(readFileSync(paths.backupFile, "utf8")).toBe("old-encrypted-store");
    expect(JSON.parse(readFileSync(paths.markerFile, "utf8"))).toMatchObject({ status: "migrated", fileSha256: paths.fileSha256 });
    expect(statSync(paths.backupFile).mode & 0o777).toBe(0o600);
  });

  it("restores the old bytes when the new store does not read back as written", async () => {
    const paths = setup();
    await expect(migrateLegacyCredentialStore({
      ...paths,
      credentials: { memoryEmbeddingKey: "synthetic-key" },
      encrypt: async (value) => Buffer.from(value),
      decrypt: async () => JSON.stringify({ memoryEmbeddingKey: "different" }),
    })).rejects.toThrow(/did not read back/);
    expect(readFileSync(paths.file, "utf8")).toBe("old-encrypted-store");
    expect(JSON.parse(readFileSync(paths.markerFile, "utf8"))).toMatchObject({ status: "failed" });
    expect(readFileSync(paths.markerFile, "utf8")).not.toContain("synthetic-key");
  });

  it("keeps the old bytes when encryption fails", async () => {
    const paths = setup();
    await expect(migrateLegacyCredentialStore({
      ...paths,
      credentials: { memoryEmbeddingKey: "synthetic-key" },
      encrypt: async () => { throw new Error("OS store unavailable"); },
      decrypt: async (buffer) => buffer.toString(),
    })).rejects.toThrow(/OS store unavailable/);
    expect(readFileSync(paths.file, "utf8")).toBe("old-encrypted-store");
    expect(JSON.parse(readFileSync(paths.markerFile, "utf8"))).toMatchObject({ status: "failed" });
  });

  it("refuses to migrate bytes that changed after the decision to attempt", async () => {
    const paths = setup();
    writeFileSync(paths.file, "changed-after-selection", { mode: 0o600 });
    await expect(migrateLegacyCredentialStore({
      ...paths,
      credentials: { memoryEmbeddingKey: "synthetic-key" },
      ...plaintextCodec,
    })).rejects.toThrow(/changed/);
    expect(readFileSync(paths.file, "utf8")).toBe("changed-after-selection");
    expect(() => readFileSync(paths.markerFile)).toThrow();
  });

  it("does not overwrite an existing backup", async () => {
    const paths = setup();
    writeFileSync(paths.backupFile, "first-backup", { mode: 0o600 });
    await migrateLegacyCredentialStore({ ...paths, credentials: { key: "value" }, ...plaintextCodec });
    expect(readFileSync(paths.backupFile, "utf8")).toBe("first-backup");
  });

  it("treats a completed rewrite as success even when the marker cannot be written", async () => {
    const paths = setup();
    const credentials = { memoryEmbeddingKey: "synthetic-key" };
    const markerFile = join(workspace(), "missing", "marker.json");
    await expect(migrateLegacyCredentialStore({ ...paths, markerFile, credentials, ...plaintextCodec })).resolves.toEqual(credentials);
    expect(JSON.parse(readFileSync(paths.file, "utf8"))).toEqual(credentials);
  });

  it("keeps the original failure when the failure marker cannot be written", async () => {
    const paths = setup();
    const markerFile = join(workspace(), "missing", "marker.json");
    await expect(migrateLegacyCredentialStore({
      ...paths,
      markerFile,
      credentials: { key: "value" },
      encrypt: async () => { throw new Error("OS store unavailable"); },
      decrypt: async (buffer) => buffer.toString(),
    })).rejects.toThrow(/OS store unavailable/);
    expect(readFileSync(paths.file, "utf8")).toBe("old-encrypted-store");
  });
});

describe("recordLegacyMigrationFailure", () => {
  it("writes a private marker without the credential payload", () => {
    const directory = workspace();
    const markerFile = join(directory, "credential-namespace-migration.json");
    recordLegacyMigrationFailure({ markerFile, fileSha256: "hash", error: new Error("keychain denied") });
    expect(JSON.parse(readFileSync(markerFile, "utf8"))).toEqual({
      version: LEGACY_MARKER_VERSION,
      status: "failed",
      fileSha256: "hash",
      at: expect.any(String),
      error: "keychain denied",
    });
    expect(statSync(markerFile).mode & 0o777).toBe(0o600);
  });
});
