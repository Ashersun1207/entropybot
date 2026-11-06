#!/usr/bin/env python3
"""Native macOS mechanism probe; does not launch Electron or migrate user data."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
TEMP_BASE = Path('/private/var/folders/3_/4wcgrlpj1cx98_dychpdms240000gn/T/opencode')


def run(argv, **kwargs):
    return subprocess.run(argv, check=True, capture_output=True, timeout=45, **kwargs)


def user_preferences():
    return {name: run(['security', name, '-d', 'user']).stdout
            for name in ['list-keychains', 'default-keychain']}


def crypt(value, password, decrypt=False):
    # Chromium 140 OSCrypt macOS v10: PBKDF2-SHA1/1003, AES-128-CBC, space IV.
    key = hashlib.pbkdf2_hmac('sha1', password.encode(), b'saltysalt', 1003, 16)
    args = ['openssl', 'enc', '-aes-128-cbc', '-K', key.hex(), '-iv', (b' ' * 16).hex()]
    if decrypt:
        args.append('-d')
    return subprocess.run(args, input=value, capture_output=True, timeout=10)


def main():
    before = user_preferences()
    scratch = Path(tempfile.mkdtemp(prefix='keychain-mechanism-', dir=TEMP_BASE))
    os.chmod(scratch, 0o700)
    results = {'scope': 'native Security.framework plus synthetic Chromium-v10-compatible crypto'}
    try:
        binary = scratch / 'fixture'
        original = scratch / 'fixture-original'
        keychain = scratch / 'fixture.keychain'
        run(['xcrun', 'swiftc', str(ROOT / 'scripts/testing/keychain-isolation-fixture.swift'), '-o', str(binary)])
        run(['codesign', '--force', '--sign', '-', '--identifier', 'fixture.identity.one', str(binary)])
        shutil.copy2(binary, original)

        def probe(action):
            return json.loads(run([str(binary), action, str(keychain)]).stdout)

        results['seed'] = probe('seed')
        assert user_preferences() == before, 'Private keychain changed user search/default preferences'
        assert results['seed']['old']['matchesSyntheticValue']
        assert results['seed']['new']['matchesSyntheticValue']
        assert results['seed']['missing']['status'] == -25300
        results['same_signature_restart'] = probe('read')
        assert results['same_signature_restart']['old']['matchesSyntheticValue']
        assert results['same_signature_restart']['new']['matchesSyntheticValue']

        payload = b'{"memoryEmbeddingKey":"synthetic-canary-for-isolated-probe"}'
        encrypted = crypt(payload, 'synthetic-old-service-password')
        assert encrypted.returncode == 0
        ciphertext = b'v10' + encrypted.stdout
        (scratch / 'credentials.bin').write_bytes(ciphertext)
        old = crypt(ciphertext[3:], 'synthetic-old-service-password', True)
        renamed = crypt(ciphertext[3:], 'synthetic-new-service-password', True)
        assert old.returncode == 0 and old.stdout == payload
        assert renamed.returncode != 0 or renamed.stdout != payload
        results['namespace'] = {'both_keychain_items_readable': True, 'old_key_decrypts': True,
                                'new_key_decrypts': renamed.returncode == 0 and renamed.stdout == payload,
                                'ciphertext_preserved': (scratch / 'credentials.bin').read_bytes() == ciphertext}

        run(['codesign', '--force', '--sign', '-', '--identifier', 'fixture.identity.two', str(binary)])
        results['changed_signature'] = probe('read')
        assert results['changed_signature']['old']['status'] == -25293
        assert results['changed_signature']['new']['status'] == -25293
        shutil.copy2(original, binary)
        results['restored_signature'] = probe('read')
        assert results['restored_signature']['old']['matchesSyntheticValue']
        assert results['restored_signature']['new']['matchesSyntheticValue']
        probe('lock')
        results['locked_keychain'] = probe('read')
        assert results['locked_keychain']['old']['status'] == -25293
        assert results['locked_keychain']['new']['status'] == -25293
        results['passed'] = True
    finally:
        try:
            results['user_search_and_default_unchanged'] = user_preferences() == before
        except Exception as error:
            results['user_search_and_default_unchanged'] = False
            results['preference_check_error'] = str(error)
        try:
            shutil.rmtree(scratch)
        finally:
            results['scratch_removed'] = not scratch.exists()
            print(json.dumps(results, indent=2, sort_keys=True))
        if not results['user_search_and_default_unchanged']:
            raise RuntimeError('User Keychain preference verification failed')


if __name__ == '__main__':
    main()
