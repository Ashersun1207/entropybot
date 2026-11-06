import { createHash } from "node:crypto";
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";

/** Electron derives the macOS Safe Storage entry from the app name, not the profile directory. */
export const LEGACY_APP_NAME = "openmausbot";
export const LEGACY_READ_FLAG = "--entropybot-legacy-credential-read";
export const LEGACY_RESULT_PREFIX = "ENTROPYBOT_LEGACY_CREDENTIAL_RESULT ";
export const LEGACY_MARKER_FILE = "credential-namespace-migration.json";
export const LEGACY_MARKER_VERSION = 1;
const MAX_RESULT_BYTES = 1024 * 1024;

const isPlainRecord = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasUnsafeKey = (value) =>
  isPlainRecord(value) && Object.keys(value).some((key) => key === "__proto__" || key === "constructor" || key === "prototype");

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function encodeLegacyCredentialResult(credentials) {
  if (!isPlainRecord(credentials) || hasUnsafeKey(credentials)) throw new Error("Unsafe credential document");
  return `${LEGACY_RESULT_PREFIX}${Buffer.from(JSON.stringify(credentials), "utf8").toString("base64")}\n`;
}

/** The child may print Chromium diagnostics; only the last marked line is the payload. */
export function parseLegacyCredentialResult(stdout) {
  const lines = String(stdout).split("\n").filter((line) => line.startsWith(LEGACY_RESULT_PREFIX));
  if (!lines.length) throw new Error("The legacy credential read returned no result");
  const encoded = lines.at(-1).slice(LEGACY_RESULT_PREFIX.length).trim();
  if (!encoded || encoded.length > Math.ceil((MAX_RESULT_BYTES * 4) / 3)) {
    throw new Error("The legacy credential read returned an oversized result");
  }
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("The legacy credential read returned invalid base64");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > MAX_RESULT_BYTES) throw new Error("The legacy credential read returned an oversized result");
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("The legacy credential read returned invalid JSON");
  }
  if (!isPlainRecord(parsed) || hasUnsafeKey(parsed)) throw new Error("The legacy credential read returned an unsafe document");
  return parsed;
}

/** A failed attempt is not retried for the same bytes, so a denied keychain prompt cannot loop on every launch.
 * A completed migration only suppresses the store it produced; restoring the old bytes may be recovered again. */
export function shouldAttemptLegacyMigration({ marker, fileSha256 }) {
  if (marker?.version !== LEGACY_MARKER_VERSION) return true;
  if (marker.status === "failed") return marker.fileSha256 !== fileSha256;
  if (marker.status === "migrated") return !marker.resultSha256 || marker.resultSha256 !== fileSha256;
  return true;
}

function writePrivateFile(file, bytes) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function writeMarker(file, marker) {
  writePrivateFile(file, `${JSON.stringify(marker, null, 2)}\n`);
}

const safeMessage = (error) => String(error instanceof Error ? error.message : error).replace(/\s+/g, " ").slice(0, 300);

export function recordLegacyMigrationFailure({ markerFile, fileSha256, error, now = () => new Date().toISOString() }) {
  writeMarker(markerFile, {
    version: LEGACY_MARKER_VERSION,
    status: "failed",
    fileSha256,
    at: now(),
    error: safeMessage(error),
  });
}

/** Back up the old file, write and verify the new one, and restore the old bytes on any failure. */
export async function migrateLegacyCredentialStore({
  file,
  backupFile,
  markerFile,
  fileSha256,
  credentials,
  encrypt,
  decrypt,
  now = () => new Date().toISOString(),
}) {
  if (!isPlainRecord(credentials) || hasUnsafeKey(credentials)) throw new Error("Unsafe credential document");
  const original = fs.readFileSync(file);
  if (sha256(original) !== fileSha256) throw new Error("The credential store changed while it was being migrated");
  if (!fs.existsSync(backupFile)) writePrivateFile(backupFile, original);
  const temporary = `${file}.${process.pid}.migrate.tmp`;
  try {
    const encrypted = await encrypt(JSON.stringify(credentials));
    if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error("The new credential store was not encrypted");
    fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
    const verified = JSON.parse(await decrypt(fs.readFileSync(temporary)));
    if (!isPlainRecord(verified) || !isDeepStrictEqual(verified, credentials)) {
      throw new Error("The new credential store did not read back as written");
    }
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    let failure = error;
    try {
      const current = fs.readFileSync(file);
      if (!current.equals(original)) writePrivateFile(file, original);
    } catch (restoreError) {
      failure = new Error(`${safeMessage(error)}; restoring the old store failed: ${safeMessage(restoreError)}`);
    }
    try {
      recordLegacyMigrationFailure({ markerFile, fileSha256, error: failure, now });
    } catch {}
    throw new Error(`Legacy credential migration failed: ${safeMessage(failure)}`);
  }
  // The store is already valid; a marker problem must not turn a completed migration into a failed launch.
  try {
    writeMarker(markerFile, {
      version: LEGACY_MARKER_VERSION,
      status: "migrated",
      fileSha256,
      resultSha256: sha256(fs.readFileSync(file)),
      backup: backupFile,
      at: now(),
    });
  } catch {}
  return credentials;
}
