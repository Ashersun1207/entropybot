import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import tempfile


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        before = os.fstat(stream.fileno())
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
        after = os.fstat(stream.fileno())
    if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
        raise ValueError('file changed while hashing')
    return h.hexdigest()


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.PIPE, timeout=20)


def relative(value):
    path = PurePosixPath(value)
    if not value or path.is_absolute() or '..' in path.parts or str(path) != value:
        raise ValueError('noncanonical relative path')
    return path


def identity(path):
    value = path.lstat()
    mode = bool(value.st_mode & 0o111)
    if stat.S_ISLNK(value.st_mode):
        target = os.readlink(path)
        return {'type':'symlink', 'executable':mode, 'target':target, 'sha256':hashlib.sha256(os.fsencode(target)).hexdigest()}
    if stat.S_ISREG(value.st_mode):
        return {'type':'file', 'executable':mode, 'size':value.st_size, 'sha256':file_hash(path)}
    raise ValueError('unsupported source/artifact type')


def snapshot(root):
    if Path(os.fsdecode(git(root, 'rev-parse', '--show-toplevel')).strip()).resolve() != root:
        raise ValueError('root must be Git checkout root')
    if git(root, 'ls-files', '--unmerged', '-z'):
        raise ValueError('unresolved index entries')
    names = set(os.fsdecode(git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z')).split('\0')) - {''}
    entries = []
    for name in sorted(names):
        relative(name)
        path = root / name
        blocked = next((str(parent.relative_to(root)) for parent in path.parents if parent != root and root in parent.parents and parent.is_symlink()), None)
        if blocked:
            item = {'type':'blocked', 'ancestor':blocked}
        elif not path.is_symlink() and not path.exists():
            item = {'type':'deleted'}
        else:
            item = identity(path)
        entries.append({'path':name, **item})
    return {
        'digest':digest(entries), 'entries':entries,
        'head':os.fsdecode(git(root, 'rev-parse', 'HEAD')).strip(),
        'tree':os.fsdecode(git(root, 'rev-parse', 'HEAD^{tree}')).strip(),
        'dirty':bool(git(root, 'status', '--porcelain=v1', '-z')),
    }


def evidence_directory(root, path):
    path = path.resolve()
    if path == root:
        raise ValueError('evidence must not be checkout root')
    if root in path.parents:
        name = str(path.relative_to(root))
        if git(root, 'ls-files', '--cached', '-z', '--', name):
            raise ValueError('evidence path contains tracked source')
        result = subprocess.run(['git','-C',str(root),'check-ignore','-q','--',name+'/receipt-probe'], timeout=10)
        if result.returncode != 0:
            raise ValueError('in-repo evidence must be gitignored')
    return path


def atomic_json(path, value):
    data = canonical(value) + b'\n'
    descriptor, name = tempfile.mkstemp(prefix='.receipt-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def artifact(directory, name):
    relative(name)
    path = directory / name
    if path.is_symlink() or path.resolve().parent != directory.resolve():
        raise ValueError('artifact must be a direct regular run file')
    value = identity(path)
    if value['type'] != 'file':
        raise ValueError('artifact must be regular file')
    return {'path':name, **value}


def tool_identity():
    directory = Path(__file__).parent
    files = [*directory.glob('*.py'), directory/'bridge.ts', directory.parent/'patch-gate-process.ts']
    return {str(path.relative_to(directory.parent)):file_hash(path) for path in sorted(files)}
