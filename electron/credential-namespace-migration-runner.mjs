import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  LEGACY_READ_FLAG,
  migrateLegacyCredentialStore,
  parseLegacyCredentialResult,
  recordLegacyMigrationFailure,
  sha256,
  shouldAttemptLegacyMigration,
} from "./credential-namespace-migration.mjs";

export function readLegacyMigrationMarker(markerFile) {
  try {
    return JSON.parse(fs.readFileSync(markerFile, "utf8"));
  } catch {
    return null;
  }
}

/** The child must not see or block the running app's profile or single-instance lock. */
export function runLegacyCredentialRead({
  execPath = process.execPath,
  credentialsFile,
  spawnImpl = spawn,
  timeoutMs = 120_000,
  termGraceMs = 5_000,
  abandonMs = 15_000,
  tempRoot = os.tmpdir(),
  parse = parseLegacyCredentialResult,
  chmodProfile = (profile) => fs.chmodSync(profile, 0o700),
}) {
  return new Promise((resolve) => {
    const fail = (error) => resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
    let profile;
    const discardProfile = () => {
      if (!profile) return;
      try {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {}
    };
    try {
      profile = fs.mkdtempSync(path.join(tempRoot, "entropybot-legacy-read-"));
      chmodProfile(profile);
    } catch (error) {
      discardProfile();
      fail(`the legacy credential read could not start: ${error?.message ?? error}`);
      return;
    }
    let child;
    try {
      child = spawnImpl(execPath, [LEGACY_READ_FLAG], {
        env: { ...process.env, ENTROPYBOT_LEGACY_CREDENTIALS_FILE: credentialsFile, ENTROPYBOT_LEGACY_PROFILE: profile },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      discardProfile();
      fail(`the legacy credential read could not start: ${error?.message ?? error}`);
      return;
    }
    let stdout = "";
    let stderr = "";
    let timer;
    let killTimer;
    let abandonTimer;
    let cancelled = null;
    let settled = false;
    const finish = (value, removeProfile = true) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(abandonTimer);
      if (removeProfile) discardProfile();
      resolve(value);
    };
    const cancel = (error) => {
      if (cancelled || settled) return;
      cancelled = error;
      const signal = (name) => {
        try { child.kill(name); } catch {}
      };
      signal("SIGTERM");
      killTimer = setTimeout(() => signal("SIGKILL"), termGraceMs);
      killTimer.unref?.();
      // Never delete a profile an unconfirmed child may still write to; report and keep it.
      abandonTimer = setTimeout(() => finish({ ...error, retainedProfile: profile }, false), abandonMs);
      abandonTimer.unref?.();
    };
    timer = setTimeout(() => cancel({ ok: false, error: "the legacy credential read timed out" }), timeoutMs);
    timer.unref?.();
    child.stdout.on("data", (chunk) => {
      if (cancelled) return;
      stdout += chunk;
      if (stdout.length > 2_000_000) cancel({ ok: false, error: "the legacy credential read produced too much output" });
    });
    child.stderr.on("data", (chunk) => {
      if (cancelled) return;
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.on("error", (error) => {
      if (child.pid) cancel({ ok: false, error: "the legacy credential read process could not be controlled" });
      else finish({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      if (cancelled) return finish(cancelled, true);
      try {
        if (code !== 0) throw new Error(stderr.trim().split("\n").at(-1) || `the legacy credential read exited with ${code}`);
        finish({ ok: true, credentials: parse(stdout) });
      } catch (error) {
        finish({ ok: false, error: error.message });
      }
    });
  });
}

/** Try the pre-rename keychain entry once for these bytes; a denial must leave both stores untouched. */
export async function attemptLegacyCredentialMigration({
  file,
  markerFile,
  encrypt,
  decrypt,
  log = () => {},
  readLegacy = () => runLegacyCredentialRead({ credentialsFile: file }),
  now = () => new Date().toISOString(),
}) {
  let original;
  try {
    original = fs.readFileSync(file);
  } catch {
    return null;
  }
  const fileSha256 = sha256(original);
  const marker = readLegacyMigrationMarker(markerFile);
  if (!shouldAttemptLegacyMigration({ marker, fileSha256 })) {
    if (marker?.status === "failed") log(`legacy credential migration was not retried for this store (${marker.error})`);
    return null;
  }
  log("credential store may use the pre-rename keychain entry; reading it once under the old app name");
  let read;
  try {
    read = await readLegacy();
  } catch (error) {
    read = { ok: false, error: error?.message ?? String(error) };
  }
  if (!read?.ok) {
    const error = read?.error ?? "the legacy credential read returned no result";
    try {
      recordLegacyMigrationFailure({ markerFile, fileSha256, error, now });
    } catch {}
    log(`legacy credential migration failed: ${error}`);
    if (read?.retainedProfile) log(`legacy credential read exit unconfirmed; temporary profile retained: ${read.retainedProfile}`);
    return null;
  }
  try {
    const credentials = await migrateLegacyCredentialStore({
      file,
      backupFile: `${file}.legacy-${fileSha256.slice(0, 12)}.bak`,
      markerFile,
      fileSha256,
      credentials: read.credentials,
      encrypt,
      decrypt,
      now,
    });
    log(`credential store migrated to the current keychain entry (${Object.keys(credentials).length} saved item(s))`);
    return credentials;
  } catch (error) {
    log(`legacy credential migration could not be completed: ${error?.message ?? error}`);
    return null;
  }
}
