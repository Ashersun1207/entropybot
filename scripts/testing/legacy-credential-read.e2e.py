#!/usr/bin/env python3
"""Exercise the legacy credential read branch with Electron's mock keychain.

This proves process wiring and framing, not a real Keychain ACL or name lookup.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
TEMP_BASE = Path('/private/var/folders/3_/4wcgrlpj1cx98_dychpdms240000gn/T/opencode')
ARCHIVE = Path('/Users/sun/Library/Caches/electron/36015c644ea53166533d8291c2675bc7ee3c273a4d591717e6b444a4b99d1913/electron-v43.7.9-darwin-arm64.zip')
CHECKSUMS = Path('/Users/sun/Desktop/Codex/gorkbot/app/node_modules/electron/checksums.json')
FIXTURE = {'memoryEmbeddingKey': 'synthetic-legacy-read-canary', 'xaiApiKey': 'synthetic-second-value'}
ENCRYPT_SCRIPT = r'''
import fs from 'node:fs';
import { app, safeStorage } from 'electron';
app.setPath('userData', process.env.FIXTURE_PROFILE);
app.whenReady().then(async () => {
  fs.mkdirSync(process.env.FIXTURE_PROFILE, { recursive: true, mode: 0o700 });
  const encrypted = await safeStorage.encryptStringAsync(process.env.FIXTURE_JSON);
  fs.writeFileSync(process.env.FIXTURE_FILE, encrypted, { mode: 0o600 });
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
'''


def run(argv, **kwargs):
    return subprocess.run(argv, check=True, capture_output=True, text=True, timeout=180, **kwargs)


def main():
    scratch = Path(tempfile.mkdtemp(prefix='legacy-read-e2e-', dir=TEMP_BASE))
    os.chmod(scratch, 0o700)
    results = {'scope': 'mock keychain child wiring and framing'}
    try:
        expected = json.loads(CHECKSUMS.read_text())[ARCHIVE.name]
        assert hashlib.sha256(ARCHIVE.read_bytes()).hexdigest() == expected
        run(['ditto', '-x', '-k', str(ARCHIVE), str(scratch / 'runtime')])
        electron = scratch / 'runtime' / 'Electron.app' / 'Contents' / 'MacOS' / 'Electron'
        home = scratch / 'home'
        profile = home / 'Library' / 'Application Support' / 'openmausbot'
        legacy_profile = scratch / 'legacy-profile'
        profile.mkdir(parents=True)
        encrypt_script = scratch / 'encrypt.mjs'
        encrypt_script.write_text(ENCRYPT_SCRIPT)
        base = {k: v for k, v in os.environ.items() if k in ['PATH', 'TMPDIR', 'LANG', '__CF_USER_TEXT_ENCODING']}
        base.update(HOME=str(home))
        run([str(electron), '--use-mock-keychain', str(encrypt_script)], env={
            **base, 'FIXTURE_PROFILE': str(profile), 'FIXTURE_FILE': str(profile / 'credentials.bin'),
            'FIXTURE_JSON': json.dumps(FIXTURE),
        })
        child = subprocess.run(
            [str(electron), '--use-mock-keychain', str(ROOT / 'electron' / 'main.mjs'), '--entropybot-legacy-credential-read'],
            cwd=ROOT,
            env={**base, 'ENTROPYBOT_LEGACY_CREDENTIALS_FILE': str(profile / 'credentials.bin'),
                 'ENTROPYBOT_LEGACY_PROFILE': str(legacy_profile)},
            capture_output=True, text=True, timeout=45,
        )
        results['exit'] = child.returncode
        results['result_line_present'] = 'ENTROPYBOT_LEGACY_CREDENTIAL_RESULT ' in child.stdout
        line = next(line for line in child.stdout.splitlines() if line.startswith('ENTROPYBOT_LEGACY_CREDENTIAL_RESULT '))
        decoded = json.loads(__import__('base64').b64decode(line.split(' ', 1)[1]))
        results['round_trip'] = decoded == FIXTURE
        results['secret_absent_from_stderr'] = 'synthetic-legacy-read-canary' not in child.stderr
        assert child.returncode == 0 and results['round_trip'] and results['secret_absent_from_stderr']
        results['runtime_profile_written'] = legacy_profile.exists()

        (profile / 'credentials.bin').write_bytes(b'v10' + b'not-a-real-ciphertext')
        failed = subprocess.run(
            [str(electron), '--use-mock-keychain', str(ROOT / 'electron' / 'main.mjs'), '--entropybot-legacy-credential-read'],
            cwd=ROOT,
            env={**base, 'ENTROPYBOT_LEGACY_CREDENTIALS_FILE': str(profile / 'credentials.bin'),
                 'ENTROPYBOT_LEGACY_PROFILE': str(legacy_profile)},
            capture_output=True, text=True, timeout=45,
        )
        results['tampered_exit'] = failed.returncode
        results['tampered_has_no_result'] = 'ENTROPYBOT_LEGACY_CREDENTIAL_RESULT ' not in failed.stdout
        assert failed.returncode != 0 and results['tampered_has_no_result']
        results['passed'] = True
    finally:
        shutil.rmtree(scratch)
        results['scratch_removed'] = not scratch.exists()
        print(json.dumps(results, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
