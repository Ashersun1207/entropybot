import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';
import { launchVerificationServer, runControlOmb, verificationServerEnvironment, verificationServerArgs } from './control-omb.ts';

const out = process.env.OMB_VERIFICATION_EVIDENCE_DIR;
if (!out || !process.env.TMPDIR?.startsWith('/private/tmp')) throw Error('explicit evidence and short canonical TMPDIR required');
const save = (name, data) => writeFileSync(`${out}/${name}.json`, JSON.stringify(data, null, 2));
const now = () => performance.now();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, ms = 15000) {
  const end = now() + ms;
  while (now() < end) { const value = fn(); if (value) return value; await pause(2); }
  throw Error(`deadline: ${label}`);
}
function processes() {
  return execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return m && { pid: +m[1], ppid: +m[2], pgid: +m[3], state: m[4], command: m[5] };
  }).filter(Boolean);
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function observer(s) {
  const frames = [], ac = new AbortController();
  const response = await fetch(`${s.info.url}/api/events?screens=off`, { signal: ac.signal });
  const reading = (async () => {
    let buffer = '';
    try { for await (const chunk of response.body) {
      buffer += new TextDecoder().decode(chunk);
      let pos;
      while ((pos = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, pos); buffer = buffer.slice(pos + 2);
        for (const line of raw.split('\n')) if (line.startsWith('data:')) frames.push({ t: now(), utc: new Date().toISOString(), frame: JSON.parse(line.slice(5)) });
      }
    } } catch (error) { if (!ac.signal.aborted) throw error; }
  })();
  return { frames, close: async () => { ac.abort(); await reading; } };
}
const results = { startUTC: new Date().toISOString(), loadStart: loadavg(), runs: [] };
let active;
process.on('SIGTERM', () => { active?.close().then(() => process.exit(143), () => process.exit(1)); });
process.on('SIGINT', () => { active?.close().then(() => process.exit(130), () => process.exit(1)); });
async function turn(s, bot, label, held) {
  const o = await observer(s);
  const result = { label, load: loadavg(), startUTC: new Date().toISOString() };
  const prev = existsSync(s.fixtureDumpPath) ? statSync(s.fixtureDumpPath).mtimeMs : 0;
  let receipt, dump;
  const poll = setInterval(() => {
    if (!receipt && existsSync(s.fixtureDumpPath) && statSync(s.fixtureDumpPath).mtimeMs !== prev) {
      receipt = now(); dump = JSON.parse(readFileSync(s.fixtureDumpPath, 'utf8'));
    }
  }, 2);
  try {
    const start = now(); result.sendStart = start;
    result.send = await runControlOmb(['send', '--url', s.info.url, '--bot', bot.id, '--text', 'hello synthetic baseline']);
    result.ackMs = now() - start;
    await until(() => receipt, 'prompt receipt');
    result.promptMs = receipt - start; result.fakePid = dump.pid;
    result.mountNames = Object.keys(dump.mcpConfig?.mcpServers ?? {});
    const started = await until(() => o.frames.find(f => f.frame.kind === 'runtime' && f.frame.event.type === 'turn.started'), 'turn.started');
    const turnId = started.frame.event.turnId;
    const threadId = started.frame.event.threadId;
    result.turnId = turnId; result.threadId = threadId;
    const terminal = () => o.frames.find(f => f.frame.kind === 'runtime' && f.frame.event.turnId === turnId && f.frame.event.type === 'turn.completed');
    if (held) {
      result.preStop = { promptObserved: true, terminalObserved: !!terminal(), fakeAlive: alive(dump.pid), gateConfigured: false };
      if (terminal() || !alive(dump.pid)) throw Error('hold invariant failed');
      result.beforeStopProcesses = processes().filter(p => [s.info.pid, dump.pid].includes(p.pid));
      result.stopBody = { threadId, turnId };
      result.stopStart = now();
      const response = await fetch(`${s.info.url}/api/bots/${bot.id}/interrupt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(result.stopBody), signal: AbortSignal.timeout(15000) });
      result.stopResponse = { status: response.status, body: await response.json() }; result.stopAckMs = now() - result.stopStart;
      if (!response.ok) throw Error('Stop HTTP failure');
      const done = await until(terminal, 'cancelled terminal');
      result.stopTerminalMs = done.t - result.stopStart; result.terminal = done;
    } else {
      const text = await until(() => o.frames.find(f => f.frame.kind === 'runtime' && f.frame.event.turnId === turnId && f.frame.event.type === 'content.delta' && JSON.stringify(f.frame).includes('B1TOKEN')), 'first text');
      result.textMs = text.t - start;
      result.terminal = await until(terminal, 'completed terminal');
    }
    result.wait = await runControlOmb(['wait', '--url', s.info.url, '--bot', bot.id, '--task', threadId, '--timeout', '15']);
    if (result.wait.status !== 'settled') throw Error('not settled');
    result.fakeAliveAfterWait = alive(dump.pid);
    result.afterProcesses = processes().filter(p => [s.info.pid, dump.pid].includes(p.pid));
    if (held) {
      result.stopWaitMs = now() - result.stopStart;
      const e = result.terminal.frame.event;
      if (e.ok !== false || e.stopReason !== 'interrupted' || result.wait.state !== 'idle') throw Error('missing interrupted terminal or settled idle projection');
      if (result.fakeAliveAfterWait) throw Error('cancelled fake process still present');
    }
    if (!held && (result.terminal.frame.event.ok !== true || result.terminal.frame.event.stopReason !== 'end_turn' || !JSON.stringify(result.wait.messages).includes('B1TOKEN'))) throw Error('missing successful terminal or scripted reply');
    return result;
  } finally {
    clearInterval(poll); await o.close(); save(`${label}-events`, o.frames); save(`${label}-result`, result);
  }
}
try {
  for (const mode of ['hang', 'happy']) for (let i = 1; i <= 5; i++) {
    const run = { mode, i, utc: new Date().toISOString() }; results.runs.push(run);
    let s;
    try {
      const env = { FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_TOOL_CALLS: '[]', FAKE_CLAUDE_REPLIES: '["B1TOKEN synthetic answer","B1TOKEN synthetic answer"]', FAKE_CLAUDE_STREAM_CADENCE: '7:10' };
      active = s = await launchVerificationServer(env); run.info = { ...s.info };
      run.env = verificationServerEnvironment(env, s.info.dataDir, Number(new URL(s.info.url).port)); run.argv = verificationServerArgs(run.env);
      const bot = (await (await fetch(`${s.info.url}/api/bots`)).json()).bots[0];
      run.first = await turn(s, bot, `${mode}${i}-first`, mode === 'hang');
      if (mode === 'happy') {
        run.second = await turn(s, bot, `${mode}${i}-second`, false);
        run.sameFakePid = run.first.fakePid === run.second.fakePid;
        if (!run.sameFakePid) throw Error('engine not retained');
        const st = now(); run.noop = await runControlOmb(['interrupt', '--url', s.info.url, '--bot', bot.id, '--task', run.second.threadId]); run.noopMs = now() - st;
        run.fakeAliveAfterNoop = alive(run.second.fakePid);
      }
    } finally {
      if (s) { await s.close(); active = undefined; run.dataRemoved = !existsSync(s.info.dataDir); const ids = [s.info.pid, run.first?.fakePid, run.second?.fakePid].filter(Boolean); run.afterClose = processes().filter(p => ids.includes(p.pid)); }
      save('results', results);
    }
  }
} catch (error) { results.error = String(error.stack); process.exitCode = 1; console.error(error); }
finally { results.endUTC = new Date().toISOString(); results.loadEnd = loadavg(); save('results', results); }
