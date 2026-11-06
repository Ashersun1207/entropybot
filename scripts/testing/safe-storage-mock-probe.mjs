import assert from 'node:assert/strict';
import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';

assert(app.commandLine.hasSwitch('use-mock-keychain'));
const root = process.env.ENTROPYBOT_KEYCHAIN_FIXTURE;
assert(root?.startsWith('/private/var/folders/') && root.includes('/safe-storage-mock-'));
app.setName('entropybot-isolated-keychain-fixture');
app.setPath('userData', path.join(root, 'profile'));
app.setPath('sessionData', path.join(root, 'session'));
app.setPath('logs', path.join(root, 'logs'));
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-background-networking');
const plaintext = JSON.stringify({ memoryEmbeddingKey: 'synthetic-mock-keychain-canary' });
function encryptedWith(password) {
  // Electron 43.7.9's restored Chromium sync backend uses this macOS v10 format.
  const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 32));
  return Buffer.concat([Buffer.from('v10'), cipher.update(plaintext, 'utf8'), cipher.final()]);
}
app.whenReady().then(async () => {
  const available = await safeStorage.isAsyncEncryptionAvailable();
  assert.equal(available, true);
  const matching = await safeStorage.decryptStringAsync(encryptedWith('mock_password'));
  assert.equal(matching.result, plaintext);
  let mismatchedError;
  try {
    await safeStorage.decryptStringAsync(encryptedWith('synthetic-different-keychain-password'));
  } catch (error) {
    mismatchedError = error.message;
  }
  assert.equal(mismatchedError, 'Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.');
  const asyncCiphertext = await safeStorage.encryptStringAsync(plaintext);
  const roundTrip = await safeStorage.decryptStringAsync(asyncCiphertext);
  assert.equal(roundTrip.result, plaintext);
  const syncCiphertext = safeStorage.encryptString(plaintext);
  assert.equal((await safeStorage.decryptStringAsync(syncCiphertext)).result, plaintext);
  app.setName('entropybot-isolated-renamed-fixture');
  assert.equal((await safeStorage.decryptStringAsync(syncCiphertext)).result, plaintext);
  const result = {
    electron: process.versions.electron,
    mockKeychain: true,
    asyncAvailable: available,
    matchingV10Decrypts: true,
    mismatchedV10Error: mismatchedError,
    syncToAsyncDecrypts: true,
    asyncRoundTrip: true,
    decryptsAfterRenameWithinInitializedMockProcess: true,
    limitation: 'Mock always returns mock_password; does not test real service lookup, ACL, or migration',
  };
  fs.writeFileSync(path.join(root, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
  app.exit(0);
}).catch(error => {
  console.error(error);
  app.exit(1);
});
