import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

CLI = Path(__file__).with_name('cli.py')


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='receipt-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'repo'
        self.root.mkdir()
        self.out = self.base / 'evidence'
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'user.name', 'Fixture')
        (self.root / '.gitignore').write_text('.evidence/\n')
        (self.root / 'source.txt').write_text('original\n')
        (self.root / 'lock.json').write_text('{}\n')
        (self.root / 'config.json').write_text('{}\n')
        (self.root / 'link').symlink_to('source.txt')
        (self.root / 'fixture.py').write_text('''import json, pathlib, sys, time
report=pathlib.Path(sys.argv[1]); mode=sys.argv[2]
if mode == 'change': pathlib.Path('source.txt').write_text('changed')
if mode == 'sleep': time.sleep(30)
if mode == 'fail': sys.exit(3)
if mode == 'missing': sys.exit(0)
if mode == 'corrupt': report.write_text('{'); sys.exit(0)
report.write_text(json.dumps({'total':2,'passed':2 if mode not in ['skip','todo'] else 1,'failed':0,'skipped':int(mode=='skip'),'todo':int(mode=='todo')}))
print('fixture complete')
''')
        self.registry = self.root / 'checks.json'
        self.register()
        self.git('add', '.')
        self.git('commit', '-qm', 'baseline')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], text=True).strip()

    def register(self, mode='ok', timeout=5):
        self.registry.write_text(json.dumps({'schemaVersion':1, 'checks':{'fixture':{
            'version':1, 'argv':[sys.executable,'fixture.py','{report}',mode],
            'cwd':'.', 'timeoutSeconds':timeout, 'adapter':'counts-json',
            'allowSkipped':False, 'allowTodo':False,
        }}}))

    def args(self, verb, receipt=None):
        args = [sys.executable, '-B', str(CLI), verb, '--root', str(self.root), '--registry', str(self.registry)]
        return args + (['--out',str(self.out),'--check','fixture'] if verb=='run' else ['--receipt',str(receipt)])

    def run_check(self, mode='ok', timeout=5):
        self.register(mode, timeout)
        return self.run_registered()

    def run_registered(self):
        result = subprocess.run(self.args('run'), capture_output=True, text=True, timeout=15)
        paths=list(self.out.glob('*/receipt.json'))
        self.assertTrue(paths, result.stderr)
        path=max(paths,key=lambda p:p.stat().st_mtime_ns)
        return result, path, json.loads(path.read_text())

    def verify(self, path, accepted):
        result = subprocess.run(self.args('verify',path),capture_output=True,text=True,timeout=15)
        data=json.loads(result.stdout)
        self.assertEqual(data['accepted'],accepted,result.stdout+result.stderr)
        self.assertEqual(result.returncode==0,accepted)
        return data

    def test_01_stable_success(self):
        result,path,receipt=self.run_check()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(receipt['status'],'passed')
        self.verify(path,True)

    def test_02_same_head_tracked_change(self):
        _,path,_=self.run_check()
        (self.root/'source.txt').write_text('changed')
        self.assertFalse(self.verify(path,False)['sourceMatches'])

    def test_03_existing_untracked_content(self):
        target=self.root/'untracked.txt';target.write_text('before')
        _,path,_=self.run_check()
        target.write_text('after')
        self.verify(path,False)

    def test_04_commit_same_content(self):
        (self.root/'source.txt').write_text('new content')
        _,path,receipt=self.run_check()
        self.git('add','.');self.git('commit','-qm','commit already tested bytes')
        self.assertNotEqual(receipt['sourceAfter']['head'],self.git('rev-parse','HEAD'))
        self.verify(path,True)

    def test_05_lock_and_configuration_change(self):
        for name in ['lock.json','config.json']:
            with self.subTest(name=name):
                _,path,_=self.run_check()
                target=self.root/name;original=target.read_bytes();target.write_text('{"new":true}')
                self.verify(path,False);target.write_bytes(original)

    def test_06_change_during_run(self):
        result,path,receipt=self.run_check('change')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(receipt['status'],'invalidated')
        self.verify(path,False)

    def test_07_nonzero_old_success_report(self):
        _,old,_=self.run_check()
        result,path,receipt=self.run_check('fail')
        self.assertNotEqual(result.returncode,0)
        self.assertNotEqual(path,old)
        self.assertEqual(receipt['status'],'failed')
        self.verify(path,False)

    def test_08_missing_or_corrupt_report(self):
        for mode in ['missing','corrupt']:
            with self.subTest(mode=mode):
                result,path,receipt=self.run_check(mode)
                self.assertNotEqual(result.returncode,0)
                self.assertEqual(receipt['status'],'error')
                self.verify(path,False)

    def test_09_timeout_and_cancel_and_incomplete(self):
        _,path,receipt=self.run_check('sleep',0.15)
        self.assertEqual(receipt['status'],'timed_out');self.verify(path,False)
        self.register('sleep')
        process=subprocess.Popen(self.args('run'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        deadline=time.monotonic()+5
        running=None
        while time.monotonic()<deadline:
            candidates=[p for p in self.out.glob('*/receipt.json') if json.loads(p.read_text()).get('status')=='running']
            if candidates:
                running=candidates[0];break
            time.sleep(0.01)
        self.assertIsNotNone(running)
        self.verify(running,False)
        process.send_signal(signal.SIGTERM);process.communicate(timeout=8)
        self.assertEqual(json.loads(running.read_text())['status'],'cancelled')
        self.verify(running,False)
        running.write_text('{')
        self.verify(running,False)

    def test_10_modified_artifacts(self):
        for filename in ['stdout.log','report.json']:
            with self.subTest(filename=filename):
                _,path,_=self.run_check()
                target=path.parent/filename;target.write_text(target.read_text()+'\nchanged')
                self.assertFalse(self.verify(path,False)['artifactsValid'])

    def test_11_delete_symlink_and_mode(self):
        for kind in ['delete','symlink','mode']:
            with self.subTest(kind=kind):
                _,path,_=self.run_check()
                source=self.root/'source.txt'
                if kind=='delete': source.unlink()
                elif kind=='symlink': (self.root/'link').unlink();(self.root/'link').symlink_to('config.json')
                else: source.chmod(0o755)
                self.verify(path,False)
                if kind=='delete': source.write_text('original\n')
                elif kind=='symlink': (self.root/'link').unlink();(self.root/'link').symlink_to('source.txt')
                else: source.chmod(0o644)

    def test_12_ignored_evidence(self):
        self.out=self.root/'.evidence'
        _,path,_=self.run_check()
        (self.out/'extra.txt').write_text('ignored')
        self.verify(path,True)

    def test_13_strict_skipped_todo(self):
        for mode in ['skip','todo']:
            with self.subTest(mode=mode):
                result,path,receipt=self.run_check(mode)
                self.assertNotEqual(result.returncode,0)
                self.assertEqual(receipt['status'],'failed');self.verify(path,False)

    def test_14_unknown_schema_or_check(self):
        for key,value in [('schemaVersion',999),('checkId','unknown')]:
            _,path,receipt=self.run_check();receipt[key]=value
            path.write_text(json.dumps(receipt));self.verify(path,False)

    def test_15_argv_or_definition_mismatch(self):
        _,path,receipt=self.run_check()
        receipt['argv'].append('changed');path.write_text(json.dumps(receipt));self.verify(path,False)
        _,path,_=self.run_check()
        data=json.loads(self.registry.read_text());data['checks']['fixture']['version']=2
        self.registry.write_text(json.dumps(data));self.verify(path,False)

    def test_16_junit_inconsistent_suite_counts(self):
        for xml in [
            '<testsuites><testsuite tests="2" skipped="1"><testcase name="ok"/></testsuite></testsuites>',
            '<testsuites><testsuite tests="50" failures="0"><testcase name="ok"/></testsuite></testsuites>',
            '<testsuites tests="2"><testcase name="ok"/></testsuites>',
            '<testsuites><testcase name="ok"/><!-- tests 50 --></testsuites>',
        ]:
            with self.subTest(xml=xml):
                self.register()
                (self.root/'fixture.py').write_text('import pathlib, sys\npathlib.Path(sys.argv[1]).write_text('+repr(xml)+')\n')
                data=json.loads(self.registry.read_text());data['checks']['fixture']['adapter']='node-junit'
                self.registry.write_text(json.dumps(data))
                result,path,_=self.run_registered()
                self.assertNotEqual(result.returncode,0)
                self.verify(path,False)

    def test_17_native_node_todo_policy_independent_of_skip(self):
        (self.root/'todo.mjs').write_text("import {test} from 'node:test';test('pending',{todo:true},()=>{});test('ok',()=>{});\n")
        for allow_skip,allow_todo,accepted in [(True,False,False),(False,True,True),(True,True,True)]:
            with self.subTest(skip=allow_skip,todo=allow_todo):
                self.register()
                data=json.loads(self.registry.read_text());check=data['checks']['fixture']
                check.update(argv=['node','--test','--test-reporter=junit','--test-reporter-destination={report}','todo.mjs'],adapter='node-junit',allowSkipped=allow_skip,allowTodo=allow_todo)
                self.registry.write_text(json.dumps(data))
                result,path,receipt=self.run_registered()
                self.assertEqual(result.returncode==0,accepted)
                self.assertEqual(receipt['report']['counts']['todo'],1)
                self.assertEqual(receipt['report']['counts']['skipped'],0)
                self.verify(path,accepted)

    def assert_quick_rejection(self, argv):
        process=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            stdout,stderr=process.communicate(timeout=1.5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate(timeout=3)
            self.assertIsNotNone(process.returncode)
            self.fail('JSON input blocked; probe root killed and reaped before fixture cleanup')
        self.assertNotEqual(process.returncode,0,stdout+stderr)
        self.assertFalse(json.loads(stdout).get('accepted',False))

    def test_18_fifo_receipt_and_registry_rejected_without_writer(self):
        fifo=self.base/'input.fifo';os.mkfifo(fifo)
        with self.subTest(input='receipt'):
            self.assert_quick_rejection(self.args('verify',fifo))
        with self.subTest(input='registry'):
            argv=self.args('run');argv[argv.index('--registry')+1]=str(fifo)
            self.assert_quick_rejection(argv)

    def test_19_nonregular_symlink_bad_and_oversize_json(self):
        targets=[]
        directory=self.base/'json-directory';directory.mkdir();targets.append(directory)
        linked=self.base/'json-link';linked.symlink_to(self.registry);targets.append(linked)
        broken=self.base/'broken.json';broken.write_text('{');targets.append(broken)
        huge=self.base/'huge.json'
        with huge.open('wb') as stream: stream.truncate(16*1024*1024+1)
        targets.append(huge)
        for target in targets:
            with self.subTest(input=target.name):
                argv=self.args('run');argv[argv.index('--registry')+1]=str(target)
                self.assert_quick_rejection(argv)

    def test_20_actual_read_limit_when_metadata_understates_size(self):
        huge=self.base/'growing.json'
        data=self.registry.read_bytes()
        huge.write_bytes(data+b' '*(16*1024*1024+1-len(data)))
        wrapper='''import json, os, pathlib, runpy, sys
argv=json.loads(sys.argv[1]); target=sys.argv[2]; inode=os.stat(target).st_ino
original_stat=os.stat; original_fstat=os.fstat
def small(value):
    fields=list(value);fields[6]=0;return os.stat_result(fields)
def fake_stat(path,*args,**kwargs):
    value=original_stat(path,*args,**kwargs)
    return small(value) if str(path)==target else value
def fake_fstat(fd):
    value=original_fstat(fd)
    return small(value) if value.st_ino==inode else value
os.stat=fake_stat;os.fstat=fake_fstat
sys.path.insert(0,str(pathlib.Path(argv[0]).parent));sys.argv=argv
runpy.run_path(argv[0],run_name='__main__')
'''
        argv=self.args('run')[2:];argv[argv.index('--registry')+1]=str(huge)
        self.assert_quick_rejection([sys.executable,'-B','-c',wrapper,json.dumps(argv),str(huge)])


if __name__=='__main__':
    unittest.main()
