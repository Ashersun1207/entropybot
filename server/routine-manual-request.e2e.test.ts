import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { launchVerificationServer, verificationServerArgs, verificationServerEnvironment, type VerificationServer } from "../scripts/control-omb.ts";
import { launchCloudSendFixture, type CloudSendFixture } from "../scripts/testing/cloud-send-fixture.ts";
import { waitForExit } from "./testing/cleanup.ts";

let fixture: VerificationServer | undefined;
let restarted: ChildProcess | undefined;
let cloud: CloudSendFixture | undefined;
afterEach(async () => {
  await waitForExit(restarted, { signal: "SIGTERM" });
  await fixture?.close();
  await cloud?.close();
  fixture = restarted = cloud = undefined;
});

async function server() {
  fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "happy" });
  const { url, dataDir } = fixture.info;
  const api = async (method: string, path: string, body?: unknown, key?: string, token?: string) => {
    const response = await fetch(url + path, {
      method, headers: { origin: url, "content-type": "application/json", ...(key === undefined ? {} : { "Idempotency-Key": key }),
        ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const bots = (await api("GET", "/api/bots")).body.bots;
  const bot = bots[0];
  await api("PATCH", `/api/bots/${bot.id}`, { chiefOfStaff: false });
  const make = async (name = "Synthetic manual identity") => {
    const made = await api("POST", "/api/routines", { name, prompt: "Return synthetic fixture text.", botId: bot.id,
      schedule: { type: "cron", expression: "0 0 1 1 *", timeZone: "UTC" } });
    expect(made.status).toBe(201);
    return made.body.routine;
  };
  const runs = async () => (await api("GET", "/api/routines")).body.runs as any[];
  const start = (id: string, key?: string, token?: string, body?: unknown) => api("POST", `/api/routines/${id}/run`, body, key, token);
  const complete = async (id: string) => expect.poll(async () => (await runs()).find(run => run.id === id)?.status, { timeout: 20_000 }).toBe("completed");
  const restart = async () => {
    await waitForExit(restarted ?? fixture!.child, { signal: "SIGTERM" });
    const env = verificationServerEnvironment({ FAKE_CLAUDE_MODE: "happy" }, dataDir, Number(new URL(url).port));
    const log = openSync(fixture!.info.logPath, "a", 0o600);
    try { restarted = spawn(process.execPath, verificationServerArgs(env), { cwd: process.cwd(), env, stdio: ["ignore", log, log] }); }
    finally { closeSync(log); }
    await expect.poll(async () => { try { return (await fetch(url + "/api/health")).ok; } catch { return false; } }, { timeout: 20_000 }).toBe(true);
  };
  return { url, dataDir, api, bot, make, runs, start, complete, restart };
}

it("replays concurrent manual HTTP requests and completed runs across server restart, preserving metadata", async () => {
  const s = await server(), routine = await s.make();
  const path = `/api/routines/${routine.id}/run`;
  const [first, retry] = await Promise.all([
    s.start(routine.id, "synthetic-retry-1", undefined, { botId: "spoof-bot", threadId: "spoof-thread", actor: "spoof" }),
    s.start(routine.id, "synthetic-retry-1"),
  ]);
  expect(first.status).toBe(201);
  expect(retry.status).toBe(201);
  expect(retry.body.run.id).toBe(first.body.run.id);
  expect(await s.runs()).toHaveLength(1);
  expect(first.body.run.sourceThreadId).toBeUndefined();
  expect(first.body.run.resultsThreadId).not.toBe("spoof-thread");
  await s.complete(first.body.run.id);
  const completed = (await s.runs())[0];
  const disk = JSON.parse(readFileSync(join(s.dataDir, "routines.json"), "utf8"));
  expect(disk.routineRequestReceipts).toHaveLength(1);
  expect(disk.routineRequestReceipts[0]).toMatchObject({ origin: "http", resultId: completed.id, routineId: routine.id });
  expect(JSON.stringify(disk.routineRequestReceipts)).not.toContain("synthetic-retry-1");
  for (const field of ["botId", "threadId", "messageId"]) expect(disk.routineRequestReceipts[0]).not.toHaveProperty(field);
  await s.restart();
  const replay = await s.api("POST", path, undefined, "synthetic-retry-1");
  expect(replay.status).toBe(201);
  expect(replay.body.run).toEqual(completed);
  expect(await s.runs()).toHaveLength(1);
  await expect.poll(async () => (await s.api("GET", "/api/bots")).body.bots.every((bot: { busy?: boolean }) => !bot.busy)).toBe(true);
  expect((await s.api("POST", "/api/move/freeze", {})).status).toBe(200);
  expect((await s.start(routine.id, "synthetic-retry-1")).status).toBe(409);
  expect((await s.api("DELETE", "/api/move/freeze", {})).status).toBe(200);
  expect((await s.start(routine.id, "synthetic-retry-1")).body.run.id).toBe(completed.id);
  const noHeader = await s.start(routine.id);
  await s.complete(noHeader.body.run.id);
  const another = await s.start(routine.id);
  expect(another.body.run.id).not.toBe(noHeader.body.run.id);
  expect(await s.runs()).toHaveLength(3);
  await s.complete(another.body.run.id);
  await s.api("PATCH", `/api/routines/${routine.id}`, { prompt: "A changed intention" });
  expect((await s.start(routine.id, "synthetic-retry-1")).status).toBe(409);
  expect(await s.runs()).toHaveLength(3);
  await s.api("DELETE", `/api/routines/${routine.id}`);
  expect((await s.start(routine.id, "synthetic-retry-1")).status).toBe(404);
}, 90_000);

it("rejects malformed and duplicate headers before mutation and rolls failed durable admission back", async () => {
  const s = await server(), routine = await s.make();
  for (const key of ["", "x".repeat(129), "bad token", "bad,token", "é", "_bad"]) {
    expect((await s.start(routine.id, key)).status, key).toBe(400);
  }
  const duplicateStatus = await new Promise<number>((resolve, reject) => {
    const req = request(s.url + `/api/routines/${routine.id}/run`, {
      method: "POST", headers: ["Origin", s.url, "Idempotency-Key", "duplicate", "Idempotency-Key", "duplicate"],
    }, response => { response.resume(); response.on("end", () => resolve(response.statusCode!)); });
    req.on("error", reject); req.end();
  });
  expect(duplicateStatus).toBe(400);
  expect(await s.runs()).toHaveLength(0);
  const file = join(s.dataDir, "routines.json"), backup = file + ".owned-backup";
  renameSync(file, backup); mkdirSync(file);
  try {
    expect((await s.start(routine.id, "durability-failure")).status).toBe(500);
    expect(await s.runs()).toHaveLength(0);
    expect(existsSync(fixture!.fixtureDumpPath)).toBe(false);
  } finally { rmSync(file, { recursive: true }); renameSync(backup, file); }
  const accepted = await s.start(routine.id, "durability-failure");
  expect(accepted.status).toBe(201);
  await s.complete(accepted.body.run.id);
  expect((await s.start(routine.id, "durability-failure")).body.run.id).toBe(accepted.body.run.id);
  expect(await s.runs()).toHaveLength(1);
  const boundaryKey = `${"a".repeat(124)}._:-`;
  const boundary = await s.start(routine.id, boundaryKey);
  expect(boundary.status).toBe(201);
  await s.complete(boundary.body.run.id);
  expect((await s.start(routine.id, boundaryKey)).body.run.id).toBe(boundary.body.run.id);
}, 60_000);

it("isolates actual authenticated callers, routines and keys and rechecks revoked sessions", async () => {
  const s = await server(), routine = await s.make();
  const pair = async (label: string) => {
    const opened = await s.api("POST", "/api/auth/pairing", { label, scopes: ["client"] });
    const paired = await s.api("POST", "/api/auth/pair", { code: opened.body.code });
    expect(paired.status).toBe(200);
    return paired.body;
  };
  const alice = await pair("Synthetic Alice"), bob = await pair("Synthetic Bob");
  const a = await s.start(routine.id, "same-key", alice.token);
  expect(a.status).toBe(201); await s.complete(a.body.run.id);
  const b = await s.start(routine.id, "same-key", bob.token);
  expect(b.status).toBe(201); expect(b.body.run.id).not.toBe(a.body.run.id); await s.complete(b.body.run.id);
  expect((await s.start(routine.id, "same-key", alice.token)).body.run.id).toBe(a.body.run.id);
  const other = await s.make("Other routine");
  const c = await s.start(other.id, "same-key", alice.token);
  expect(c.status).toBe(201); expect(c.body.run.id).not.toBe(a.body.run.id); await s.complete(c.body.run.id);
  const d = await s.start(routine.id, "other-key", alice.token);
  expect(d.status).toBe(201); expect(d.body.run.id).not.toBe(a.body.run.id); await s.complete(d.body.run.id);
  expect((await s.start("missing-target", "same-key", alice.token)).status).toBe(404);
  expect((await s.start(routine.id, "same-key", "omb_sess_invalid_synthetic")).status).toBe(401);
  const revoked = await s.api("DELETE", `/api/auth/sessions/${alice.session.id}`);
  expect(revoked.status).toBe(200);
  expect((await s.start(routine.id, "same-key", alice.token)).status).toBe(401);
  expect(await s.runs()).toHaveLength(4);
}, 90_000);

it("refuses currently hidden or denied team targets before replaying a receipt", async () => {
  cloud = await launchCloudSendFixture({ onePasswordToken: "ops_fake-manual-identity-only", team: { id: "manual-team", name: "Synthetic team" } });
  const team = cloud.team!;
  const admin = (await team.pair({ email: "admin@manual.test", role: "admin" })).token!;
  const member = (await team.pair({ email: "member@manual.test", role: "member" })).token!;
  const made = await team.as(admin, "POST", "/api/bots", { name: "Manual fixture" });
  expect(made.status).toBe(201);
  const botId = made.body.bot.id;
  const created = await team.as(admin, "POST", "/api/routines", { name: "Visible manual", prompt: "Synthetic only", botId,
    schedule: { type: "cron", expression: "0 0 1 1 *", timeZone: "UTC" } });
  expect(created.status).toBe(201);
  const path = `/api/routines/${created.body.routine.id}/run`;
  const start = async (token: string) => {
    const response = await fetch(team.base + path, { method: "POST", headers: { ...cloud!.edge, authorization: `Bearer ${token}`, "Idempotency-Key": "team-retry" } });
    return { status: response.status, body: await response.json() as any };
  };
  expect((await start(member)).status).toBe(201);
  expect((await team.as(admin, "PUT", `/api/bots/${botId}/access`, { everyone: "view", people: {} })).status).toBe(200);
  expect((await start(member)).status).toBe(403);
  expect((await team.as(admin, "PUT", `/api/bots/${botId}/access`, { everyone: "none", people: {} })).status).toBe(200);
  expect((await start(member)).status).toBe(404);
  expect((await team.as(admin, "GET", "/api/routines")).body.runs).toHaveLength(1);
}, 90_000);
