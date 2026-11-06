#!/usr/bin/env python3
"""Synthetic Electron mock transport and explicit-file private Keychain checks."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
TEMP_BASE = Path('/private/var/folders/3_/4wcgrlpj1cx98_dychpdms240000gn/T/opencode')
ARCHIVE = Path('/Users/sun/Library/Caches/electron/36015c644ea53166533d8291c2675bc7ee3c273a4d591717e6b444a4b99d1913/electron-v43.7.9-darwin-arm64.zip')
OLD_COMMIT = '8138dca42'
CANARY = {'memoryEmbeddingKey': 'synthetic-rollback-electron-canary', 'xaiApiKey': 'synthetic-second-key'}
SCRIPT = r'''
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, dialog, safeStorage } from 'electron';
const root = process.env.FIXTURE_ROOT;
const directory = process.env.FIXTURE_DIRECTORY;
const mode = process.env.FIXTURE_MODE;
const file = path.join(directory, 'credentials.bin');
const expected = JSON.parse(process.env.FIXTURE_JSON);
const load = (name) => import(pathToFileURL(path.join(root, 'electron', name)).href);
app.setName(mode === 'seed' || mode === 'old-read' ? 'openmausbot' : 'Entropybot');
app.setPath('userData', path.join(directory, 'profile-' + mode));
if (mode.startsWith('child-')) {
  dialog.showMessageBox = async () => ({ response: mode === 'child-authorized' ? 1 : 0 });
  const { installLegacyCredentialRead } = await load('credential-namespace-migration-child.mjs');
  installLegacyCredentialRead({ argv: ['fixture', '--entropybot-legacy-credential-read'], env: {
    ENTROPYBOT_LEGACY_CREDENTIALS_FILE: file,
    ENTROPYBOT_LEGACY_PROFILE: path.join(directory, 'child-profile'),
  } });
} else {
  app.whenReady().then(async () => {
    const decrypt = async (bytes) => (await safeStorage.decryptStringAsync(bytes)).result;
    const migration = await load('credential-namespace-migration.mjs');
    if (mode === 'seed') {
      fs.writeFileSync(file, await safeStorage.encryptStringAsync(JSON.stringify(expected, null, 2)), { mode: 0o600 });
    } else if (mode === 'migrate') {
      const source = fs.readFileSync(file);
      const fileSha256 = migration.sha256(source);
      const markerFile = path.join(directory, 'marker.json');
      const marker = fs.existsSync(markerFile) ? JSON.parse(fs.readFileSync(markerFile)) : null;
      if (!migration.shouldAttemptLegacyMigration({ marker, fileSha256 })) throw Error('unexpected suppression');
      await migration.migrateLegacyCredentialStore({ file, fileSha256, markerFile,
        backupFile: path.join(directory, 'old.bak'), credentials: JSON.parse(await decrypt(source)),
        encrypt: (value) => safeStorage.encryptStringAsync(value), decrypt });
    } else if (mode === 'old-read') {
      const { readSecureCredentials } = await import(pathToFileURL(path.join(directory, 'old-reader.mjs')).href);
      const result = await readSecureCredentials({ exists: () => true,
        isAvailable: () => safeStorage.isAsyncEncryptionAvailable(), readFile: () => fs.readFileSync(file),
        decrypt: (bytes) => safeStorage.decryptStringAsync(bytes), sleep: async () => {}, delays: [] });
      if (result.status !== 'ok' || JSON.stringify(result.credentials) !== JSON.stringify(expected)) throw Error('old reader mismatch');
    } else if (JSON.stringify(JSON.parse(await decrypt(fs.readFileSync(file)))) !== JSON.stringify(expected)) {
      throw Error('restart mismatch');
    }
    console.log('FIXTURE_OK');
    app.exit(0);
  }).catch(() => { console.error('synthetic fixture failed'); app.exit(1); });
}
'''


class OwnedCommands:
    """Confirm exit of our POSIX process groups; detached descendants are outside this fixture's guarantee."""
    def __init__(self):
        self.groups = {}
        self.events = []

    def group_exists(self, pgid):
        try:
            os.killpg(pgid, 0)
            return True
        except ProcessLookupError:
            return False

    def wait_group(self, pgid, seconds):
        deadline = time.monotonic() + seconds
        while self.group_exists(pgid):
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.02)
        self.groups.pop(pgid, None)
        return True

    def stop(self, process):
        for name, grace in [(signal.SIGTERM, 1), (signal.SIGKILL, 2)]:
            try:
                os.killpg(process.pid, name)
            except ProcessLookupError:
                pass
            try:
                process.communicate(timeout=grace)
            except subprocess.TimeoutExpired:
                pass
            if self.wait_group(process.pid, grace):
                self.events.append({'pgid': process.pid, 'exit_confirmed': True})
                return True
        self.events.append({'pgid': process.pid, 'exit_confirmed': False})
        return False

    def run(self, argv, timeout=60, **kwargs):
        process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   start_new_session=True, **kwargs)
        self.groups[process.pid] = process
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except BaseException:
            self.stop(process)
            raise
        if not self.wait_group(process.pid, 0.5):
            if not self.stop(process):
                raise RuntimeError('Fixture process group exit is unconfirmed')
        return subprocess.CompletedProcess(argv, process.returncode, stdout, stderr)

    def close(self):
        for process in list(self.groups.values()):
            self.stop(process)
        return not self.groups


def preferences(commands):
    values = []
    for verb in ['list-keychains', 'default-keychain']:
        result = commands.run(['security', verb, '-d', 'user'])
        assert result.returncode == 0
        values.append(result.stdout)
    return values


def check_platform(commands, scratch, results):
        run = commands.run
        expected = json.loads((ROOT / 'node_modules/electron/checksums.json').read_text())[ARCHIVE.name]
        assert hashlib.sha256(ARCHIVE.read_bytes()).hexdigest() == expected
        assert run(['ditto', '-x', '-k', str(ARCHIVE), str(scratch / 'runtime')]).returncode == 0
        electron = scratch / 'runtime/Electron.app/Contents/MacOS/Electron'
        script = scratch / 'fixture.mjs'
        script.write_text(SCRIPT)
        old = run(['git', 'show', f'{OLD_COMMIT}:electron/secure-credentials.mjs'], cwd=ROOT)
        assert old.returncode == 0
        (scratch / 'old-reader.mjs').write_bytes(old.stdout)
        results['old_reader_sha256'] = hashlib.sha256(old.stdout).hexdigest()
        home = scratch / 'home'
        home.mkdir(mode=0o700)
        base = {k: v for k, v in os.environ.items() if k in ['PATH', 'TMPDIR', 'LANG', '__CF_USER_TEXT_ENCODING']}
        base.update(HOME=str(home), FIXTURE_ROOT=str(ROOT), FIXTURE_DIRECTORY=str(scratch), FIXTURE_JSON=json.dumps(CANARY))

        def electron_run(mode):
            result = run([str(electron), '--use-mock-keychain', str(script)], env={**base, 'FIXTURE_MODE': mode}, cwd=ROOT)
            assert CANARY['memoryEmbeddingKey'].encode() not in result.stderr
            return result

        assert electron_run('seed').returncode == 0
        original = (scratch / 'credentials.bin').read_bytes()
        denied = electron_run('child-denied')
        assert denied.returncode != 0 and b'ENTROPYBOT_LEGACY_CREDENTIAL_RESULT ' not in denied.stdout
        assert (scratch / 'credentials.bin').read_bytes() == original
        results['unapproved_export_denied'] = True
        approved = electron_run('child-authorized')
        assert approved.returncode == 0
        line = next(line for line in approved.stdout.splitlines() if line.startswith(b'ENTROPYBOT_LEGACY_CREDENTIAL_RESULT '))
        assert json.loads(base64.b64decode(line.split(b' ', 1)[1])) == CANARY
        results['approved_mock_transport_roundtrip'] = True
        assert electron_run('migrate').returncode == 0
        assert (scratch / 'old.bak').read_bytes() == original
        assert electron_run('restart-read').returncode == 0
        assert electron_run('old-read').returncode == 0
        results['restart_and_024_reader_compatible_with_025_format_mock'] = True
        shutil.copyfile(scratch / 'old.bak', scratch / 'credentials.bin')
        assert electron_run('migrate').returncode == 0
        assert electron_run('restart-read').returncode == 0
        assert (scratch / 'old.bak').read_bytes() == original
        results['restored_old_backup_migrated_again_mock'] = True

        binary = scratch / 'keychain-fixture'
        build = run(['xcrun', 'swiftc', str(ROOT / 'scripts/testing/keychain-isolation-fixture.swift'), '-o', str(binary)])
        assert build.returncode == 0
        keychain = scratch / 'fixture.keychain'

        def native(action):
            result = run([str(binary), action, str(keychain)])
            assert result.returncode == 0
            return json.loads(result.stdout)

        seeded = native('seed')
        assert seeded['old']['matchesSyntheticValue'] and seeded['new']['matchesSyntheticValue']
        restarted = native('read')
        assert restarted['old']['matchesSyntheticValue'] and restarted['new']['matchesSyntheticValue']
        native('lock')
        locked = native('read')
        for item in ['old', 'new']:
            assert locked[item]['status'] == -25293 and not locked[item]['matchesSyntheticValue']
        results['private_keychain'] = {'scope': 'explicit-file native fixture only; no Electron ACL claim',
                                       'seed': seeded, 'restart': restarted, 'locked': locked}


def main(work=check_platform, query=preferences, commands_factory=OwnedCommands, chmod=os.chmod):
    scratch = Path(tempfile.mkdtemp(prefix='credential-rollback-acceptance-', dir=TEMP_BASE))
    results = {'old_source_commit': OLD_COMMIT, 'electron_scope': 'real Electron with mock keychain and mocked consent dialog'}
    commands = None
    before = None
    failure = None
    phase = 'initialize'
    try:
        commands = commands_factory()
        chmod(scratch, 0o700)
        phase = 'initial_preferences'
        before = query(commands)
        phase = 'platform_checks'
        work(commands, scratch, results)
        results['checks_passed'] = True
    except BaseException as error:
        failure = error
        results['failed_phase'] = phase
        results['error_type'] = type(error).__name__
    finally:
        try:
            if before is None:
                results['user_search_and_default_unchanged'] = None
            else:
                results['user_search_and_default_unchanged'] = query(commands) == before
                if not results['user_search_and_default_unchanged']:
                    raise RuntimeError('User Keychain preference verification failed')
        except BaseException as error:
            results['final_preference_error_type'] = type(error).__name__
            results['user_search_and_default_unchanged'] = False
            if failure is None:
                failure = error
                results['failed_phase'] = 'final_preferences'
        confirmed = False
        try:
            confirmed = commands is None or commands.close()
        except BaseException as error:
            results['process_cleanup_error_type'] = type(error).__name__
            failure = failure or error
        results['process_groups_exit_confirmed'] = confirmed
        if confirmed:
            try:
                shutil.rmtree(scratch)
            except BaseException as error:
                results['directory_cleanup_error_type'] = type(error).__name__
                failure = failure or error
        if scratch.exists():
            results['retained_scratch'] = str(scratch)
        results['scratch_removed'] = not scratch.exists()
        results['passed'] = failure is None and confirmed and results['scratch_removed']
        print(json.dumps(results, sort_keys=True, indent=2))
    if not results['passed']:
        raise RuntimeError('Acceptance fixture failed; inspect its phase and retained evidence') from failure
    return results


if __name__ == '__main__':
    main()
