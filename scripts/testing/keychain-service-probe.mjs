import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';

const requestedName = process.env.PROBE_APP_NAME;
if (requestedName) app.setName(requestedName);
const root = process.env.ENTROPYBOT_KEYCHAIN_FIXTURE;
app.setPath('userData', path.join(root, 'profile'));
app.setPath('sessionData', path.join(root, 'session'));
app.setPath('logs', path.join(root, 'logs'));

app.whenReady().then(async () => {
  let available;
  try {
    available = await Promise.race([
      safeStorage.isAsyncEncryptionAvailable(),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 8000)),
    ]);
  } catch (error) {
    available = `error: ${error.message}`;
  }
  fs.writeFileSync(path.join(root, 'result.json'), `${JSON.stringify({
    requestedName,
    electronName: app.getName(),
    available,
  })}\n`);
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
