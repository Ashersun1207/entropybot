import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { launchVerificationServer, verificationServerArgs, verificationServerEnvironment, type VerificationServer } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";

let fixture: VerificationServer | undefined;
let child: ChildProcess | undefined;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await waitForExit(child, { signal: "SIGTERM" });
  child = undefined;
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await fixture?.close();
  fixture = undefined;
});

async function server() {
  let held: ServerResponse | undefined;
  const reads: string[] = [];
  const pages = createServer((req, res) => {
    reads.push(req.url!);
    if (req.url === "/hold") { held = res; return; }
    res.end("<p>synthetic literal page</p>");
  });
  await new Promise<void>(resolve => pages.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => { pages.closeAllConnections(); await new Promise<void>((resolve, reject) => pages.close(error => error ? reject(error) : resolve())); });
  const port = (pages.address() as { port: number }).port;
  fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "happy" });
  const { url, dataDir } = fixture.info;
  writeFileSync(join(dataDir, "collection-fixture.json"), JSON.stringify({ port }), { mode: 0o600 });
  const restart = async (signal: "SIGTERM" | "SIGKILL" = "SIGTERM", whileStopped?: () => void) => {
    await waitForExit(child ?? fixture!.child, { signal });
    whileStopped?.();
    const env = verificationServerEnvironment({ FAKE_CLAUDE_MODE: "happy" }, dataDir, Number(new URL(url).port));
    const log = openSync(fixture!.info.logPath, "a", 0o600);
    try {
      child = spawn(process.execPath, ["--import", fileURLToPath(new URL("./testing/collection-http-hooks.mjs", import.meta.url)), ...verificationServerArgs(env)],
        { cwd: process.cwd(), env, stdio: ["ignore", log, log] });
    } finally { closeSync(log); }
    await expect.poll(async () => { try { return (await fetch(url + "/api/health")).ok; } catch { return false; } }, { timeout: 20_000 }).toBe(true);
  };
  await restart();
  const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(url + path, { method, headers: { origin: url, "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
    return { status: response.status, body: await response.json() as any };
  };
  const bot = (await api("GET", "/api/bots")).body.bots[0];
  await api("PATCH", `/api/bots/${bot.id}`, { chiefOfStaff: false });
  const context = (await api("GET", "/api/auth/session")).body.manualRoutineRequests.contextId;
  const collection = { kind: "web-collection", version: 1, sources: [{ url: `http://collection-fixture.invalid:${port}/page#first` },
    { url: `http://collection-fixture.invalid:${port}/page#second` }], limits: { pages: 2, pageBytes: 1024, bytes: 2048, attempts: 2, durationMs: 30_000 } };
  const make = (extra = {}) => api("POST", "/api/routines", { name: "Synthetic collection", prompt: "Literal display instructions", botId: bot.id,
    enabled: false, schedule: { type: "cron", expression: "0 0 1 1 *", timeZone: "UTC" }, collection, ...extra });
  const start = (id: string, key = "same-intent", headers = {}) => api("POST", `/api/routines/${id}/run-protected`, undefined,
    { "Idempotency-Key": key, "X-Entropybot-Manual-Context": context, ...headers });
  const runs = async () => (await api("GET", "/api/routines")).body.runs as any[];
  const status = async (id: string, value: string) => expect.poll(async () => (await runs()).find(run => run.id === id)?.status, { timeout: 20_000 }).toBe(value);
  return { api, make, start, runs, status, restart, collection, reads, dataDir, bot, release: () => held?.end("held synthetic page"),
    armPublicationCrash: async () => { writeFileSync(join(dataDir, "collection-fixture.json"), JSON.stringify({ port, crashAfterReport: true })); await restart(); } };
}

it("dispatches protected HTTP collection to one durable artifact/report, preserving identity and snapshot after restart", async () => {
  const s = await server();
  const made = await s.make();
  expect(made.status).toBe(201);
  const id = made.body.routine.id;
  expect((await s.api("POST", `/api/routines/${id}/run`)).status).toBe(400);
  expect((await s.api("POST", `/api/routines/${id}/run-protected`)).status).toBe(400);
  expect((await s.start(id, "unauthorized", { authorization: "Bearer omb_sess_invalid_synthetic" })).status).toBe(401);
  expect((await s.start(id, "bad-context", { "X-Entropybot-Manual-Context": `mr1_${"0".repeat(64)}` })).status).toBe(409);
  expect(await s.runs()).toHaveLength(0);
  const [first, retry] = await Promise.all([s.start(id), s.start(id)]);
  expect(first.status).toBe(201); expect(retry.body.run.id).toBe(first.body.run.id);
  await s.status(first.body.run.id, "completed");
  const before = (await s.runs())[0];
  expect(before.report.state).toBe("posted");
  expect(s.reads).toEqual(["/page", "/page"]);
  const directory = join(s.dataDir, "collection-reports");
  const artifacts = readdirSync(directory);
  expect(artifacts).toHaveLength(1);
  const artifact = readFileSync(join(directory, artifacts[0]), "utf8");
  expect(artifact).toContain("synthetic literal page");
  expect(before.output).toContain("Unique: 1");
  expect(existsSync(fixture!.fixtureDumpPath), "typed collection must not call the fake provider").toBe(false);
  const disk = JSON.parse(readFileSync(join(s.dataDir, "routines.json"), "utf8"));
  expect(disk.routineRequestReceipts).toHaveLength(1);
  const requestId = disk.routineRequestReceipts[0].requestId;
  await s.restart("SIGKILL");
  expect((await s.start(id)).body.run.id).toBe(before.id);
  expect((await s.runs())[0]).toMatchObject({ collection: before.collection, report: before.report });
  expect(JSON.parse(readFileSync(join(s.dataDir, "routines.json"), "utf8")).routineRequestReceipts[0].requestId).toBe(requestId);
  expect(readFileSync(join(directory, artifacts[0]), "utf8")).toBe(artifact);
  expect(s.reads).toHaveLength(2);
  const messages = (await s.api("GET", `/api/threads/${before.resultsThreadId}/messages?limit=200`)).body.messages;
  expect(messages.filter((message: any) => message.automation?.runId === before.id)).toHaveLength(1);
  const changed = { ...s.collection, limits: { ...s.collection.limits, attempts: 1 } };
  expect((await s.api("PATCH", `/api/routines/${id}`, { collection: changed })).status).toBe(200);
  expect((await s.start(id)).status).toBe(409);
  expect(await s.runs()).toHaveLength(1);
}, 90_000);

it("reconciles a real process death after durable report append, publishing once without rereading", async () => {
  const s = await server();
  await s.armPublicationCrash();
  const made = await s.make();
  const first = await s.start(made.body.routine.id);
  expect(first.status).toBe(201);
  const marker = join(s.dataDir, "collection-report-committed.json");
  await expect.poll(() => existsSync(marker), { timeout: 20_000 }).toBe(true);
  await waitForExit(child);
  const committed = JSON.parse(readFileSync(marker, "utf8"));
  expect(committed.runId).toBe(first.body.run.id);
  const interrupted = JSON.parse(readFileSync(join(s.dataDir, "routines.json"), "utf8")).runs[0];
  expect(interrupted.status).toBe("running");
  expect(interrupted.report.state).toBe("pending");
  await s.restart();
  await s.status(first.body.run.id, "completed");
  const replay = await s.start(made.body.routine.id);
  expect(replay.body.run.id).toBe(first.body.run.id);
  expect(s.reads).toEqual(["/page", "/page"]);
  const messages = (await s.api("GET", `/api/threads/${committed.threadId}/messages?limit=200`)).body.messages;
  const published = messages.filter((message: any) => message.automation?.runId === first.body.run.id);
  expect(published).toHaveLength(1);
  expect(published[0].id).toBe(committed.messageId);
  expect(readdirSync(join(s.dataDir, "collection-reports"))).toHaveLength(1);
  expect(existsSync(fixture!.fixtureDumpPath)).toBe(false);
}, 90_000);

it("never resends a read with unknown outcome after server death and keeps the original admitted plan", async () => {
  const s = await server();
  const plan = { ...s.collection, sources: [{ url: s.collection.sources[0].url.replace("/page#first", "/hold") }] };
  const made = await s.make({ collection: plan });
  expect(made.status).toBe(201);
  const id = made.body.routine.id;
  const unrelated = await s.make({ name: "Ordering control", collection: undefined });
  expect(unrelated.status).toBe(201);
  const controlID = "ordering-control-no-collection";
  const diskPath = join(s.dataDir, "routines.json");
  const disk = () => JSON.parse(readFileSync(diskPath, "utf8"));
  await s.restart("SIGTERM", () => {
    const saved = disk();
    saved.runs.push({ id: controlID, routineId: unrelated.body.routine.id, routineName: "Ordering control",
      botId: s.bot.id, target: "bot", runOn: "maus", status: "cancelled", manual: false,
      scheduledFor: Date.now() + 86_400_000, createdAt: Date.now(), finishedAt: Date.now() });
    writeFileSync(diskPath, JSON.stringify(saved), { mode: 0o600 });
  });
  const first = await s.start(id);
  expect(first.status).toBe(201);
  const admittedID = first.body.run.id;
  expect(admittedID).not.toBe(controlID);
  await expect.poll(() => s.reads).toEqual(["/hold"]);
  const snapshots: unknown[] = [];
  const snapshot = async (stage: string) => {
    const apiRuns = await s.runs();
    const saved = disk();
    const admitted = apiRuns.find(run => run.id === admittedID);
    const persisted = saved.runs.find((run: any) => run.id === admittedID);
    const evidence = { stage, admittedID, rowzeroID: apiRuns[0]?.id, allrunIDs: apiRuns.map(run => run.id),
      apiPlan: admitted?.collection, diskPlan: persisted?.collection, apiStatus: admitted?.status, diskStatus: persisted?.status,
      diskRuns: saved.runs, receipts: saved.routineRequestReceipts };
    snapshots.push(evidence);
    console.info("collectionRestartEvidence=" + JSON.stringify(evidence));
    expect(apiRuns).toHaveLength(2);
    expect(apiRuns[0].id).toBe(controlID);
    expect(apiRuns[0].routineId).toBe(unrelated.body.routine.id);
    expect(apiRuns[0].scheduledFor).toBeGreaterThan(admitted.scheduledFor);
    expect(apiRuns[0].collection).toBeUndefined();
    expect(apiRuns[0].collection).not.toEqual(plan);
    expect(admitted.collection).toEqual(plan);
    expect(persisted.collection).toEqual(plan);
    return saved;
  };
  const before = await snapshot("prekill");
  expect(before.routineRequestReceipts).toHaveLength(1);
  expect(before.routineRequestReceipts[0]).toMatchObject({ origin: "http", routineId: id, resultId: admittedID });
  expect(before.routineRequestReceipts[0].requestId).toEqual(expect.any(String));
  const retry = await s.start(id);
  expect(retry.status).toBe(201);
  expect(retry.body.run.id).toBe(admittedID);
  expect((await s.api("PATCH", `/api/routines/${id}`, { collection: s.collection })).status).toBe(200);
  await snapshot("prekill-after-plan-change");
  await s.restart("SIGKILL");
  await snapshot("postload");
  await s.status(admittedID, "failed");
  const failed = await snapshot("postfailure");
  expect(failed.routineRequestReceipts).toEqual(before.routineRequestReceipts);
  expect((await s.start(id)).status).toBe(409);
  expect((await s.api("PATCH", `/api/routines/${id}`, { collection: plan })).status).toBe(200);
  const recovered = await s.start(id);
  expect(recovered.status).toBe(201);
  expect(recovered.body.run.id).toBe(admittedID);
  expect((await s.api("PATCH", `/api/routines/${id}`, { collection: s.collection })).status).toBe(200);
  expect((await s.start(id)).status).toBe(409);
  const afterChange = await snapshot("changed-plan-old-key-rejected");
  expect(afterChange.routineRequestReceipts).toEqual(before.routineRequestReceipts);
  expect(s.reads).toEqual(["/hold"]);
  expect(existsSync(fixture!.fixtureDumpPath)).toBe(false);
  console.info("collectionRestartControl=" + JSON.stringify({ admittedID, controlID, snapshots, sourceReads: s.reads }));
}, 90_000);

it("rejects automated collection configurations before admission and retains finite cumulative budgets", async () => {
  const s = await server();
  for (const extra of [{ enabled: true }, { runOnStartup: true }, { runOn: "cloud" }, { target: "room-goal" },
    { collection: { ...s.collection, version: 2 } },
    { collection: { ...s.collection, sources: [{ url: "https://user:password@fixture.invalid/" }] } },
    { collection: { ...s.collection, sources: [{ url: "https://fixture.invalid/", html: "injected fixture" }] } },
    { collection: { ...s.collection, outputRoot: "/untrusted" } }]) expect((await s.make(extra)).status).toBe(400);
  const made = await s.make({ collection: { ...s.collection, limits: { ...s.collection.limits, attempts: 1 } } });
  expect(made.status).toBe(201);
  const first = await s.start(made.body.routine.id);
  await s.status(first.body.run.id, "failed");
  expect(s.reads).toEqual(["/page"]);
  await s.restart();
  expect((await s.start(made.body.routine.id)).body.run.id).toBe(first.body.run.id);
  expect(s.reads).toEqual(["/page"]);
  expect(existsSync(fixture!.fixtureDumpPath)).toBe(false);
}, 90_000);

it("cancels the actual guarded read and retains its reservation without resending on retry", async () => {
  const s = await server();
  const made = await s.make({ collection: { ...s.collection, sources: [{ url: s.collection.sources[0].url.replace("/page#first", "/hold") }] } });
  const first = await s.start(made.body.routine.id);
  await expect.poll(() => s.reads).toEqual(["/hold"]);
  expect((await s.api("POST", `/api/routine-runs/${first.body.run.id}/cancel`)).status).toBe(200);
  s.release();
  await s.status(first.body.run.id, "cancelled");
  await s.restart();
  expect((await s.start(made.body.routine.id)).body.run.id).toBe(first.body.run.id);
  expect(s.reads).toEqual(["/hold"]);
  expect(existsSync(fixture!.fixtureDumpPath)).toBe(false);
}, 90_000);
