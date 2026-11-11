"""Public preparer contract with synthetic archives; downloaded code is never imported."""
import base64
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

TOOL = Path(__file__).with_name('prepare-toolchain-candidate.py')
spec = importlib.util.spec_from_file_location('preparer', TOOL)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class Preparation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.inputs = self.root/'inputs'
        self.inputs.mkdir(mode=0o700)
        self.output = self.root/'output'
        self.entries = [(p.NODE+'/bin/node', b'synthetic node'), (p.NODE+'/LICENSE', b'license')]
        self.links = list(p.LINKS.items())
        self.name = 'node-runtime-subset'

    def fixture(self, entries=None, links=None, raw=None):
        entries = self.entries if entries is None else entries
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w', format=tarfile.USTAR_FORMAT) as tar:
            for name, data in entries:
                m = tarfile.TarInfo(name)
                m.mode = 0o755
                m.size = len(data)
                tar.addfile(m, io.BytesIO(data))
            for name, target in self.links if links is None else links:
                m = tarfile.TarInfo(name)
                m.type = tarfile.SYMTYPE
                m.linkname = target
                tar.addfile(m)
        archive = gzip.compress(buf.getvalue() if raw is None else raw, mtime=0)
        filename = p.NODE+'.tar.gz' if self.name == 'node-runtime-subset' else 'pnpm-10.33.0.tgz'
        self.archive = self.inputs/filename
        self.archive.write_bytes(archive)
        members = {name: dict(sha256=p.digest(data), bytes=len(data), mode='0o755') for name, data in self.entries}
        item = dict(version='24.22.2', platform='darwin', arch='arm64',
                    archiveSha256=p.digest(archive), archiveBytes=len(archive), selectedMembers=members,
                    checksumRows=[dict(file=filename, sha256=p.digest(archive))])
        self.catalog = dict(approval=False, sourceBaseline='a'*40, node=item)
        if self.name == 'pnpm-complete-runtime':
            item.update(name='pnpm', version='10.33.0', lockSRI=None, members=members,
                        metadataSRI='sha512-'+base64.b64encode(hashlib.sha512(archive).digest()).decode())
            self.catalog['packages'] = [item]
        return archive

    def run_prepare(self, **kwargs):
        return p.prepare(self.inputs, self.output, self.name, p.encoded(self.catalog), **kwargs)

    def reject(self, reason, **kwargs):
        with self.assertRaisesRegex((ValueError, tarfile.HeaderError, EOFError, OSError), reason):
            self.run_prepare(**kwargs)
        self.assertFalse(self.output.exists())

    def test_ready_complete_inventory_no_execute(self):
        self.fixture(entries=self.entries+[(p.NODE+'/lib/omitted.js', b'omitted')])
        report = self.run_prepare()
        self.assertEqual(report['state'], 'data-ready')
        self.assertEqual(report['kind'], 'toolchain-preparation-candidate')
        self.assertFalse(report['approval'])
        self.assertFalse(report['qualification']['complete'])
        self.assertEqual(report['execution'], 'not-attempted')
        self.assertEqual(len(report['inventory']['entries']), 6)
        self.assertEqual(len(report['writes']), 2)
        self.assertEqual(len([r for r in report['omissions'] if r['type'] == 'symlink']), 3)
        self.assertEqual(report['outputInventorySha256'], p.digest(p.encoded(report['writes'])))
        for path in self.output.rglob('*'):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700 if path.is_dir() else 0o600)
        for row in report['writes']:
            self.assertEqual(p.digest((self.output/row['path']).read_bytes()), row['sha256'])
        self.assertFalse((self.output/'data'/p.NODE/'bin/npm').exists())

    def test_compressed_hash_before_write(self):
        self.fixture()
        self.catalog['node']['archiveSha256'] = '0'*64
        self.catalog['node']['checksumRows'][0]['sha256'] = '0'*64
        self.reject('compressed hash')

    def test_selected_hash_before_write(self):
        self.fixture()
        self.catalog['node']['selectedMembers'][p.NODE+'/bin/node']['sha256'] = '0'*64
        self.reject('selected member mismatch')

    def test_selected_directory_rejected(self):
        self.fixture(entries=[self.entries[1]], links=self.links+[(p.NODE+'/bin/node', 'other')])
        self.reject('must be regular')

    def test_missing_selected(self):
        self.fixture(entries=self.entries[:1])
        self.reject('missing selected')

    def test_paths(self):
        for suffix in ['../escape', '/absolute', '.', '', 'a//b', 'a/./b', 'a\\b']:
            with self.subTest(suffix=suffix):
                name = '/absolute' if suffix == '/absolute' else p.NODE+'/'+suffix
                self.fixture(entries=self.entries+[(name, b'x')])
                self.reject('unsafe member path')

    def test_duplicate(self):
        self.fixture(entries=self.entries+self.entries[:1])
        self.reject('duplicate')

    def test_unknown_link_and_target(self):
        for links in [self.links+[(p.NODE+'/bin/unknown', 'elsewhere')],
                      [(self.links[0][0], 'forged')]+self.links[1:]]:
            with self.subTest(links=links):
                self.fixture(links=links)
                self.reject('unknown link')

    def test_missing_known_link(self):
        self.fixture(links=self.links[:2])
        self.reject('missing known')

    def test_specials_and_extended_headers(self):
        for kind in [tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE,
                     tarfile.XHDTYPE, tarfile.GNUTYPE_LONGNAME]:
            with self.subTest(kind=kind):
                m = tarfile.TarInfo(p.NODE+'/bad')
                m.type = kind
                self.fixture(raw=m.tobuf()+bytes(1024))
                self.reject('special/extended')

    def test_malformed_and_trailing(self):
        for raw in [b'bad', b'x'*512, bytes(512)+b'x'*512, bytes(1024)+b'hidden']:
            with self.subTest(size=len(raw)):
                self.fixture(raw=raw)
                self.reject('truncated|checksum|header|terminator|trailing')

    def test_gzip_crc_and_truncation(self):
        archive = self.fixture()
        for data in [archive[:-8], archive[:-8]+b'badCRC!!']:
            with self.subTest(size=len(data)):
                self.archive.write_bytes(data)
                item = self.catalog['node']
                item.update(archiveBytes=len(data), archiveSha256=p.digest(data))
                item['checksumRows'][0]['sha256'] = p.digest(data)
                self.reject('end-of-stream|CRC|length')

    def test_all_caps_include_skipped_members(self):
        self.fixture(entries=self.entries+[(p.NODE+'/unselected', b'x'*2048)])
        for limits, reason in [({'expanded': 1024}, 'expanded cap'), ({'entries': 1}, 'entry cap'),
                               ({'member': 1024}, 'member cap'), ({'aggregate': 1024}, 'aggregate cap'),
                               ({'compressed': 1}, 'oversized')]:
            with self.subTest(limits=limits):
                self.reject(reason, limits=limits)

    def test_existing_output_and_symlink(self):
        self.fixture()
        self.output.mkdir()
        (self.output/'keep').write_bytes(b'unknown')
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self.run_prepare()
        self.assertEqual((self.output/'keep').read_bytes(), b'unknown')
        self.output = self.root/'linked'
        self.output.symlink_to(self.inputs)
        with self.assertRaisesRegex(ValueError, 'already exists'):
            self.run_prepare()

    def test_symlink_parent(self):
        self.fixture()
        link = self.root/'linked'
        link.symlink_to(self.inputs)
        self.output = link/'new'
        self.reject('noncanonical')

    def test_nonregular_input_no_stall_public_subprocess(self):
        self.fixture()
        self.archive.unlink()
        os.mkfifo(self.archive)
        code = ('import runpy,sys; p=runpy.run_path(sys.argv[1]); '
                'p["prepare"](sys.argv[2],sys.argv[3],"node-runtime-subset")')
        result = subprocess.run([sys.executable, '-B', '-c', code, str(TOOL), str(self.inputs),
                                 str(self.output)], capture_output=True, timeout=3)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'nonregular', result.stderr)
        self.assertFalse(self.output.exists())

    def test_input_symlink_and_hardlink(self):
        data = self.fixture()
        other = self.inputs/'other'
        self.archive.rename(other)
        self.archive.symlink_to(other)
        with self.assertRaises(OSError):
            self.run_prepare()
        self.archive.unlink()
        os.link(other, self.archive)
        self.reject('nonregular')
        self.assertEqual(other.read_bytes(), data)

    def pnpm(self):
        self.name = 'pnpm-complete-runtime'
        self.entries = [('package/'+name, name.encode()) for name in
                        ['package.json', 'bin/pnpm.cjs', 'bin/pnpx.cjs', 'dist/pnpm.cjs', 'dist/pnpmrc']]
        self.links = []

    def test_pnpm_full_runtime_and_inventory(self):
        self.pnpm()
        self.fixture(entries=self.entries+[('package/dist/node_modules/runtime.js', b'required runtime')])
        report = self.run_prepare()
        self.assertEqual(len(report['writes']), 6)
        self.assertEqual(report['omissions'], [])
        self.assertEqual(len(report['inventory']['entries']), 6)
        self.assertEqual(report['archive']['expected']['sri'], report['archive']['observed']['sri'])

    def test_pnpm_sri_before_write(self):
        self.pnpm()
        self.fixture()
        self.catalog['packages'][0]['metadataSRI'] = 'sha512-bad'
        self.reject('SRI mismatch')

    def test_pnpm_missing_runtime(self):
        self.pnpm()
        self.fixture(entries=self.entries[:-2])
        self.reject('missing selected runtime')

    def test_pnpm_entry_and_dist_tamper(self):
        self.pnpm()
        for name in ['package/bin/pnpm.cjs', 'package/dist/pnpm.cjs']:
            with self.subTest(name=name):
                self.fixture(entries=[(n, b'tampered' if n == name else b) for n, b in self.entries])
                self.reject('selected member mismatch')

    def test_pnpm_unlisted_native(self):
        self.pnpm()
        self.fixture(entries=self.entries+[('package/dist/vendor/new.exe', b'new')])
        self.reject('unlisted native')

    def test_partial_failure_is_retained(self):
        self.fixture()
        original = p.write_data
        def fail(root, path):
            if path.endswith('/bin/node'):
                raise OSError('synthetic disk full')
            return original(root, path)
        with patch.object(p, 'write_data', fail):
            with self.assertRaisesRegex(OSError, 'disk full'):
                self.run_prepare()
        report = json.loads((self.output/'failure.json').read_bytes())
        self.assertEqual(report['state'], 'blocked')
        self.assertFalse((self.output/'data').exists())
        self.assertTrue((self.output/'data.partial').exists())
        self.assertFalse(report['qualification']['complete'])

    def test_cli_fixed_catalog_rejects_synthetic_archive(self):
        self.fixture()
        result = subprocess.run([sys.executable, '-B', str(TOOL), '--input-root', str(self.inputs),
                                 '--output-root', str(self.output), '--profile', self.name],
                                capture_output=True, timeout=3)
        self.assertEqual(result.returncode, 1)
        self.assertIn(b'compressed hash/size mismatch', result.stderr)
        self.assertFalse(self.output.exists())

    def test_positive_report_cannot_qualify_install_or_bootstrap(self):
        self.fixture()
        report = self.run_prepare()
        script = '''
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requireInstallation,validateBootstrapPolicy} from './scripts/full-gate/install-policy.ts';
import {stageReviewedBootstrap} from './scripts/full-gate/bootstrap-stage.ts';
const report=JSON.parse(readFileSync(0,'utf8'));
const binding={sourceSha:'a'.repeat(40),runId:'9',attempt:'1',job:'main-vitest-01',platform:'darwin',arch:'arm64'};
for (const complete of [false,true]) {
 const candidate={...report,qualification:{complete}};
 assert.throws(()=>requireInstallation(candidate,binding,candidate),/legacy or missing/);
 assert.throws(()=>validateBootstrapPolicy(candidate,binding),/unsupported bootstrap staging profile/);
 await assert.rejects(stageReviewedBootstrap({ownedRoot:'/missing',launcher:'/missing',binding,
  review:{classification:'reviewed-owned-fixture-staging',policy:candidate}}),/unsupported bootstrap staging profile|unsupported host/);
}
console.log('six consumer rejections; no candidate execution');
'''
        result = subprocess.run(['node', '--input-type=module', '-e', script],
                                cwd=TOOL.parents[2], input=p.encoded(report),
                                capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertIn(b'six consumer rejections', result.stdout)

    def test_unknown_profile_rejected(self):
        self.fixture()
        with self.assertRaisesRegex(ValueError, 'unsupported selection profile'):
            p.prepare(self.inputs, self.output, '../../command', p.encoded(self.catalog))


if __name__ == '__main__':
    unittest.main(verbosity=2)
