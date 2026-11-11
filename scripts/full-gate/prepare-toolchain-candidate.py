"""Offline data preparation only. Catalog expectations are not production approvals."""
import argparse
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tarfile

CATALOG = Path(__file__).with_name('toolchain-candidates.json')
LIMITS = dict(compressed=90*1024*1024, expanded=450*1024*1024,
              member=150*1024*1024, aggregate=450*1024*1024, entries=12000)
NODE = 'node-v24.22.2-darwin-arm64'
LINKS = {NODE+'/bin/'+name: target for name, target in {
    'npm': '../lib/node_modules/npm/bin/npm-cli.js',
    'npx': '../lib/node_modules/npm/bin/npx-cli.js',
    'corepack': '../lib/node_modules/corepack/dist/corepack.js'}.items()}


def require(value, reason):
    if not value:
        raise ValueError(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'))+'\n').encode()


def directory(path, owned=False):
    path = Path(path)
    require(path.is_absolute() and str(path) == os.path.realpath(path), 'noncanonical path')
    current = Path('/')
    for part in path.parts[1:]:
        current /= part
        st = current.lstat()
        require(stat.S_ISDIR(st.st_mode), 'symlink/non-directory component')
    st = path.stat()
    if owned:
        require(st.st_uid == os.geteuid() and not st.st_mode & 0o022, 'foreign/writable root')
    return path


def regular(path, cap):
    path = Path(path)
    directory(path.parent)
    require(hasattr(os, 'O_NONBLOCK') and hasattr(os, 'O_NOFOLLOW'), 'safe open unavailable')
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    try:
        st = os.fstat(fd)
        require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and
                st.st_uid == os.geteuid() and not st.st_mode & 0o022 and
                0 < st.st_size <= cap, 'nonregular/foreign/oversized input')
        return os.fdopen(fd, 'rb')
    except BaseException:
        os.close(fd)
        raise


def hash_archive(source, cap):
    source.seek(0)
    h256, h512, count = hashlib.sha256(), hashlib.sha512(), 0
    while True:
        chunk = source.read(65536)
        if not chunk:
            break
        count += len(chunk)
        require(count <= cap, 'compressed cap')
        h256.update(chunk)
        h512.update(chunk)
    return dict(bytes=count, sha256=h256.hexdigest(),
                sri='sha512-'+base64.b64encode(h512.digest()).decode())


def profile(catalog, name):
    require(catalog['approval'] is False, 'catalog must remain unapproved')
    if name == 'node-runtime-subset':
        item = catalog['node']
        require((item['version'], item['platform'], item['arch']) ==
                ('24.22.2', 'darwin', 'arm64'), 'unsupported Node')
        selected = {p: item['selectedMembers'][p] for p in (NODE+'/bin/node', NODE+'/LICENSE')}
        checksum = next(r['sha256'] for r in item['checksumRows']
                        if r['file'] == NODE+'.tar.gz')
        require(checksum == item['archiveSha256'], 'checksum expectation mismatch')
        return item, NODE, selected, LINKS, NODE+'.tar.gz'
    require(name == 'pnpm-complete-runtime', 'unsupported selection profile')
    item = next(p for p in catalog['packages'] if p['name'] == 'pnpm')
    require(item['version'] == '10.33.0' and item['lockSRI'] is None, 'unsupported pnpm')
    selected = item['members']
    require(all(p in selected for p in ['package/package.json', 'package/bin/pnpm.cjs',
                'package/bin/pnpx.cjs', 'package/dist/pnpm.cjs', 'package/dist/pnpmrc']),
            'missing runtime expectations')
    return item, 'package', selected, {}, 'pnpm-10.33.0.tgz'


def member_path(name, prefix, is_dir):
    # Tar directory headers commonly end in one slash; aliases remain forbidden.
    if is_dir and name.endswith('/'):
        name = name[:-1]
    require(name and len(name) <= 512 and not name.startswith('/') and '\\' not in name
            and all(p not in ('', '.', '..') for p in name.split('/'))
            and (name == prefix or name.startswith(prefix+'/')), 'unsafe member path')
    return name


def scan(source, prefix, selected, links, limits, emit=None):
    source.seek(0)
    rows, names, seen_links, total, expanded = [], {}, set(), 0, 0
    with gzip.GzipFile(fileobj=source, mode='rb') as gz:
        def read(n):
            nonlocal expanded
            data = gz.read(n)
            expanded += len(data)
            require(expanded <= limits['expanded'], 'expanded cap')
            require(len(data) == n, 'truncated tar')
            return data
        while True:
            block = read(512)
            if block == bytes(512):
                require(read(512) == bytes(512), 'missing tar terminator')
                while True:
                    tail = gz.read(65536)
                    expanded += len(tail)
                    require(expanded <= limits['expanded'], 'expanded cap')
                    require(not any(tail), 'nonzero trailing tar data')
                    if not tail:
                        break
                break
            require(len(rows) < limits['entries'], 'entry cap')
            m = tarfile.TarInfo.frombuf(block, 'utf-8', 'strict')
            require(m.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE, tarfile.SYMTYPE),
                    'link/special/extended header rejected')
            name = member_path(m.name, prefix, m.isdir())
            require(name not in selected or m.isfile(), 'selected member must be regular')
            if prefix == 'package' and ('/vendor/' in name or name.endswith(('.node', '.exe', '.dll', '.so', '.dylib'))):
                require(name in selected or name in {
                    'package/dist/reflink.darwin-arm64-2HJ4WGO6.node',
                    'package/dist/reflink.darwin-x64-3G3H6IW4.node',
                    'package/dist/reflink.win32-arm64-msvc-Q6BARPPB.node',
                    'package/dist/reflink.win32-x64-msvc-J2TZHRQI.node'}, 'unlisted native/vendor member')
            require(name not in names, 'duplicate member')
            # File/directory prefix collisions also reject before any output writes.
            require(not any(names.get('/'.join(name.split('/')[:i]), 'directory') != 'directory'
                            for i in range(1, len(name.split('/')))), 'member parent is not directory')
            require(m.isdir() or not any(p.startswith(name+'/') for p in names), 'member shadows parent')
            names[name] = 'directory' if m.isdir() else 'other'
            require(0 <= m.size <= limits['member'], 'member cap')
            total += m.size
            require(total <= limits['aggregate'], 'aggregate cap')
            row = dict(path=name, bytes=m.size, archiveMode=format(m.mode, '04o'))
            if m.issym():
                require(m.size == 0 and links.get(name) == m.linkname, 'unknown link/target')
                seen_links.add(name)
                row.update(type='symlink', target=m.linkname, disposition='omitted-known-link-not-followed')
            elif m.isdir():
                require(m.size == 0, 'directory payload')
                row.update(type='directory', disposition='inventory-only')
            else:
                copy = prefix == 'package' or name in selected
                row.update(type='regular', disposition='selected' if copy else 'omitted-not-selected')
                h = hashlib.sha256()
                remaining = m.size
                sink = emit(name) if emit and copy else None
                try:
                    while remaining:
                        chunk = read(min(65536, remaining))
                        remaining -= len(chunk)
                        h.update(chunk)
                        if sink:
                            sink.write(chunk)
                finally:
                    if sink:
                        sink.close()
                row['sha256'] = h.hexdigest()
                if name in selected:
                    expected = selected[name]
                    require(row['sha256'] == expected['sha256'] and m.size == expected['bytes'],
                            'selected member mismatch')
                require(not any(read((-m.size) % 512)), 'nonzero member padding')
            rows.append(row)
    require(set(selected) <= names.keys(), 'missing selected runtime member')
    require(seen_links == set(links), 'missing known Node link inventory')
    return dict(entries=rows, expandedBytes=expanded, regularBytes=total,
                sha256=digest(encoded(rows)))


def write_data(root, relative):
    parts = relative.split('/')
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            try:
                os.mkdir(part, 0o700, dir_fd=fd)
            except FileExistsError:
                pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
            st = os.fstat(fd)
            require(st.st_uid == os.geteuid() and stat.S_IMODE(st.st_mode) == 0o700,
                    'output component ownership/mode')
        out = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                      0o600, dir_fd=fd)
        return os.fdopen(out, 'wb')
    finally:
        os.close(fd)


def prepare(input_root, output_root, name, catalog_bytes=None, limits=None):
    """Prepare data under a fresh root; injected expectations are synthetic, never authority."""
    if catalog_bytes is None:
        with regular(CATALOG, 2*1024*1024) as f:
            catalog_bytes = f.read(2*1024*1024+1)
    require(len(catalog_bytes) <= 2*1024*1024, 'catalog cap')
    catalog = json.loads(catalog_bytes)
    item, prefix, selected, links, filename = profile(catalog, name)
    bounds = dict(LIMITS)
    if limits:
        require(all(k in bounds and 0 < v <= bounds[k] for k, v in limits.items()), 'invalid limits')
        bounds.update(limits)
    inputs = directory(input_root, owned=True)
    output = Path(output_root)
    directory(output.parent, owned=True)
    require(output.name not in ('', '.', '..') and output.is_absolute() and
            str(output) == str(output.parent/output.name), 'invalid output root')
    require(not os.path.lexists(output), 'output root already exists')
    with regular(Path(__file__).absolute(), 64*1024) as tool:
        tool_hash = digest(tool.read(64*1024+1))
    report = dict(schemaVersion=1, kind='toolchain-preparation-candidate', approval=False,
                  execution='not-attempted', installation='not-attempted', profile=name,
                  qualification=dict(complete=False, blockers=[
                      'Node signature trust unresolved; catalog is unapproved and outside trust closure',
                      'No runtime/bootstrap/install/lifecycle/native qualification; no concurrent writers assumed']),
                  sourceBaseline=catalog['sourceBaseline'], catalogSha256=digest(catalog_bytes),
                  implementationBaseline='d5ddb3bba024df2a8848b14750aa75497227d9b5',
                  preparerSha256=tool_hash, limits=bounds,
                  archive=dict(path=str(inputs/filename), expected=dict(bytes=item['archiveBytes'],
                               sha256=item['archiveSha256'], sri=item.get('metadataSRI'))),
                  selector=dict(prefix=prefix, requiredMembers=selected, allowedOmittedLinks=links,
                                regularSelection='all' if prefix == 'package' else sorted(selected)),
                  modePolicy=dict(files='0600', directories='0700', archiveModesPreserved=False),
                  state='blocked')
    created = False
    try:
        with regular(inputs/filename, bounds['compressed']) as source:
            actual = hash_archive(source, bounds['compressed'])
            report['archive']['observed'] = actual
            require(actual['sha256'] == item['archiveSha256'] and actual['bytes'] == item['archiveBytes'],
                    'compressed hash/size mismatch')
            if prefix == 'package':
                require(actual['sri'] == item['metadataSRI'], 'metadata SRI mismatch')
            inventory = scan(source, prefix, selected, links, bounds)
            report['inventory'] = inventory
            os.mkdir(output, 0o700)
            created = True
            stage = output/'data.partial'
            os.mkdir(stage, 0o700)
            copied = scan(source, prefix, selected, links, bounds,
                          lambda path: write_data(stage, path))
            require(copied == inventory and hash_archive(source, bounds['compressed']) == actual,
                    'source changed during preparation')
            report['inventoryComparison'] = dict(
                expectation='first complete scan of checksum-bound unapproved archive; not an independent trust root',
                expectedSha256=inventory['sha256'], observedSha256=copied['sha256'],
                expectedEntries=len(inventory['entries']), observedEntries=len(copied['entries']))
            os.rename(stage, output/'data')
            writes = [dict(path='data/'+r['path'], bytes=r['bytes'], mode='0600', sha256=r['sha256'])
                      for r in inventory['entries'] if r['disposition'] == 'selected']
            report.update(state='data-ready', writes=sorted(writes, key=lambda r: r['path']))
            report['outputInventorySha256'] = digest(encoded(report['writes']))
            report['omissions'] = [r for r in inventory['entries'] if r['disposition'] != 'selected']
    except Exception as exc:
        report['failure'] = type(exc).__name__+': '+str(exc)[:512]
        if created:
            with write_data(output, 'failure.json') as f:
                f.write(encoded(report))
        raise
    with write_data(output, 'manifest.json') as f:
        f.write(encoded(report))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-root', required=True)
    parser.add_argument('--output-root', required=True)
    parser.add_argument('--profile', required=True, choices=['node-runtime-subset', 'pnpm-complete-runtime'])
    args = parser.parse_args()
    try:
        report = prepare(args.input_root, args.output_root, args.profile)
        print(json.dumps(dict(state=report['state'], outputInventorySha256=report['outputInventorySha256'])))
    except Exception as exc:
        print(json.dumps(dict(state='blocked', failure=type(exc).__name__+': '+str(exc)[:512])), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
