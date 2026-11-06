#!/usr/bin/env python3
"""Exercise acceptance cleanup failures with synthetic queries and owned processes only."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

source = Path(__file__).with_name('credential-namespace-migration-acceptance-fixture.py')
spec = importlib.util.spec_from_file_location('acceptance_fixture', source)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory(prefix='entropybot-cleanup-tests-')
        self.previous_root = fixture.TEMP_BASE
        fixture.TEMP_BASE = Path(self.root.name)

    def tearDown(self):
        fixture.TEMP_BASE = self.previous_root
        self.root.cleanup()

    def run_failing(self, **kwargs):
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            with self.assertRaises(RuntimeError):
                fixture.main(**kwargs)
        return json.loads(stream.getvalue())

    def test_initial_query_failure_cleans_and_reports(self):
        def query(_commands):
            raise RuntimeError('synthetic query failure')
        result = self.run_failing(query=query, work=lambda *_args: self.fail('work must not start'))
        self.assertEqual(result['failed_phase'], 'initial_preferences')
        self.assertIsNone(result['user_search_and_default_unchanged'])
        self.assertTrue(result['scratch_removed'])

    def test_final_query_failure_preserves_primary_failure(self):
        calls = 0
        def query(_commands):
            nonlocal calls
            calls += 1
            if calls > 1:
                raise RuntimeError('synthetic final query failure')
            return ['fixture-preference']
        def work(*_args):
            raise ValueError('synthetic primary failure')
        result = self.run_failing(query=query, work=work)
        self.assertEqual(result['failed_phase'], 'platform_checks')
        self.assertEqual(result['error_type'], 'ValueError')
        self.assertEqual(result['final_preference_error_type'], 'RuntimeError')
        self.assertTrue(result['scratch_removed'])

    def test_chmod_failure_cleans_immediately(self):
        def chmod(*_args):
            raise PermissionError('synthetic chmod failure')
        result = self.run_failing(chmod=chmod, query=lambda _: [], work=lambda *_args: None)
        self.assertEqual(result['failed_phase'], 'initialize')
        self.assertTrue(result['scratch_removed'])

    def test_unconfirmed_processes_retain_scratch(self):
        class Unconfirmed:
            def close(self):
                return False
        result = self.run_failing(commands_factory=Unconfirmed, query=lambda _: [], work=lambda *_args: None)
        scratch = Path(result['retained_scratch'])
        try:
            self.assertFalse(result['process_groups_exit_confirmed'])
            self.assertFalse(result['scratch_removed'])
            self.assertTrue(scratch.is_dir())
        finally:
            scratch.rmdir()

    def test_timed_out_group_with_descendant_exits_before_cleanup(self):
        code = '''
import signal, subprocess, sys, time
child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])
def stop(*_args):
    child.kill()
    child.wait()
    raise SystemExit(0)
signal.signal(signal.SIGTERM, stop)
print(child.pid, flush=True)
time.sleep(120)
'''
        commands = fixture.OwnedCommands()
        try:
            with self.assertRaises(subprocess.TimeoutExpired):
                commands.run([sys.executable, '-c', code], timeout=0.5)
            self.assertFalse(commands.groups)
            self.assertTrue(commands.events[-1]['exit_confirmed'])
        finally:
            self.assertTrue(commands.close())


if __name__ == '__main__':
    unittest.main()
