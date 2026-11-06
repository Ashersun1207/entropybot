import fs from "node:fs";
import path from "node:path";

import { LEGACY_MARKER_FILE } from "./credential-namespace-migration.mjs";
import { attemptLegacyCredentialMigration } from "./credential-namespace-migration-runner.mjs";
import { readSecureCredentials } from "./secure-credentials.mjs";

/** One owner for "could not read" so no writer can replace secrets it never saw. */
export function createSecureCredentialIO({
  file,
  safeStorage,
  log = () => {},
  isPackaged,
  platform,
  migrate = attemptLegacyCredentialMigration,
  read = readSecureCredentials,
}) {
  const markerFile = path.join(path.dirname(file), LEGACY_MARKER_FILE);
  let unavailable = false;

  const load = async () => {
    let result = await read({
      exists: () => fs.existsSync(file),
      isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      readFile: () => fs.readFileSync(file),
      decrypt: (buffer) => safeStorage.decryptStringAsync(buffer),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    if (result.status === "unavailable" && isPackaged && platform === "darwin") {
      let credentials = null;
      try {
        credentials = await migrate({
          file,
          markerFile,
          encrypt: (value) => safeStorage.encryptStringAsync(value),
          decrypt: async (buffer) => (await safeStorage.decryptStringAsync(buffer)).result,
          log,
        });
      } catch (error) {
        log(`legacy credential migration aborted safely: ${error?.message ?? error}`);
      }
      if (credentials) result = { status: "ok", credentials };
    }
    unavailable = result.status === "unavailable";
    if (unavailable) log(`credential store unreadable after retries (${result.error}); saved keys are not loaded this launch`);
    return result.credentials;
  };

  const save = async (credentials) => {
    // Writing from an unread store would drop the secrets it could not read.
    if (unavailable) throw new Error("The operating-system credential store could not be read this launch");
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error("The operating-system credential store is unavailable");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(credentials));
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
    fs.renameSync(temporary, file);
  };

  return { load, save, unavailable: () => unavailable };
}
