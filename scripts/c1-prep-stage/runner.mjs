import {writeFileSync, readFileSync, existsSync, statSync} from 'node:fs';
import cp, {execFileSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const evidence = process.env.OMB_VERIFICATION_EVIDENCE_DIR;
if (!evidence) throw Error('evidence directory required');
const original = cp.spawn, injected = [];
cp.spawn = function(command, args, options) {
  if (args?.some(a => String(a).endsWith('/verification-server-preload.ts'))) {
    const ordinal = injected.length + 1;
    args = ['--import', root + '/scripts/c1-prep-stage/observer.mjs', ...args];
    options = {...options, env: {...options.env, C1_PREP_LOG: evidence + '/observer-' + ordinal + '.jsonl'}};
    injected.push({command, args, env: options.env});
    return original.call(this, command, args, options);
  }
  return Reflect.apply(original, this, arguments);
};
syncBuiltinESMExports();
const {launchVerificationServer, runControlOmb} = await import(root + '/scripts/control-omb.ts');
const now = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const config = {FAKE_CLAUDE_MODE: 'happy', FAKE_CLAUDE_TOOL_CALLS: '[]', FAKE_CLAUDE_REPLIES: '["B1TOKEN synthetic answer","B1TOKEN synthetic answer"]', FAKE_CLAUDE_STREAM_CADENCE: '7:10'};
const results = [], startUTC = new Date().toISOString();
function ps() {
  return execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,command='], {encoding: 'utf8'}).trim().split('\n').map(s => {
    const m = s.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return m ? {pid: +m[1], ppid: +m[2], pgid: +m[3], state: m[4], command: m[5]} : null;
  }).filter(Boolean);
}
function owned(pid) {const tree = ps(), ids = new Set([pid]); for (let i = 0; i < 10; i++) for (const p of tree) if (ids.has(p.ppid)) ids.add(p.pid); return tree.filter(p => ids.has(p.pid));}
async function turn(s, bot, label) {
  const frames = [], ac = new AbortController(); let origin = null, tokenAt = null, dispatchAt = null, dumpData;
  const stream = await fetch(s.info.url + '/api/events?screens=off', {signal: ac.signal});
  const reader = (async () => {let buffer = ''; try {for await (const chunk of stream.body) {
    buffer += new TextDecoder().decode(chunk); let pos;
    while ((pos = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, pos); buffer = buffer.slice(pos + 2);
      for (const line of raw.split('\n')) if (line.startsWith('data:')) {
        const frame = JSON.parse(line.slice(5)), t = now(); frames.push({t, frame});
        if (origin !== null && tokenAt === null && frame.kind === 'runtime' && frame.event?.type === 'content.delta' && JSON.stringify(frame).includes('B1TOKEN')) tokenAt = t;
      }
    }
  }} catch (e) {if (!ac.signal.aborted) throw e;}})();
  const dump = s.fixtureDumpPath, prev = existsSync(dump) ? statSync(dump).mtimeMs : 0;
  const poll = setInterval(() => {if (dispatchAt === null && existsSync(dump) && statSync(dump).mtimeMs !== prev) {dispatchAt = now(); dumpData = JSON.parse(readFileSync(dump, 'utf8'));}}, 2);
  const sendArgv = ['send', '--url', s.info.url, '--bot', bot, '--text', 'hello synthetic baseline'];
  const waitArgv = ['wait', '--url', s.info.url, '--bot', bot, '--timeout', '20'];
  try {
    origin = now(); const send = await runControlOmb(sendArgv), ackAt = now();
    const wait = await runControlOmb(waitArgv); await sleep(30);
    if (wait.status !== 'settled' || wait.state !== 'completed' || !JSON.stringify(wait).includes('B1TOKEN') || !dispatchAt || !tokenAt) throw Error('incomplete observations: ' + JSON.stringify(wait));
    return {label, origin, ackAt, dispatchAt, tokenAt, sendArgv, waitArgv, send, wait, fakePid: dumpData.pid, fakeArgv: dumpData.argv, fakeCwd: dumpData.cwd, mountNames: Object.keys(dumpData.mcpConfig?.mcpServers ?? {})};
  } finally {clearInterval(poll); ac.abort(); await reader; writeFileSync(evidence + '/' + label + '-events.json', JSON.stringify(frames, null, 2));}
}
try {
  for (let i = 1; i <= 5; i++) {
    let s; const run = {i, startUTC: new Date().toISOString()}; results.push(run);
    try {
      s = await launchVerificationServer(config); run.info = {...s.info};
      const bots = await (await fetch(s.info.url + '/api/bots')).json(); run.bot = bots.bots[0].id;
      run.beforeFirst = owned(s.info.pid); run.first = await turn(s, run.bot, 'run' + i + '-first');
      run.between = owned(s.info.pid); run.second = await turn(s, run.bot, 'run' + i + '-second'); run.afterSecond = owned(s.info.pid);
      if (run.first.fakePid !== run.second.fakePid) throw Error('engine PID changed');
    } finally {
      if (s) {
        run.beforeClose = owned(s.info.pid); await s.close();
        const ids = new Set(run.beforeClose.map(p => p.pid)); run.afterClose = ps().filter(p => ids.has(p.pid)); run.dataRemoved = !existsSync(s.info.dataDir);
      }
      run.endUTC = new Date().toISOString();
      writeFileSync(evidence + '/results.json', JSON.stringify({startUTC, endUTC: new Date().toISOString(), results, injected}, null, 2));
    }
    if (run.afterClose.length || !run.dataRemoved) throw Error('cleanup unresolved');
    console.log('completed ' + i);
  }
} catch (e) {console.error(e); process.exitCode = 1;}
