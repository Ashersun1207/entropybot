import json
import math
import os
import stat
from junit import junit_counts
from source import digest


def load_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate JSON key')
            result[key] = value
        return result
    if not hasattr(os, 'O_NONBLOCK') or not hasattr(os, 'O_NOFOLLOW'):
        raise ValueError('nonblocking no-follow JSON reads unsupported')
    descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    try:
        opened = os.fstat(descriptor)
        limit = 16 * 1024 * 1024
        if not stat.S_ISREG(opened.st_mode) or opened.st_size > limit:
            raise ValueError('JSON must be a bounded regular file')
        with os.fdopen(descriptor, 'rb', closefd=False) as stream:
            data = stream.read(limit + 1)
        if len(data) > limit:
            raise ValueError('JSON grew beyond local receipt limit')
    finally:
        os.close(descriptor)
    return json.loads(data.decode('utf-8'), object_pairs_hook=pairs, parse_constant=lambda value: (_ for _ in ()).throw(ValueError('nonfinite JSON')))


def load_check(registry, name):
    data = load_json(registry)
    if type(data['schemaVersion']) is not int or data['schemaVersion'] != 1:
        raise ValueError('unknown registry schema')
    check = data['checks'][name]
    if type(check['version']) is not int or check['version'] < 1:
        raise ValueError('invalid check version')
    if not isinstance(check['argv'], list) or not check['argv'] or not all(isinstance(v,str) and v for v in check['argv']):
        raise ValueError('argv must be a nonempty string array')
    if check['adapter'] not in ['counts-json','node-junit','exit']:
        raise ValueError('unsupported report adapter')
    budget = check['timeoutSeconds']
    if type(budget) not in (int,float) or not math.isfinite(budget) or not 0 < budget <= 3600:
        raise ValueError('invalid timeout budget')
    for key in ['allowSkipped','allowTodo']:
        if type(check[key]) is not bool:
            raise ValueError('explicit skip/todo policy required')
    if check['adapter'] != 'exit' and not any('{report}' in value for value in check['argv']):
        raise ValueError('report-producing checks must receive unique report path')
    return check, digest(check)


def resolve_command(root, directory, check):
    cwd = (root / check['cwd']).resolve()
    if cwd != root and root not in cwd.parents:
        raise ValueError('check cwd outside source root')
    argv = [arg.replace('{report}', str(directory/'report.json')) for arg in check['argv']]
    return argv, str(cwd)


def parse_report(directory, check):
    if check['adapter'] == 'exit':
        return {'valid':True,'passed':True,'counts':None}
    path = directory/'report.json'
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16*1024*1024:
        raise ValueError('required fresh report missing or unsupported')
    if check['adapter'] == 'counts-json':
        counts = load_json(path)
        if set(counts) != {'total','passed','failed','skipped','todo'}:
            raise ValueError('report requires exact count fields')
        if any(type(value) is not int or value < 0 for value in counts.values()):
            raise ValueError('report counts must be nonnegative integers')
        if counts['total'] != sum(counts[key] for key in ['passed','failed','skipped','todo']):
            raise ValueError('inconsistent report counts')
    else:
        counts = junit_counts(path)
    passed = counts['total'] > 0 and counts['failed'] == 0
    passed = passed and (check['allowSkipped'] or counts['skipped'] == 0) and (check['allowTodo'] or counts['todo'] == 0)
    return {'valid':True,'passed':bool(passed),'counts':counts}
