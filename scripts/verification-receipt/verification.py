from reports import load_check, load_json, parse_report, resolve_command
from source import artifact, digest, snapshot, tool_identity
from execution import LIMITATIONS, runtime


def verify(root, registry, path):
    result = {'executionValid':False,'sourceMatches':False,'artifactsValid':False,
              'limitations':LIMITATIONS,'accepted':False,'errors':[]}
    try:
        if path.is_symlink():
            raise ValueError('receipt cannot be a symlink')
        path = path.resolve(strict=True)
        data = load_json(path)
        if type(data['schemaVersion']) is not int or data['schemaVersion'] != 1:
            raise ValueError('unknown receipt schema')
        check, definition = load_check(registry, data['checkId'])
        argv, cwd = resolve_command(root,path.parent,check)
        binding = (data['checkVersion']==check['version'] and data['definitionHash']==definition
                   and data['argv']==argv and data['cwd']==cwd and data['root']==str(root)
                   and data['runId']==path.parent.name and data['toolIdentity']==tool_identity()
                   and data['runtime']==runtime())
        state = data.get('execution',{})
        report = parse_report(path.parent,check)
        timing = isinstance(data.get('finishedAt'),str) and type(data.get('durationSeconds')) in (int,float) and data['durationSeconds']>=0
        evidence = state.get('evidence',{})
        closed = all(type(evidence.get(key)) in (int,float) for key in ['exitAt','closeAt','groupGoneAt'])
        result['executionValid'] = bool(binding and timing and closed and data['status']=='passed'
            and state.get('status')=='passed' and state.get('exitCode')==0 and state.get('signal') is None
            and state.get('ownedGroupStopped') is True and data['report']==report and report['passed'])
        before, after = data['sourceBefore'], data['sourceAfter']
        current = snapshot(root)
        result['sourceMatches'] = (digest(before['entries'])==before['digest']==after['digest']==digest(after['entries'])==current['digest'])
        artifacts = data['artifacts']
        names = [item['path'] for item in artifacts]
        required = {'stdout.log','stderr.log','execution.json'} | ({'report.json'} if check['adapter']!='exit' else set())
        result['artifactsValid'] = (len(names)==len(set(names)) and set(names)==required
                                   and all(artifact(path.parent,item['path'])==item for item in artifacts)
                                   and load_json(path.parent/'execution.json')==state)
        if not binding:
            result['errors'].append('check/argv/root/runtime/tool binding mismatch')
        result['accepted'] = all(result[key] for key in ['executionValid','sourceMatches','artifactsValid'])
    except Exception as error:
        result['errors'].append(type(error).__name__)
    return result, result['accepted']
