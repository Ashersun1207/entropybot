import pathlib,json,statistics,sys,hashlib,datetime,subprocess,os
out=pathlib.Path(sys.argv[1]); data=json.loads((out/'results.json').read_text())
spans=[
('Send → host admission boundary','origin','host.enter'),
('Host admission/persist/claim → setup launch','host.enter','host.setupLaunch'),
('Setup launch → async body entry','host.setupLaunch','host.setupEnter'),
('Startup engine read wait','host.setupEnter','host.engineReadEnd'),
('Readiness branch residual','host.engineReadEnd','host.warmStart'),
('Warm-summary call to continuation (includes scheduling)','host.warmStart','host.compactStart'),
('Compaction gate','host.compactStart','host.contextStart'),
('Transcript/context/persona','host.contextStart','host.integrationsStart'),
('Host integration preparation','host.integrationsStart','host.workspaceStart'),
('Workspace/memory-turn/skills/pin','host.workspaceStart','host.surfaceStart'),
('Surface selection/preparation','host.surfaceStart','host.surfaceEnd'),
('Host capability/policy/dispatch checks','host.surfaceEnd','host.promptStart'),
('Ensure bot workspace','host.workspaceStart','host.workspaceEnsured'),
('Memory turn begin and box lending','host.workspaceEnsured','host.taskWorkspaceStart'),
('Task workspace and skill links (arguments included)','host.taskWorkspaceStart','host.taskWorkspaceEnd'),
('Skill rendering/playbooks/task pin','host.taskWorkspaceEnd','host.surfaceStart'),
('Peers/agents condition','host.surfaceEnd','host.agentsStart'),
('Agents integration','host.agentsStart','host.agentsEnd'),
('Hooks integration condition/body','host.agentsEnd','host.hooksEnd'),
('Mentions/coordination/prompt strings','host.hooksEnd','host.checkpointStart'),
('Checkpoint conditional','host.checkpointStart','host.checkpointEnd'),
('Live bot/setup mode','host.checkpointEnd','host.dataStart'),
('Data integration conditional','host.dataStart','host.dataEnd'),
('CRM/email/device integration checks','host.dataEnd','host.otherCapabilitiesEnd'),
('Browser integration conditional','host.otherCapabilitiesEnd','host.browserEnd'),
('Auto pin/place recording','host.browserEnd','host.handshakeStart'),
('Pending cancelled-handshake await and claim check','host.handshakeStart','host.handshakeEnd'),
('Prompt kind/coordination checks','host.handshakeEnd','host.bridgeStart'),
('Agents bridge and confinement filter','host.bridgeStart','host.promptStart'),
('System prompt and argument construction','host.promptStart','host.promptEnd'),
('Recall plus prompt-byte bookkeeping','host.promptEnd','host.recallEnd'),
('Final context/clock/dispatch arguments','host.recallEnd','host.dispatch'),
('Dispatch wrappers → driver entry','host.dispatch','driver.enter'),
('Driver startup catalog wait','driver.enter','driver.afterStartup'),
('Driver scope/auth/busy checks','driver.afterStartup','driver.permissions'),
('Permission mode and host-control check','driver.permissions','driver.userMessage'),
('User-message construction','driver.userMessage','driver.afterUserMessage'),
('Turn IDs/argv/environment','driver.afterUserMessage','driver.versionStart'),
('ensureCliVersion await','driver.versionStart','driver.versionEnd'),
('Version flags/tool policy','driver.versionEnd','driver.modelStart'),
('Model resolution await','driver.modelStart','driver.modelEnd'),
('Model injection/argv','driver.modelEnd','driver.mcpStart'),
('MCP assembly/project config/temp allocation','driver.mcpStart','driver.mcpEnd'),
('Auth/settings/hooks/tool-search assembly','driver.mcpEnd','driver.settingsEnd'),
('Cwd canonicalization and contract hashing','driver.settingsEnd','driver.decision'),
('Reuse decision → fresh branch','driver.decision','driver.fresh'),
('Fresh prompt split/cleanup closure','driver.fresh','driver.filesStart'),
('System prompt temp allocation/write','driver.filesStart','driver.brokerStart'),
('Permission broker bind await','driver.brokerStart','driver.brokerEnd'),
('MCP/settings files/final flags','driver.brokerEnd','driver.filesEnd'),
('Launch try boundary','driver.filesEnd','driver.spawnCli'),
('spawnCli resolution/boxing → Node spawn entry','driver.spawnCli','spawn.call'),
('Send → spawn entry','origin','spawn.call'),
('Send → write entry','origin','stdin.write'),
('Decision → reused write','driver.decision','stdin.write'),
]
values={label:{'first':[],'second':[]} for label,_,_ in spans}
raw=[]
for run in data['results']:
 rows=[json.loads(line) for line in (out/f"observer-{run['i']}.jsonl").read_text().splitlines()]
 for side in ['first','second']:
  turn=run[side]; lo=turn['origin']; hi=turn['tokenAt']
  selected=[r for r in rows if lo<=int(r['ns'])/1e6<=hi]
  marks={'origin':lo}
  for r in selected:
   if r['kind'] in marks: raise ValueError('duplicate stage '+r['kind'])
   marks[r['kind']]=int(r['ns'])/1e6
  assert marks['host.enter']<marks['driver.enter']<marks['driver.decision']<marks['stdin.write']
  assert ('spawn.call' in marks)==(side=='first')
  assert ('driver.fresh' in marks)==(side=='first')
  assert ('driver.reuse' in marks)==(side=='second')
  for label,a,b in spans:
   if a in marks and b in marks:
    if side=='first' and label=='Decision → reused write':continue
    values[label][side].append(marks[b]-marks[a])
  raw.append({'i':run['i'],'side':side,'marks':marks})
 assert run['first']['fakePid']==run['second']['fakePid']
 assert not run['afterClose'] and run['dataRemoved']
def stats(v):return {'n':len(v),'median':statistics.median(v),'min':min(v),'max':max(v),'spread':max(v)-min(v)} if v else None
summary={k:{s:stats(v) for s,v in sides.items()} for k,sides in values.items()}
assert len(data['results']) == 5 and len(raw) == 10
for label, sides in summary.items():
 for side, stat in sides.items():
  if stat is not None: assert stat['n'] == 5, (label, side, stat)
for run in data['results']:
 assert run['first']['fakeArgv'] == run['second']['fakeArgv']
 assert run['first']['fakeCwd'] == run['second']['fakeCwd']
(out/'summary.json').write_text(json.dumps({'summary':summary,'raw':raw},indent=2))
for k,sides in summary.items():
 def cell(s):
  v=sides[s]
  return f"{v['median']:.3f} | {v['min']:.3f}–{v['max']:.3f} | {v['spread']:.3f}" if v else '— | — | —'
 print('| '+k+' | '+cell('first')+' | '+cell('second')+' |')
before=json.loads((out/'batch-before.json').read_text()); after=json.loads((out/'batch-after.json').read_text())
assert before['sourceSHA256']==after['sourceSHA256']
assert before['head']==after['head'] and before['tree']==after['tree'] and before['statusPorcelain']==after['statusPorcelain']
print('HASHES MATCH',len(before['sourceSHA256']))
print('LOAD',before['machine'],after['machine'])
print('TIMING',(out/'batch-timing.json').read_text())
pids={p['pid'] for r in data['results'] for p in r['beforeClose']}
live={int(p) for p in subprocess.check_output(['/bin/ps','-axo','pid='],text=True).split()}
audit={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pids':sorted(pids),'remaining':sorted(pids&live),'dataDirs':{r['info']['dataDir']:os.path.exists(r['info']['dataDir']) for r in data['results']},'summarizerSHA256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}
(out/'final-owned-resource-audit.json').write_text(json.dumps(audit,indent=2))
assert not audit['remaining'] and not any(audit['dataDirs'].values())
