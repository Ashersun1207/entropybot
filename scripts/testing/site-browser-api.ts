import type { WireBot, WireMessage, ServerFrame, MausColor } from "../../shared/wire";
import type { ConfigStatus } from "../../src/state/config-status";
import type { InstanceInfo } from "../../src/state/store";
import { WELCOME_VERSION } from "../../src/lib/onboarding";
import { installSiteStorage, siteSessionStorage } from "./site-browser-storage";
import { siteReply } from "./site-replies";
import { siteEnglish, siteLanguage, siteText } from "./site-locale";

type Thread = { id: string; title: string; createdAt: number; updatedAt: number; messages: WireMessage[] };
type SiteBot = { id: string; name: string; color: MausColor; createdAt: number; selected: string; threads: Thread[] };
type State = { version: 1; session: string; bots: SiteBot[]; autoplay?: boolean };
const STATE_KEY = "entropybot.site.api.v1";
type TranscriptLine =
  | { role: "user" | "bot"; text: string }
  | { tool: string; label: string }
  | { routine: string; summary: string };

const chineseProfiles: Array<{ name: string; color: MausColor; transcript: TranscriptLine[] }> = [
  {
    name: "Entropybot", color: "chrome",
    transcript: [
      { role: "bot", text: "你好，我是 Entropybot。有什么要交给我做的？" },
      { role: "user", text: "核对这两份活动资料，整理读书会准备项；邀请先留作草稿。" },
      { tool: "read_file", label: "读取活动说明" },
      { tool: "read_file", label: "读取场地备注" },
      { role: "bot", text: "活动说明写 **周五晚**，场地备注写 **周六晚**，日期有出入。先确认以哪份为准。" },
      { role: "user", text: "按周五晚来。" },
      { routine: "读书会准备清单", summary: "确定书目、准备三个讨论问题、确认场地与人数。" },
      { role: "bot", text: "清单已整理，邀请仍留作草稿，等你最后确认。" },
    ],
  },
  {
    name: "资料助手", color: "green",
    transcript: [
      { role: "user", text: "帮我核对这两份读书会资料的日期。" },
      { role: "bot", text: siteReply("日期") },
      { role: "user", text: "按周五晚整理，列一份准备清单。" },
      { role: "bot", text: siteReply("清单") },
    ],
  },
  {
    name: "项目助手", color: "purple",
    transcript: [
      { role: "user", text: "周五办读书会，帮我整理准备清单。邀请先留作草稿。" },
      { role: "bot", text: siteReply("清单") },
      { role: "user", text: "人数从 12 人改成 16 人，按相同方法再整理一次。" },
      { role: "bot", text: siteReply("按刚才的三个步骤") },
    ],
  },
  {
    name: "个人助理", color: "cyan",
    transcript: [
      { role: "user", text: "以后整理读书会资料，先给摘要，需要时再展开。" },
      { role: "bot", text: siteReply("偏好") },
      { role: "user", text: "按这个偏好，把这两份活动资料整理一下。" },
      { role: "bot", text: siteReply("摘要") },
    ],
  },
];
function makeEnglishProfiles() {
  const profiles = structuredClone(chineseProfiles);
  profiles[0].transcript = [
    { role: "bot", text: "Hi, I'm Entropybot. What would you like me to take care of?" },
    { role: "user", text: "Compare these two event documents and prepare the book club checklist. Keep the invitation as a draft." },
    { tool: "read_file", label: "Read event brief" },
    { tool: "read_file", label: "Read venue notes" },
    { role: "bot", text: "The event brief says **Friday evening**, but the venue notes say **Saturday evening**. Which date should I use?" },
    { role: "user", text: "Use Friday evening." },
    { routine: "Book club preparation checklist", summary: "Choose the book, prepare three discussion questions, and confirm the venue and attendees." },
    { role: "bot", text: "The checklist is ready. The invitation is still a draft, waiting for your approval." },
  ];
  for (const [index, name] of ["Entropybot", "Research assistant", "Project assistant", "Personal assistant"].entries()) profiles[index].name = name;
  profiles[1].transcript = [{ role: "user", text: "Check the date in these two book club documents." }, { role: "bot", text: siteReply("date", true) }, { role: "user", text: "Use Friday evening and prepare a checklist." }, { role: "bot", text: siteReply("checklist", true) }];
  profiles[2].transcript = [{ role: "user", text: "Prepare a book club checklist. Keep the invitation as a draft." }, { role: "bot", text: siteReply("checklist", true) }, { role: "user", text: "The attendee count changed from 12 to 16. Use the same method again." }, { role: "bot", text: siteReply("same method", true) }];
  profiles[3].transcript = [{ role: "user", text: "Remember my preference: summary first, details when needed." }, { role: "bot", text: siteReply("preference", true) }, { role: "user", text: "Summarize the book club documents using this preference." }, { role: "bot", text: siteReply("summary", true) }];
  return profiles;
}
const englishProfiles = makeEnglishProfiles();
const profiles = siteEnglish ? englishProfiles : chineseProfiles;
const model = { instanceId: "site-example", model: "site-example" };
const uuid = () => crypto.randomUUID();
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const transcriptMessage = (line: TranscriptLine, at: number, parentId: string | null): WireMessage => {
  if ("text" in line) return { id: uuid(), role: line.role, kind: "text", text: line.text, at, parentId, ...(line.role === "bot" ? { turnTerminal: true } : {}) };
  if ("tool" in line) return { id: uuid(), role: "bot", kind: "activity", at, parentId, tool: { name: line.tool, label: line.label, ok: true } };
  return { id: uuid(), role: "bot", kind: "routine.run", at, parentId, routineRun: { runId: uuid(), routineId: uuid(), routineName: line.routine, status: "completed", summary: line.summary } };
};
const fillTranscript = (thread: Thread, transcript: TranscriptLine[], now: number): void => {
  let parentId: string | null = null;
  transcript.forEach((line, index) => {
    const message = transcriptMessage(line, now - (transcript.length - index) * 40000, parentId);
    parentId = message.id; thread.messages.push(message);
  });
  thread.updatedAt = thread.messages.at(-1)!.at;
};

function seed(): State {
  const now = Date.now();
  return { version: 1, session: uuid(), bots: profiles.map((profile, index) => {
    const title = ("text" in profile.transcript[0] ? profile.transcript[0].text : profile.name).trim().slice(0, 20);
    const thread: Thread = { id: uuid(), title, createdAt: now - profile.transcript.length * 40000, updatedAt: now, messages: [] };
    if (index !== 0 || reducedMotion()) fillTranscript(thread, profile.transcript, now);
    return { id: uuid(), name: profile.name, color: profile.color, createdAt: now, selected: thread.id, threads: [thread] };
  }) };
}
function restore(raw: string | null): State | null {
  if (!raw || raw.length > 1500000) return null;
  try {
    const state = JSON.parse(raw) as State;
    if (state.version !== 1 || !validId(state.session) || !Array.isArray(state.bots) || state.bots.length !== 4) return null;
    const ids = new Set<string>();
    for (const [index, bot] of state.bots.entries()) {
      if (!validId(bot.id) || ids.has(bot.id) || ![chineseProfiles[index].name, englishProfiles[index].name].includes(bot.name) || !Array.isArray(bot.threads) || !bot.threads.length || bot.threads.length > 3) return null;
      ids.add(bot.id); bot.color = profiles[index].color; bot.name = profiles[index].name;
      if (!bot.threads.some(thread => thread.id === bot.selected)) return null;
      for (const thread of bot.threads) {
        if (!validId(thread.id) || ids.has(thread.id) || !Number.isFinite(thread.createdAt) || !Array.isArray(thread.messages) || thread.messages.length > 48 || typeof thread.title !== "string" || thread.title.length > 100) return null;
        ids.add(thread.id);
        const previousOpening = (siteEnglish ? chineseProfiles : englishProfiles)[index].transcript[0];
        const opening = profiles[index].transcript[0];
        if (!thread.messages[0]?.turnId && "text" in previousOpening && "text" in opening && thread.title === previousOpening.text.trim().slice(0, 20)) thread.title = opening.text.trim().slice(0, 20);
        if (thread.title === (siteEnglish ? "循环示例" : "Looping example")) thread.title = siteText("循环示例", "Looping example");
        for (const [messageIndex, message] of thread.messages.entries()) {
          if (!validId(message.id) || ids.has(message.id) || !["user", "bot"].includes(message.role) || !["text", "activity", "routine.run"].includes(message.kind) || !Number.isFinite(message.at)) return null;
          if (message.kind === "text" && (typeof message.text !== "string" || message.text.length > 5000)) return null;
          if (message.kind === "activity" && (!message.tool || typeof message.tool.name !== "string" || typeof message.tool.label !== "string")) return null;
          if (message.kind === "routine.run" && (!message.routineRun || typeof message.routineRun.routineName !== "string")) return null;
          ids.add(message.id);
          const target = profiles[index].transcript[messageIndex];
          const previous = (siteEnglish ? chineseProfiles : englishProfiles)[index].transcript[messageIndex];
          if (target && previous && !message.turnId) {
            if ("text" in target && "text" in previous && message.kind === "text" && message.role === previous.role && message.text === previous.text) message.text = target.text;
            if ("tool" in target && "tool" in previous && message.tool?.label === previous.label) message.tool.label = target.label;
            if ("routine" in target && "routine" in previous && message.routineRun?.routineName === previous.routine) { message.routineRun.routineName = target.routine; message.routineRun.summary = target.summary; }
          }
          if (message.requestPending) { message.requestPending = false; message.requestCancelled = true; }
        }
        const last = thread.messages.at(-1);
        if (last?.role === "bot" && last.kind === "text" && !last.turnTerminal) { last.text += siteText("\n\n（上次示例已中断，可重新发送。）", "\n\n(The previous example was interrupted. You can send it again.)"); last.turnTerminal = true; }
      }
    }
    return state;
  } catch { return null; }
}

export function installSiteBrowserApi(): { mainBotId: string; setPlayback: (playing: boolean) => boolean; isPlaying: () => boolean } {
  installSiteStorage();
  const storage = siteSessionStorage();
  const state = restore(storage.getItem(STATE_KEY)) ?? seed();
  const isDemonstration = (thread: Thread) => thread.messages.every((message, index) => {
    const line = profiles[0].transcript[index];
    return line && ("text" in line ? message.kind === "text" && message.text === line.text : "tool" in line ? message.tool?.label === line.label : message.routineRun?.routineName === line.routine);
  });
  const featuredThread = state.bots[0].threads.find(thread => thread.id === state.bots[0].selected)!;
  const resumeDemo = state.autoplay ?? isDemonstration(featuredThread);
  if (resumeDemo && !reducedMotion()) featuredThread.messages = [];
  const sources = new Set<BrowserEvents>();
  const running = new Map<string, { thread: Thread; user: WireMessage; answer: WireMessage; full: string; timer: ReturnType<typeof setInterval>; offset: number }>();
  let sequence = 0;
  let playback: { lines: TranscriptLine[]; index: number; timer: ReturnType<typeof setTimeout> | null; stream: { message: WireMessage; full: string; offset: number; timer: ReturnType<typeof setInterval> } | null } | null = null;
  let playbackSeen = false;
  let intervened = !resumeDemo || reducedMotion();
  let loopTimer: ReturnType<typeof setTimeout> | null = null;
  const announcePlayback = () => window.dispatchEvent(new CustomEvent("site-playback-state", { detail: { playing: !intervened && !reducedMotion() } }));
  const save = () => { if (playback) return; state.autoplay = !intervened; try { storage.setItem(STATE_KEY, JSON.stringify(state)); } catch {} };
  const frame = (value: ServerFrame) => {
    const data = { ...value, cursor: `${state.session}:${++sequence}` };
    for (const source of sources) source.deliver(data);
  };
  const threadOf = (bot: SiteBot, id = bot.selected) => bot.threads.find(thread => thread.id === id);
  const injectLine = (thread: Thread, line: TranscriptLine): WireMessage => {
    const message = transcriptMessage(line, Date.now(), thread.messages.at(-1)?.id ?? null);
    thread.messages.push(message); thread.updatedAt = message.at;
    frame({ kind: "message", threadId: thread.id, message });
    frame({ kind: "thread", threadId: thread.id, activeLeafId: message.id });
    return message;
  };
  const playStep = () => {
    if (!playback) return;
    const bot = state.bots[0]!, thread = threadOf(bot)!;
    const line = playback.lines[playback.index];
    if (!line) {
      playback = null;
      frame({ kind: "bot", bot: wire(bot) });
      save();
      if (!intervened) loopTimer = setTimeout(loopPlayback, 2600);
      return;
    }
    if ("text" in line && line.role === "user") {
      injectLine(thread, line); playback.index += 1; playback.timer = setTimeout(playStep, 550);
      return;
    }
    if ("tool" in line) {
      injectLine(thread, line);
      frame({ kind: "bot", bot: wire(bot) });
      playback.index += 1;
      playback.timer = setTimeout(playStep, 620);
      return;
    }
    if ("routine" in line) {
      injectLine(thread, line);
      frame({ kind: "bot", bot: wire(bot) });
      playback.index += 1;
      playback.timer = setTimeout(playStep, 950);
      return;
    }
    frame({ kind: "bot", bot: { ...wire(bot), busy: true, activity: "working" } });
    playback.timer = setTimeout(() => {
      if (!playback) return;
      const answer: WireMessage = { id: uuid(), role: "bot", kind: "text", text: "", at: Date.now(), parentId: thread.messages.at(-1)?.id ?? null };
      thread.messages.push(answer); thread.updatedAt = answer.at;
      frame({ kind: "message", threadId: thread.id, message: answer });
      frame({ kind: "thread", threadId: thread.id, activeLeafId: answer.id });
      const full = line.text;
      const stream = { message: answer, full, offset: 0, timer: undefined as unknown as ReturnType<typeof setInterval> };
      playback.stream = stream;
      stream.timer = setInterval(() => {
        if (playback?.stream !== stream) { clearInterval(stream.timer); return; }
        stream.offset = Math.min(full.length, stream.offset + 9);
        answer.text = full.slice(0, stream.offset);
        frame({ kind: "message.patch", threadId: thread.id, message: answer });
        if (stream.offset === full.length) {
          clearInterval(stream.timer);
          playback.stream = null;
          answer.turnTerminal = true; answer.turnCompletedAt = Date.now();
          frame({ kind: "thread", threadId: thread.id, activeLeafId: answer.id });
          frame({ kind: "bot", bot: wire(bot) });
          playback.index += 1;
          playback.timer = setTimeout(playStep, 560);
        }
      }, 70);
    }, 700);
  };
  const startPlayback = () => {
    if (playback || playbackSeen || reducedMotion() || intervened) return;
    const featured = state.bots[0]!;
    if (threadOf(featured)!.messages.length !== 0) return;
    playbackSeen = true;
    playback = { lines: profiles[0].transcript, index: 0, timer: null, stream: null };
    playback.timer = setTimeout(playStep, 700);
    announcePlayback();
  };
  const loopPlayback = () => {
    loopTimer = null;
    if (intervened || reducedMotion() || document.hidden) return;
    const bot = state.bots[0]!;
    threadOf(bot)!.messages = [];
    playbackSeen = false;
    for (const source of sources) source.onerror?.(new Event("error"));
  };
  const finishPlayback = () => {
    if (intervened) return;
    intervened = true;
    announcePlayback();
    if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
    const bot = state.bots[0]!, thread = threadOf(bot)!;
    if (!playback) {
      if (thread.messages.length === 0) for (const line of profiles[0].transcript) injectLine(thread, line);
      frame({ kind: "bot", bot: wire(bot) });
      save();
      return;
    }
    if (playback.timer) clearTimeout(playback.timer);
    let nextIndex = playback.index;
    if (playback.stream) {
      clearInterval(playback.stream.timer);
      const { message, full } = playback.stream;
      message.text = full; message.turnTerminal = true; message.turnCompletedAt = Date.now();
      frame({ kind: "message.patch", threadId: thread.id, message });
      playback.stream = null;
      nextIndex += 1;
    }
    const remaining = playback.lines.slice(nextIndex);
    playback = null;
    for (const line of remaining) injectLine(thread, line);
    frame({ kind: "bot", bot: wire(bot) });
    save();
  };
  const setPlayback = (playing: boolean): boolean => {
    if (!playing) { finishPlayback(); return true; }
    if (reducedMotion()) return false;
    const bot = state.bots[0]!;
    if (running.size) return false;
    const thread = threadOf(bot)!;
    if (!isDemonstration(thread)) {
      if (bot.threads.length >= 3) return false;
      const demo: Thread = { id: uuid(), title: siteText("循环示例", "Looping example"), createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
      bot.threads.push(demo); bot.selected = demo.id;
    }
    if (playback?.timer) clearTimeout(playback.timer);
    if (playback?.stream) clearInterval(playback.stream.timer);
    playback = null;
    if (loopTimer) clearTimeout(loopTimer);
    intervened = false;
    loopPlayback();
    announcePlayback();
    return true;
  };
  const wire = (bot: SiteBot): WireBot => ({
    id: bot.id, threadId: bot.selected, mainThreadId: bot.threads[0].id, name: bot.name, color: bot.color,
    title: "", description: siteText("合成示例助手", "Synthetic example assistant"), notifications: false, avatarUrl: null, createdAt: bot.createdAt,
    modelSelection: model, unread: false, busy: running.has(bot.id), activity: running.has(bot.id) ? "working" : "idle", approvalMode: "ask", autoApprove: false,
    ...(bot.name === "Entropybot" ? { defaultBot: {}, welcomed: true } : {}),
    tasks: bot.threads.map(thread => ({ threadId: thread.id, title: thread.title, createdAt: thread.createdAt, updatedAt: thread.updatedAt, unread: false,
      busy: running.get(bot.id)?.thread.id === thread.id, activity: running.get(bot.id)?.thread.id === thread.id ? "working" : "idle", modelSelection: model })),
  });
  const snapshot = (bot: SiteBot) => ({ ...wire(bot), messages: threadOf(bot)!.messages, hasMore: false, activeLeafId: threadOf(bot)!.messages.at(-1)?.id ?? null });
  const config: ConfigStatus = {
    language: siteLanguage, profile: { name: siteText("你", "You"), email: "" }, computerName: siteText("示例工作区", "Example workspace"),
    composio: { configured: false, mode: "unavailable" }, box: { configured: false }, vps: { configured: false, sshAlias: "" },
    rooms: { turnTimeoutMinutes: 5 }, localVm: { mode: "shared", maxInstances: 0 },
    edition: { edition: "oss", features: [] }, features: { skillAuthoring: false, browser: false, showToolCalls: true, savedSteps: false },
    onboarding: { completedAt: new Date().toISOString(), version: WELCOME_VERSION, reelSeen: true, hintsSeen: [] },
    browserEngine: { kind: "unavailable", reason: siteText("网站示例不连接电脑或外部工具。", "This website example does not connect to a computer or external tools."), installable: false },
    threads: { maxConcurrentPerBot: 1 }, automaticRecovery: { enabled: false }, cacheKeepWarm: { enabled: false, windowMinutes: 0 },
    live: { configured: false, voice: "", readTypedReplies: false, idleMinutes: 5 },
  };
  const instance: InstanceInfo = { instanceId: model.instanceId, driverKind: "claudeAgent", displayName: siteText("合成示例", "Synthetic example"),
    access: "custom", snapshot: { state: "available", authenticated: true, version: siteText("网站预设回复", "Website preset replies") },
    models: { default: model.model, options: [{ id: model.model, label: siteText("示例回复", "Example replies") }] }, capabilities: { backgroundText: true, queueing: false, images: false } };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const refuse = (status = 403, error = siteText("网站示例仅开放文字对话、助手切换和新对话。", "This website example supports text chat, switching assistants and new conversations only.")) => json({ error }, status);
  function settle(bot: SiteBot, stopped: boolean) {
    const run = running.get(bot.id);
    if (!run) return;
    clearInterval(run.timer); running.delete(bot.id);
    run.user.requestPending = false; run.user.requestCancelled = stopped;
    if (stopped) run.answer.text = (run.answer.text || siteText("已停止这个示例。", "This example has stopped.")) + siteText("\n\n（示例已停止，可修改后重新发送。）", "\n\n(Example stopped. Edit your message and send it again.)");
    run.answer.turnTerminal = true; run.answer.turnSucceeded = !stopped; run.answer.turnCompletedAt = Date.now();
    frame({ kind: "message.patch", threadId: run.thread.id, message: run.user });
    frame({ kind: "message.patch", threadId: run.thread.id, message: run.answer });
    frame({ kind: "thread", threadId: run.thread.id, activeLeafId: run.answer.id });
    frame({ kind: "bot", bot: wire(bot) }); save();
  }
  async function api(request: Request): Promise<Response> {
    if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (method === "GET") {
      if (path === "/api/auth/session") return json({ kind: "loopback", scopes: ["admin", "client"], environmentId: state.session });
      if (path === "/api/bots") {
        const body = json({ bots: state.bots.map(snapshot), botQueuedMessages: {}, sections: [], groups: [], computerControl: {} });
        setTimeout(startPlayback, 0);
        return body;
      }
      if (path === "/api/config") return json(config);
      if (path === "/api/instances") return json({ instances: [instance] });
      const empty: Record<string, unknown> = {
        "/api/notifications": { notifications: [] }, "/api/routines": { routines: [], runs: [] }, "/api/webhooks": { webhooks: [], attempts: [], ingress: [] },
        "/api/inbox": { items: [], tasks: [], revision: "site" }, "/api/limit-resets": { resets: [], instances: [] }, "/api/live/call": { call: null },
        "/api/connectors/connected": { apps: [], connected: [] }, "/api/connectors/catalog": { apps: [] }, "/api/app-triggers": { triggers: [], attempts: [], services: [] },
        "/api/phones": { phones: [] }, "/api/plan": { plan: null },
      };
      if (Object.hasOwn(empty, path)) return json(empty[path]);
      const tasks = /^\/api\/bots\/([^/]+)\/tasks$/.exec(path);
      if (tasks) { const bot = state.bots.find(bot => bot.id === tasks[1]); return bot ? json({ tasks: wire(bot).tasks }) : refuse(404); }
      const messages = /^\/api\/threads\/([^/]+)\/(messages|job)$/.exec(path);
      if (messages) {
        const thread = state.bots.flatMap(bot => bot.threads).find(thread => thread.id === messages[1]);
        if (!thread) return refuse(404);
        return json(messages[2] === "job" ? { job: null } : { messages: thread.messages, hasMore: false, activeLeafId: thread.messages.at(-1)?.id ?? null });
      }
      return refuse();
    }
    if (method !== "POST") return refuse();
    const route = /^\/api\/bots\/([^/]+)\/(messages|read|interrupt|tasks(?:\/[^/]+)?)$/.exec(path);
    const bot = route && state.bots.find(bot => bot.id === route[1]);
    if (!route || !bot) return refuse();
    if (request.headers.get("content-type")?.includes("application/json") === false) return refuse(415);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 8192) return refuse(413, siteText("请使用简短文字体验。", "Please use a short text message."));
    let input: Record<string, unknown>;
    try { input = raw ? JSON.parse(raw) : {}; } catch { return refuse(400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return refuse(400);
    const thread = threadOf(bot, typeof input.threadId === "string" ? input.threadId : bot.selected);
    if (!thread) return refuse(404);
    if (route[2] === "read") return json({ ok: true });
    if (route[2] === "interrupt") { settle(bot, true); return json({ outcome: "stopped" }); }
    if (route[2] === "tasks") {
      finishPlayback();
      if (bot.threads.length >= 3) return refuse(429, siteText("本标签页的示例对话已达上限，可在新标签页重新开始。", "This tab has reached its example conversation limit. Start again in a new tab."));
      const task: Thread = { id: uuid(), title: siteText("新对话", "New conversation"), createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
      bot.threads.push(task); bot.selected = task.id; save(); return json({ bot: snapshot(bot) });
    }
    if (route[2].startsWith("tasks/")) {
      const target = threadOf(bot, route[2].slice(6));
      if (!target) return refuse(404);
      finishPlayback();
      bot.selected = target.id; save(); return json({ bot: snapshot(bot) });
    }
    if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 1000) return refuse(400, siteText("请输入1至1000字的文字。", "Please enter between 1 and 1,000 characters."));
    if (input.sendId !== undefined && (typeof input.sendId !== "string" || input.sendId.length > 100)) return refuse(400);
    const duplicate = typeof input.sendId === "string" && thread.messages.find(message => message.sendId === input.sendId);
    if (duplicate) return json({ message: duplicate, threadId: thread.id, accepted: true });
    if (running.has(bot.id)) return refuse(409, siteText("示例正在回复，请稍候或先停止。", "The example is replying. Please wait or stop it first."));
    if (thread.messages.filter(message => message.role === "user").length >= 20) return refuse(429, siteText("这个示例会话已满，请新建对话继续。", "This example conversation is full. Create a new conversation to continue."));
    finishPlayback();
    const turnId = uuid();
    const user: WireMessage = { id: uuid(), role: "user", kind: "text", text: input.text, at: Date.now(), parentId: thread.messages.at(-1)?.id ?? null,
      ...(typeof input.sendId === "string" ? { sendId: input.sendId } : {}), turnId, requestPending: true };
    const answer: WireMessage = { id: uuid(), role: "bot", kind: "text", text: "", at: Date.now(), parentId: user.id, turnId, requestMessageId: user.id };
    thread.messages.push(user, answer); thread.updatedAt = Date.now();
    if (thread.messages.length === 2) thread.title = input.text.trim().slice(0, 28);
    const run = { thread, user, answer, full: siteReply(input.text, siteEnglish), offset: 0, timer: undefined as unknown as ReturnType<typeof setInterval> };
    running.set(bot.id, run);
    frame({ kind: "message", threadId: thread.id, message: user });
    frame({ kind: "message", threadId: thread.id, message: answer });
    frame({ kind: "bot", bot: wire(bot) }); save();
    run.timer = setInterval(() => {
      if (running.get(bot.id) !== run) return;
      run.offset = Math.min(run.full.length, run.offset + 14); answer.text = run.full.slice(0, run.offset);
      frame({ kind: "message.patch", threadId: thread.id, message: answer });
      if (run.offset === run.full.length) settle(bot, false);
    }, 90);
    return json({ message: user, threadId: thread.id, accepted: true });
  }
  class BrowserEvents extends EventTarget implements EventSource {
    static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSED = 2;
    readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSED = 2;
    readyState = 0; readonly url: string; readonly withCredentials = false;
    addEventListener = EventTarget.prototype.addEventListener as EventSource["addEventListener"];
    removeEventListener = EventTarget.prototype.removeEventListener as EventSource["removeEventListener"];
    onopen: ((this: EventSource, event: Event) => unknown) | null = null;
    onmessage: ((this: EventSource, event: MessageEvent) => unknown) | null = null;
    onerror: ((this: EventSource, event: Event) => unknown) | null = null;
    private heartbeat: ReturnType<typeof setInterval>;
    constructor(input: string | URL) {
      super(); const url = new URL(input, location.href);
      if (url.origin !== location.origin || url.pathname !== "/api/events") throw new Error("Unsupported site event source");
      this.url = url.href; sources.add(this);
      queueMicrotask(() => { if (this.readyState === 2) return; this.readyState = 1; const event = new Event("open"); this.onopen?.(event); this.dispatchEvent(event); this.deliver({ kind: "hello", resumed: false, cursor: `${state.session}:${sequence}` }); });
      this.heartbeat = setInterval(() => { if (!document.hidden) this.deliver({ kind: "ping" }); }, 15000);
    }
    deliver(value: unknown) { if (this.readyState !== 1) return; const event = new MessageEvent("message", { data: JSON.stringify(value), lastEventId: `${state.session}:${sequence}` }); this.onmessage?.(event); this.dispatchEvent(event); }
    close() { this.readyState = 2; clearInterval(this.heartbeat); sources.delete(this); }
  }
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.origin === location.origin && url.pathname.startsWith("/api/")) return api(request);
    if (url.origin !== location.origin || !["GET", "HEAD"].includes(request.method)) return Promise.resolve(refuse());
    return originalFetch(request);
  };
  window.EventSource = BrowserEvents;
  document.addEventListener("pointerdown", event => {
    if (event.isTrusted && event.target instanceof Element && event.target.closest("textarea, input, button, a, [role='button'], [data-sidebar-bot-row]")) finishPlayback();
  }, { capture: true });
  document.addEventListener("keydown", event => {
    if (event.isTrusted && event.target instanceof HTMLTextAreaElement && !["Tab", "Shift", "Control", "Alt", "Meta"].includes(event.key)) finishPlayback();
  }, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !intervened && !playback && !loopTimer) loopPlayback();
  });
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  motion.addEventListener("change", () => { if (motion.matches) finishPlayback(); });
  window.addEventListener("pagehide", event => {
    if (event.persisted) return;
    const wasPlaying = !intervened;
    finishPlayback();
    for (const bot of state.bots) settle(bot, true);
    for (const source of sources) source.close();
    intervened = !wasPlaying;
    save();
  });
  return { mainBotId: state.bots[0].id, setPlayback, isPlaying: () => !intervened && !reducedMotion() };
}
