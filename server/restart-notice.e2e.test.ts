import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";
import { noticeTool } from "./chat-notices.ts";
import type { BotRecord, Message, TaskRecord } from "./store.ts";
import type { Assignment } from "./runtime/types.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

const RESTART_NOTE = "Entropybot restarted while your previous turn here was running";
const RESUMING = "chat.notice.resumingAfterRestart";
const restartLines = (rows: Message[]) => rows.filter(row => /restart/i.test(row.tool?.nameCode ?? ""));

async function scenario(test: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const f = await fixture();
  try { await test(f); }
  finally {
    try { f.capture("final"); }
    finally { await f.session.close(); }
  }
}

async function fixture() {
  const session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true }, [], undefined, undefined, data => {
    const path = join(data, "config.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    config.instances.claude.environment.FAKE_CLAUDE_PROMPTS = join(data, "prompts.jsonl");
    writeFileSync(path, JSON.stringify(config));
  });
  const { url, dataDir, logPath } = session.info;
  const api = async <T = unknown>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(url + path, { method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBeLessThan(300);
    return result as T;
  };
  const { bot } = await api<{ bot: BotRecord }>("POST", "/api/bots", { name: "Restart notice fixture" });
  const { task } = await api<{ task: TaskRecord }>("POST", `/api/bots/${bot.id}/tasks`, { title: "Original conversation" });
  const { task: other } = await api<{ task: TaskRecord }>("POST", `/api/bots/${bot.id}/tasks`, { title: "Other conversation" });
  const threadId: string = task.threadId;
  const planPath = join(dataDir, "room-plan.json");
  const gate = (name: string) => join(dataDir, `${name}.gate`);
  const ready = (name: string) => join(dataDir, `${name}.ready`);
  const script = (...entries: unknown[]) => writeFileSync(planPath, JSON.stringify({ [bot.id]: { script: entries } }));
  const read = <T>(file: string, query: string, ...params: string[]): T[] => {
    const db = new DatabaseSync(join(dataDir, file), { readOnly: true });
    try { return (db.prepare(query).all(...params) as Array<{ json: string }>).map(row => JSON.parse(row.json)); }
    finally { db.close(); }
  };
  const roots = () => read<Assignment>("runtime.db", "SELECT json FROM assignments ORDER BY created_at, id").filter(row => !row.parentId);
  const persisted = () => read<Message>("messages.db", "SELECT json FROM messages WHERE thread_id = ? ORDER BY rowid", threadId);
  const messages = async (thread = threadId): Promise<Message[]> => (await api<{ messages: Message[] }>("GET", `/api/threads/${thread}/messages?limit=100`)).messages;
  const taskState = async () => (await api<{ bots: Array<BotRecord & { tasks: TaskRecord[] }> }>("GET", "/api/bots?messages=0")).bots.find(row => row.id === bot.id)
    ?.tasks.find(row => row.threadId === threadId);
  const prompts = () => existsSync(join(dataDir, "prompts.jsonl"))
    ? readFileSync(join(dataDir, "prompts.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const snapshots: unknown[] = [];
  const capture = (phase: string) => {
    snapshots.push({ phase, botId: bot.id, threadId, roots: roots(), messages: persisted(), promptCount: prompts().length });
    writeFileSync(`${logPath}.restart-notice.json`, JSON.stringify(snapshots, null, 2));
  };
  const say = (text: string) => api("POST", `/api/bots/${bot.id}/messages`, { threadId, text });
  const running = async (name: string, executions: number) => {
    await expect.poll(() => existsSync(ready(name)), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => roots()[0]?.status, { timeout: 15_000 }).toBe("running");
    expect(roots()[0]).toMatchObject({ executions, assignee: { botId: bot.id, destination: { threadId } } });
    capture(name);
  };
  return { session, api, bot, threadId, other, gate, ready, script, roots, persisted, messages, taskState, prompts, capture, say, running };
}

it.each(["SIGKILL", "SIGTERM"] as const)("%s restores the original running conversation once, persists its notice without duplicating it on reads or another startup", signal => scenario(async f => {
  f.script(
    { key: "recovered", match: ["NOTICE-JOB", RESTART_NOTE], readyFile: f.ready("recovered"), gateFile: f.gate("recovered"), reply: "NOTICE-DONE" },
    { key: "initial", match: ["NOTICE-JOB"], readyFile: f.ready("initial"), gateFile: f.gate("initial"), reply: "initial must not finish" },
  );
  await f.say("NOTICE-JOB: summarise the synthetic invoice totals.");
  await f.running("initial", 1);
  const rootId = f.roots()[0]!.id;
  expect(f.prompts()).toHaveLength(1);
  expect(restartLines(await f.messages())).toEqual([]);
  await f.session.restart(undefined, { signal });
  await f.running("recovered", 2);
  expect(f.roots()).toHaveLength(1);
  expect(f.roots()[0]).toMatchObject({ id: rootId, restarts: 1, restart: "rerun" });
  expect(f.prompts()).toHaveLength(2);
  const lines = restartLines(await f.messages());
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ role: "bot", kind: "activity" });
  expect(lines[0]!.tool).toEqual(noticeTool(RESUMING, undefined, { ok: true }));
  expect(restartLines(f.persisted())).toEqual(lines);
  expect(restartLines(await f.messages(f.other.threadId))).toEqual([]);
  expect(await f.taskState()).toMatchObject({ busy: true });
  for (let i = 0; i < 3; i++) expect(restartLines(await f.messages())).toEqual(lines);
  expect(f.prompts()).toHaveLength(2);
  writeFileSync(f.gate("recovered"), "finish");
  await expect.poll(() => f.roots()[0]?.status, { timeout: 30_000 }).toBe("completed");
  expect(f.roots()[0]).toMatchObject({ id: rootId, executions: 2, restarts: 1, outcome: "done" });
  expect((await f.messages()).filter(row => row.kind === "text" && row.text === "NOTICE-DONE")).toHaveLength(1);
  f.capture("completed");
  await f.session.restart(undefined, { signal: "SIGTERM" });
  expect(restartLines(await f.messages())).toEqual(lines);
  expect(restartLines(f.persisted())).toEqual(lines);
  expect(f.prompts()).toHaveLength(2);
  expect(await f.taskState()).toMatchObject({ busy: false });
}), hostTimeout(90_000));

it.each(["SIGKILL", "SIGTERM"] as const)("%s during the recovery attempt keeps the existing twice-cut failure and reports it once", signal => scenario(async f => {
  f.script(
    { key: "recovered", match: ["TWICE-JOB", RESTART_NOTE], readyFile: f.ready("recovered"), gateFile: f.gate("recovered"), reply: "never" },
    { key: "initial", match: ["TWICE-JOB"], readyFile: f.ready("initial"), gateFile: f.gate("initial"), reply: "never" },
  );
  await f.say("TWICE-JOB: prepare the synthetic summary.");
  await f.running("initial", 1);
  await f.session.restart(undefined, { signal });
  await f.running("recovered", 2);
  await f.session.restart(undefined, { signal });
  await expect.poll(() => f.roots()[0]?.status, { timeout: 30_000 }).toBe("failed");
  expect(f.roots()[0]).toMatchObject({ outcome: "interrupted", executions: 2, restarts: 1 });
  const lines = await f.messages();
  expect(restartLines(lines).map(row => row.tool?.nameCode)).toEqual([RESUMING]);
  const failed = lines.filter(row => row.tool?.ok === false);
  expect(failed).toHaveLength(1);
  expect(failed[0]!.tool?.name).toContain(f.roots()[0]!.outcomeDetail);
  expect(f.prompts()).toHaveLength(2);
  expect(await f.taskState()).toMatchObject({ busy: false });
  f.capture("twice-cut");
  await f.session.restart(undefined, { signal: "SIGTERM" });
  expect((await f.messages()).filter(row => row.tool?.ok === false)).toEqual(failed);
  expect(restartLines(await f.messages()).map(row => row.id)).toEqual(restartLines(lines).map(row => row.id));
  expect(f.prompts()).toHaveLength(2);
}), hostTimeout(90_000));

it("a recovery queued behind another conversation does not claim to be resuming until dispatch", () => scenario(async f => {
  await f.api("PATCH", "/api/config", { threads: { maxConcurrentPerBot: 2 } });
  f.script(
    { key: "holder-recovered", match: ["HOLDER-JOB", RESTART_NOTE], readyFile: f.ready("holder-recovered"), gateFile: f.gate("holder-recovered"), reply: "Holder done." },
    { key: "holder-initial", match: ["HOLDER-JOB"], readyFile: f.ready("holder-initial"), gateFile: f.gate("holder-initial"), reply: "never" },
    { key: "subject-recovered", match: ["QUEUED-JOB", RESTART_NOTE], readyFile: f.ready("subject-recovered"), gateFile: f.gate("subject-recovered"), reply: "Subject done." },
    { key: "subject-initial", match: ["QUEUED-JOB"], readyFile: f.ready("subject-initial"), gateFile: f.gate("subject-initial"), reply: "never" },
  );
  await f.api("POST", `/api/bots/${f.bot.id}/messages`, { threadId: f.other.threadId, text: "HOLDER-JOB: prepare a synthetic summary." });
  await expect.poll(() => existsSync(f.ready("holder-initial")), { timeout: 30_000 }).toBe(true);
  await f.say("QUEUED-JOB: prepare a different synthetic summary.");
  await expect.poll(() => existsSync(f.ready("subject-initial")), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => f.roots().map(row => row.status), { timeout: 15_000 }).toEqual(["running", "running"]);
  await f.api("PATCH", "/api/config", { threads: { maxConcurrentPerBot: 1 } });
  const subjectId = f.roots()[1]!.id;
  f.capture("two-running");
  await f.session.restart(undefined, { signal: "SIGKILL" });
  await expect.poll(() => existsSync(f.ready("holder-recovered")), { timeout: 30_000 }).toBe(true);
  expect(f.roots()[1]).toMatchObject({ id: subjectId, status: "queued", restart: "rerun", restarts: 1, executions: 1 });
  expect(restartLines(await f.messages())).toEqual([]);
  expect(restartLines(f.persisted())).toEqual([]);
  expect(existsSync(f.ready("subject-recovered"))).toBe(false);
  expect(f.prompts()).toHaveLength(3);
  f.capture("queued-recovery");
  writeFileSync(f.gate("holder-recovered"), "finish");
  await expect.poll(() => existsSync(f.ready("subject-recovered")), { timeout: 30_000 }).toBe(true);
  expect(f.roots()[1]).toMatchObject({ id: subjectId, status: "running", executions: 2 });
  const lines = restartLines(await f.messages());
  expect(lines).toHaveLength(1);
  expect(lines[0]!.tool?.nameCode).toBe(RESUMING);
  expect(restartLines(f.persisted())).toEqual(lines);
  writeFileSync(f.gate("subject-recovered"), "finish");
  await expect.poll(() => f.roots().map(row => row.status), { timeout: 30_000 }).toEqual(["completed", "completed"]);
  await f.session.restart(undefined, { signal: "SIGTERM" });
  expect(restartLines(await f.messages())).toEqual(lines);
  expect(f.prompts()).toHaveLength(4);
}), hostTimeout(90_000));

it.each(["SIGKILL", "SIGTERM"] as const)("%s does not label completed, manually stopped, provider-failed or needs-input turns as restarting", signal => scenario(async f => {
  await f.api("PATCH", `/api/bots/${f.bot.id}`, { chiefOfStaff: true });
  f.script(
    { key: "completed", match: ["CONTROL-DONE"], reply: "Control completed." },
    { key: "stopped", match: ["CONTROL-STOP"], readyFile: f.ready("stop"), gateFile: f.gate("stop"), reply: "never" },
    { key: "error", match: ["CONTROL-ERROR"], failWith: "Synthetic provider unavailable" },
    { key: "input", match: ["CONTROL-INPUT"], steps: [{ tool: "request_credential", arguments: { credential_id: "xaiApiKey", reason: "Synthetic model setup" } }], reply: "Waiting for your key." },
  );
  await f.say("CONTROL-DONE: acknowledge this synthetic task.");
  await expect.poll(() => f.roots()[0]?.status, { timeout: 30_000 }).toBe("completed");
  await f.say("CONTROL-STOP: prepare this synthetic task.");
  await expect.poll(() => existsSync(f.ready("stop")), { timeout: 30_000 }).toBe(true);
  await f.api("POST", `/api/bots/${f.bot.id}/interrupt`, { threadId: f.threadId });
  await expect.poll(() => f.roots()[1]?.status, { timeout: 15_000 }).toBe("cancelled");
  await f.say("CONTROL-ERROR: prepare a synthetic task.");
  await expect.poll(() => f.roots()[2]?.status, { timeout: 30_000 }).toBe("failed");
  await f.say("CONTROL-INPUT: ask for the synthetic model key.");
  await expect.poll(() => f.roots()[3]?.status, { timeout: 30_000 }).toBe("needs_input");
  const before = f.roots().map(row => ({ id: row.id, status: row.status, executions: row.executions }));
  const promptCount = f.prompts().length;
  expect(before).toHaveLength(4);
  expect(promptCount).toBe(4);
  f.capture("controls-before");
  await f.session.restart(undefined, { signal });
  expect(f.roots().map(row => ({ id: row.id, status: row.status, executions: row.executions }))).toEqual(before);
  expect(restartLines(await f.messages())).toEqual([]);
  expect(restartLines(f.persisted())).toEqual([]);
  expect(f.prompts()).toHaveLength(promptCount);
  expect(await f.taskState()).toMatchObject({ busy: false, activity: "waiting-on-you" });
  f.capture("controls-restored");
  await f.session.restart(undefined, { signal: "SIGTERM" });
  expect(restartLines(await f.messages())).toEqual([]);
  expect(f.prompts()).toHaveLength(promptCount);
}), hostTimeout(120_000));
