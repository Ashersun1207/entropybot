import { app, safeStorage } from "electron";
import fs from "node:fs";

import { LEGACY_APP_NAME, LEGACY_READ_FLAG, encodeLegacyCredentialResult } from "./credential-namespace-migration.mjs";
import { readSecureCredentials } from "./secure-credentials.mjs";

/** Must run before app ready: Electron fixes the Safe Storage service name after the main script starts. */
export function installLegacyCredentialRead({ argv = process.argv, env = process.env } = {}) {
  if (!argv.includes(LEGACY_READ_FLAG)) return false;
  app.setName(LEGACY_APP_NAME);
  if (env.ENTROPYBOT_LEGACY_PROFILE) app.setPath("userData", env.ENTROPYBOT_LEGACY_PROFILE);
  app.whenReady().then(async () => {
    const file = env.ENTROPYBOT_LEGACY_CREDENTIALS_FILE;
    try {
      if (!file) throw new Error("No legacy credential file was provided");
      const result = await readSecureCredentials({
        exists: () => fs.existsSync(file),
        isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
        readFile: () => fs.readFileSync(file),
        decrypt: (buffer) => safeStorage.decryptStringAsync(buffer),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });
      if (result.status !== "ok") throw new Error(result.error ?? result.status);
      fs.writeSync(1, encodeLegacyCredentialResult(result.credentials));
      app.exit(0);
    } catch (error) {
      fs.writeSync(2, `legacy credential read failed: ${error?.message ?? error}\n`);
      app.exit(1);
    }
  });
  return true;
}
