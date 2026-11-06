#!/usr/bin/env python3
"""Prove which Safe Storage service name Electron derives from app.setName.

The interposed Security.framework calls refuse every Safe Storage lookup, so this
probe never reads or creates a real keychain item. It runs a disposable copy of
the Electron runtime, re-signed ad-hoc so DYLD injection is allowed.
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


def run(argv, **kwargs):
    return subprocess.run(argv, check=True, capture_output=True, text=True, timeout=180, **kwargs)


def preferences():
    return [run(['security', name, '-d', 'user']).stdout for name in ['list-keychains', 'default-keychain']]


def main():
    before = preferences()
    scratch = Path(tempfile.mkdtemp(prefix='keychain-service-', dir=TEMP_BASE))
    os.chmod(scratch, 0o700)
    results = {'scope': 'Electron 43.7.9 keychain name selection, lookups refused'}
    try:
        expected = json.loads(CHECKSUMS.read_text())[ARCHIVE.name]
        assert hashlib.sha256(ARCHIVE.read_bytes()).hexdigest() == expected
        run(['ditto', '-x', '-k', str(ARCHIVE), str(scratch / 'runtime')])
        app_bundle = scratch / 'runtime' / 'Electron.app'
        run(['codesign', '--force', '--deep', '--sign', '-', str(app_bundle)])
        run(['clang', '-dynamiclib', '-o', str(scratch / 'probe.dylib'), str(ROOT / 'scripts/testing/keychain-service-interpose.c'),
             '-framework', 'Security', '-framework', 'CoreFoundation'])
        for name in ['profile', 'session', 'logs', 'home']:
            (scratch / name).mkdir()
        base_env = {k: v for k, v in os.environ.items() if k in ['PATH', 'TMPDIR', 'LANG', '__CF_USER_TEXT_ENCODING']}
        base_env.update(HOME=str(scratch / 'home'), ENTROPYBOT_KEYCHAIN_FIXTURE=str(scratch),
                        DYLD_INSERT_LIBRARIES=str(scratch / 'probe.dylib'))
        observed = {}
        for probe_name in [None, 'openmausbot', 'zz-fixture-name']:
            env = dict(base_env)
            if probe_name:
                env['PROBE_APP_NAME'] = probe_name
            process = subprocess.run(
                [str(app_bundle / 'Contents/MacOS/Electron'), '--enable-logging=stderr',
                 str((ROOT / 'scripts/testing/keychain-service-probe.mjs').resolve())],
                env=env, capture_output=True, text=True, timeout=45,
            )
            lines = [line for line in process.stderr.splitlines() if '[keychain-probe]' in line]
            result = json.loads((scratch / 'result.json').read_text())
            observed[probe_name or '<default>'] = {'electronName': result['electronName'], 'lines': lines}
            assert result['available'] is False, result
            assert lines, 'No Safe Storage lookup reached the interposer'
        results['observed'] = observed
        results['default_service'] = any('service=Electron Safe Storage' in line for line in observed['<default>']['lines'])
        results['set_name_service'] = any('service=openmausbot Safe Storage' in line for line in observed['openmausbot']['lines'])
        results['arbitrary_name_service'] = any('service=zz-fixture-name Safe Storage' in line for line in observed['zz-fixture-name']['lines'])
        assert results['default_service'] and results['set_name_service'] and results['arbitrary_name_service']
        results['passed'] = True
    finally:
        try:
            results['user_search_and_default_unchanged'] = preferences() == before
        except Exception as error:
            results['user_search_and_default_unchanged'] = False
            results['preference_check_error'] = str(error)
        shutil.rmtree(scratch)
        results['scratch_removed'] = not scratch.exists()
        print(json.dumps(results, indent=2, sort_keys=True))
        if not results['user_search_and_default_unchanged']:
            raise RuntimeError('User Keychain preference verification failed')


if __name__ == '__main__':
    main()
