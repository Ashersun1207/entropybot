import datetime
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time
import uuid

from reports import load_check, load_json, parse_report, resolve_command
from source import artifact, atomic_json, evidence_directory, identity, snapshot, tool_identity

LIMITATIONS = [
    'Local JSON and hashes are not authenticated release provenance or the F2 trusted producer.',
    'Before/after snapshots cannot detect edits restored before the second snapshot; use an exclusive worktree.',
    'Only tracked and nonignored untracked source is bound; ignored dependencies/user data are excluded.',
    'Owned POSIX process group is checked by GateCommandRunner; detached internal resources and Windows are not proven.',
    'Synthetic HOME and an environment whitelist are not an OS network or filesystem sandbox.',
]


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def runtime():
    node = shutil.which('node')
    if not node:
        raise ValueError('node with native TypeScript support required')
    node = Path(node).resolve()
    return {'path':str(node),'identity':identity(node)}


def run(root, registry, name, out):
    check, definition = load_check(registry, name)
    out = evidence_directory(root, out)
    out.mkdir(parents=True, exist_ok=True)
    directory = out / (datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex)
    directory.mkdir(mode=0o700)
    argv, cwd = resolve_command(root, directory, check)
    node = runtime()
    before = snapshot(root)
    home = directory/'home'; home.mkdir()
    env = {'PATH':os.environ.get('PATH',os.defpath),'LANG':'en_US.UTF-8','HOME':str(home),
           'USERPROFILE':str(home),'TMPDIR':str(home), 'OMB_EVAL_LIVE':'0', 'PYTHONDONTWRITEBYTECODE':'1'}
    receipt = {'schemaVersion':1,'runId':directory.name,'checkId':name,'checkVersion':check['version'],
               'definitionHash':definition,'argv':argv,'cwd':cwd,'root':str(root), 'runtime':node,
               'toolIdentity':tool_identity(),'environment':env,'sourceBefore':before,'status':'running',
               'startedAt':utc(),'limitations':LIMITATIONS}
    path = directory/'receipt.json'
    cancelled = [None]
    process = None
    old_handlers = {}
    def cancel(signum, frame):
        cancelled[0] = signum
        if process is not None and process.poll() is None:
            try:
                process.send_signal(signum)
            except ProcessLookupError:
                pass
    for signum in [signal.SIGTERM,signal.SIGINT]:
        old_handlers[signum] = signal.signal(signum,cancel)
    started = time.monotonic()
    atomic_json(path, receipt)
    request = {'argv':argv,'cwd':cwd,'env':env,'timeoutMs':max(1,int(check['timeoutSeconds']*1000)),
               'result':str(directory/'execution.json')}
    try:
        with (directory/'stdout.log').open('wb') as stdout, (directory/'stderr.log').open('wb') as stderr:
            if not cancelled[0]:
                process = subprocess.Popen([node['path'],'--experimental-strip-types',str(Path(__file__).with_name('bridge.ts'))],
                                           stdin=subprocess.PIPE,stdout=stdout,stderr=stderr,env=env)
                process.communicate(json.dumps(request).encode())
        state = load_json(directory/'execution.json')
        receipt['execution'] = state
        receipt['status'] = 'cancelled' if cancelled[0] else state['status']
        if not state['ownedGroupStopped']:
            receipt['status'] = 'error'
        try:
            receipt['report'] = parse_report(directory, check)
        except (ValueError, OSError, KeyError) as error:
            receipt['report'] = {'valid':False,'passed':False,'counts':None,'errorType':type(error).__name__}
            if receipt['status']=='passed':
                receipt['status']='error'
        if receipt['status']=='passed' and not receipt['report']['passed']:
            receipt['status']='failed'
    except Exception as error:
        receipt['status'] = 'cancelled' if cancelled[0] else 'error'
        receipt['errorType'] = type(error).__name__
    finally:
        try:
            receipt['sourceAfter'] = snapshot(root)
            if receipt['sourceAfter']['digest'] != before['digest']:
                receipt['status']='invalidated'
            receipt['artifacts'] = [artifact(directory,name) for name in ['stdout.log','stderr.log','execution.json','report.json'] if (directory/name).exists() or (directory/name).is_symlink()]
        except Exception as error:
            receipt['status']='error';receipt['errorType']=type(error).__name__
        receipt['finishedAt']=utc();receipt['durationSeconds']=time.monotonic()-started
        if cancelled[0] and receipt['status']=='passed':
            receipt['status']='cancelled'
        atomic_json(path, receipt)
        for signum, handler in old_handlers.items():
            signal.signal(signum, handler)
    return {'status':receipt['status'],'receipt':str(path)}, receipt['status']=='passed'
