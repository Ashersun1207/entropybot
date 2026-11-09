import cp from 'node:child_process';
import {registerHooks, syncBuiltinESMExports} from 'node:module';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const out = process.env.C1_PREP_LOG;
if (!out) throw Error('C1_PREP_LOG required');
const rows = [];
const mark = (kind, detail) => rows.push({ns: process.hrtime.bigint().toString(), pid: process.pid, kind, ...detail});
globalThis[Symbol.for('c1.prep.mark')] = mark;
const point = name => `globalThis[Symbol.for('c1.prep.mark')](${JSON.stringify(name)});\n`;
const plans = {
  '/server/drivers/claude.ts': [
    ['      if (startupModelRefresh) await startupModelRefresh;', 'driver.enter'],
    ['      turn = { ...turn, toolScope:', 'driver.afterStartup'],
    ['      const permissionMode = turn.approvalMode', 'driver.permissions'],
    ['      const promptMsg = claudeUserMessage(turn.text, turn.images);', 'driver.userMessage'],
    ['      const turnId = logicalTurnId ?? newId();', 'driver.afterUserMessage'],
    ['      await ensureCliVersion(turnEnvironment);', 'driver.versionStart'],
    ['      if (turn.guestConfined && !claudeCliSupports(cliVersion, "--restricted"))', 'driver.versionEnd'],
    ['      const turnModel = config.managed ? turn.model : await resolveClaudeTurnModel', 'driver.modelStart'],
    ['      const injected = config.managed ?', 'driver.modelEnd'],
    ['      const mcpServers: Record<string, unknown> = {};', 'driver.mcpStart'],
    ['      const env = environment(turnModel);', 'driver.mcpEnd'],
    ['      const commandCwd = permissionLaunchCwd(cwd);', 'driver.settingsEnd'],
    ['      const live = sessions.get(threadId);', 'driver.decision'],
    ['        if (live.idleTimer) clearTimeout(live.idleTimer);', 'driver.reuse'],
    ['      if (live) closeSession(threadId, turn.sessionReset ?', 'driver.fresh'],
    ['        if (launchSystem) {', 'driver.filesStart'],
    ['        if (socketPath) {', 'driver.brokerStart'],
    ['        // Write once, only after the broker has selected its real endpoint.', 'driver.brokerEnd'],
    ['      let child: ReturnType<typeof spawnCli>;', 'driver.filesEnd'],
    ['        child = spawnCli(config.cli, args,', 'driver.spawnCli'],
  ],
  '/server/index.ts': [
    ['  limitFailovers.restore(botId, threadId);', 'host.enter'],
    ['  void (async () => {\n    try {\n      const engineRead = registry.engineRead(instance.instanceId);', 'host.setupLaunch'],
    ['      const engineRead = registry.engineRead(instance.instanceId);\n      if (engineRead)', 'host.setupEnter'],
    ['      if (opts?.runOn === "cloud") {\n        const readiness = await cloudRoutineReadiness', 'host.engineReadEnd'],
    ['      await warmSummaries.beforeTurn(threadId,', 'host.warmStart'],
    ['      await compactConversation({ bot, threadId, generation: dispatchClaimId, instance, model,', 'host.compactStart'],
    ['      const skipTranscript = new Set<string>([userMessage.id,', 'host.contextStart'],
    ['      const integrations: NonNullable<Parameters<typeof instance.adapter.sendTurn>[0]["integrations"]> = {};', 'host.integrationsStart'],
    ['      const worksInWorkspace = supportsWorkspaceFiles(instance.driverKind);', 'host.workspaceStart'],
    ['        if (bot.memoryEnabled !== false) beginMemoryTurn(teamHost.layer(bot.id, threadId), threadId); botBox.lend', 'host.workspaceEnsured'],
    ['      const privateWorkspace = worksInWorkspace ? ensureTaskWorkspaceWithSkills', 'host.taskWorkspaceStart'],
    ['      const skillInstructions = renderSkillInstructions(selectedSkills,', 'host.taskWorkspaceEnd'],
    ['      const dwebUrl = process.env.DWEB_URL?.trim();', 'host.surfaceStart'],
    ['        integrations.agents = agentsIntegration(bot.id, threadId, commsDepth,', 'host.agentsStart'],
    ['      if (instance.adapter.capabilities.hooks === true && hooksEnabled()) {', 'host.agentsEnd'],
    ['      // "@Bob" is the teammate Bob (or the writer themselves), never a bot that shares the name.', 'host.hooksEnd'],
    ['      if (checkpointCwd) {\n        const before = await checkpoints.snapshot', 'host.checkpointStart'],
    ['      // One bot snapshot for the browser bearer, setupModeActive and the prompt\'s soul, so a soul saved mid-dispatch cannot split them.', 'host.checkpointEnd'],
    ['      if (liveBot && instance.adapter.capabilities.dataMcp === true) {', 'host.dataStart'],
    ['      if (liveBot && instance.adapter.capabilities.highlevelMcp === true)', 'host.dataEnd'],
    ['      const mountedComputer = surfaceOfComputerKind(computerKind);', 'host.otherCapabilitiesEnd'],
    ['      if (autoPinAllowed()) {\n        const claimSlot = autoVmClaims.get(threadId);', 'host.browserEnd'],
    ['      await pendingCancelledProviderHandshakes.waitForClear(threadId);\n      if (!markDirectTurnDispatching', 'host.handshakeStart'],
    ['      const computerPromptKind = resolveComputerPromptKind({\n        kind: computerKind,', 'host.handshakeEnd'],
    ['      applyAgentsBridge(threadId, integrations, cfg, bot, turnEngine(instance, providerConfigs(), registry.lastSnapshot(instance.instanceId), cwd));', 'host.bridgeStart'],
    ['      const sectionPeers = reachablePeers(store.bots, bot);', 'host.surfaceEnd'],
    ['      const prompt = buildSystemPrompt(persona,', 'host.promptStart'],
    ['      turnPromptBytes.set(threadId, { stable: Buffer.byteLength(prompt.stable),', 'host.promptEnd'],
    ['      if (!directTurnClaimIsCurrent(bot.id, dispatchClaimId, threadId)) {\n        throw new DirectTurnSetupCancelled("turn stopped before dispatch");', 'host.recallEnd'],
    ['      const dispatch = await guardTurnDispatch(shareNote.after(savedSteps.dispatch.sendTurn(instance,', 'host.dispatch'],
  ],
};
registerHooks({load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  const key = Object.keys(plans).find(suffix => url.endsWith(suffix));
  if (!key) return result;
  let source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString();
  for (const [anchor, name] of plans[key]) {
    if (source.split(anchor).length !== 2) throw Error(`C1 anchor not unique: ${name}`);
    source = source.replace(anchor, point(name) + anchor);
  }
  mark('hook.loaded', {module: key, points: plans[key].length});
  return {...result, source};
}});
const spawn = cp.spawn;
cp.spawn = function(command, args, _options) {
  const target = args?.includes('--input-format') && args.includes('stream-json');
  if (!target) return Reflect.apply(spawn, this, arguments);
  mark('spawn.call');
  const child = Reflect.apply(spawn, this, arguments);
  mark('spawn.return', {childPid: child.pid});
  child.once('spawn', () => mark('spawn.event', {childPid: child.pid}));
  const write = child.stdin.write;
  child.stdin.write = function() {mark('stdin.write', {childPid: child.pid}); return Reflect.apply(write, this, arguments);};
  child.once('close', (code, signal) => mark('child.close', {childPid: child.pid, code, signal}));
  return child;
};
syncBuiltinESMExports();
for (let i = process.execArgv.length - 1; i >= 1; i--) if (process.execArgv[i] === fileURLToPath(import.meta.url) && process.execArgv[i - 1] === '--import') process.execArgv.splice(i - 1, 2);
process.on('exit', () => {mark('observer.exit'); writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\n') + '\n', {mode: 0o600});});
