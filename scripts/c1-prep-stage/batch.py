import os, sys, subprocess, json, hashlib, datetime, time, pathlib
ROOT = str(pathlib.Path(__file__).resolve().parents[2])
OUT = sys.argv[1]
NODE = '/Users/sun/.nvm/versions/node/v24.22.2/bin/node'
ARGV = [NODE, '--experimental-strip-types', ROOT + '/scripts/c1-prep-stage/runner.mjs']
ENV = {'PATH': str(pathlib.Path(NODE).parent) + ':/usr/bin:/bin:/usr/sbin:/sbin', 'TMPDIR': '/private/tmp', 'HOME': OUT + '/runner-home', 'OMB_VERIFICATION_EVIDENCE_DIR': OUT, 'LANG': 'en_US.UTF-8'}
pathlib.Path(OUT).mkdir(parents=True, exist_ok=False)
pathlib.Path(ENV['HOME']).mkdir(mode=0o700)
def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def git(*a): return subprocess.check_output(['git', *a], cwd=ROOT, text=True).strip()
def machine():
    def cmd(*a): return subprocess.check_output(a, text=True).strip()
    return {'utc': utc(), 'macOS': cmd('/usr/bin/sw_vers'), 'cpu': cmd('/usr/sbin/sysctl', '-n', 'machdep.cpu.brand_string'), 'ramBytes': cmd('/usr/sbin/sysctl', '-n', 'hw.memsize'), 'cpuCount': cmd('/usr/sbin/sysctl', '-n', 'hw.ncpu'), 'node': cmd(NODE, '--version'), 'loadavg': os.getloadavg()}
def hashes():
    paths = [ROOT + '/' + p for p in subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0') if p]
    paths += [str(p) for p in pathlib.Path(__file__).parent.glob('*') if p.is_file()] + [NODE]
    visited = set()
    for base, dirs, files in os.walk(ROOT + '/node_modules', followlinks=True):
        real = os.path.realpath(base)
        if real in visited: dirs[:] = []; continue
        visited.add(real)
        dirs[:] = [d for d in dirs if d != '.git']
        paths.extend(os.path.join(base, f) for f in files)
    result = {}
    for p in paths:
        if os.path.isfile(p):
            h = hashlib.sha256()
            with open(p, 'rb') as f:
                for b in iter(lambda: f.read(1024 * 1024), b''): h.update(b)
            result[p] = h.hexdigest()
    return result
start = utc(); t = time.monotonic()
def manifest(phase, code=None):
    m = {'phase': phase, 'capturedUTC': utc(), 'batchStartUTC': start, 'batchEndUTC': utc() if phase == 'after' else None, 'head': git('rev-parse', 'HEAD'), 'tree': git('rev-parse', 'HEAD^{tree}'), 'statusPorcelain': git('status', '--porcelain=v1', '--untracked-files=all'), 'argv': ARGV, 'envAllowlist': ENV, 'cwd': ROOT, 'logPath': OUT + '/batch.log', 'exitCode': code, 'machine': machine(), 'dependencyRoot': os.path.realpath(ROOT + '/node_modules'), 'sourceSHA256': hashes()}
    pathlib.Path(OUT + '/batch-' + phase + '.json').write_text(json.dumps(m, indent=2))
manifest('before')
code = 1
try:
    with open(OUT + '/batch.log', 'w') as log:
        code = subprocess.run(ARGV, cwd=ROOT, env=ENV, stdout=log, stderr=subprocess.STDOUT, timeout=180).returncode
finally:
    manifest('after', code)
    pathlib.Path(OUT + '/batch-timing.json').write_text(json.dumps({'startUTC': start, 'endUTC': utc(), 'wallSeconds': time.monotonic() - t, 'exitCode': code}, indent=2))
sys.exit(code)
