import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readdirSync, writeFileSync, renameSync, unlinkSync, symlinkSync, linkSync, truncateSync, mkdirSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
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
  const restart = async (signal: "SIGTERM" | "SIGKILL" = "SIGTERM") => {
    await waitForExit(child ?? fixture!.child, { signal });
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
  const defaultBot = (await api("GET", "/api/bots")).body.bots.find((candidate: any) => candidate.defaultBot);
  expect(defaultBot).toBeDefined();
  expect((await api("PATCH", `/api/bots/${defaultBot.id}`, { chiefOfStaff: false })).status).toBe(200);
  const refused = await api("DELETE", `/api/bots/${defaultBot.id}`);
  expect(refused.status).toBe(409);
  expect(refused.body.error).toContain("can't be deleted or archived");
  console.info("defaultBotDeletionEvidence=" + JSON.stringify({ botId: defaultBot.id, response: refused }));
  const created = await api("POST", "/api/bots", { name: "Ordinary collection reader fixture" });
  expect(created.status).toBe(201);
  const bot = created.body.bot;
  expect(bot.defaultBot).toBeUndefined();
  expect(bot.chiefOfStaff).not.toBe(true);
  const context = (await api("GET", "/api/auth/session")).body.manualRoutineRequests.contextId;
  const collection = { kind: "web-collection", version: 1, sources: [{ url: `http://collection-fixture.invalid:${port}/page#first` }],
    limits: { pages: 1, pageBytes: 1024, bytes: 2048, attempts: 2, durationMs: 30_000 } };
  const make = (extra = {}) => api("POST", "/api/routines", { name: "Synthetic collection", prompt: "Literal display instructions", botId: bot.id,
    enabled: false, schedule: { type: "cron", expression: "0 0 1 1 *", timeZone: "UTC" }, collection, ...extra });
  const start = (id: string, key = "same-intent", headers = {}) => api("POST", `/api/routines/${id}/run-protected`, undefined,
    { "Idempotency-Key": key, "X-Entropybot-Manual-Context": context, ...headers });
  const runs = async () => (await api("GET", "/api/routines")).body.runs as any[];
  const status = async (id: string, value: string) => expect.poll(async () => (await runs()).find(run => run.id === id)?.status, { timeout: 20_000 }).toBe(value);
  return { api, make, start, runs, status, restart, collection, reads, dataDir, bot, release: () => held?.end("held synthetic page"),
    armPublicationCrash: async () => { writeFileSync(join(dataDir, "collection-fixture.json"), JSON.stringify({ port, crashAfterReport: true })); await restart(); } };
}

it("reads the original production artifact through authenticated HTTP and rejects unsafe files without rereading", async () => {
  const s = await server();
  const made = await s.make();
  expect(made.status).toBe(201);
  const id = made.body.routine.id;
  const admitted = await s.start(id);
  expect(admitted.status).toBe(201);
  const run = admitted.body.run;
  await s.status(run.id, "completed");
  const route = `/api/routines/${id}/runs/${run.id}/collection-report`;
  const directory = join(s.dataDir, "collection-reports");
  const file = join(directory, readdirSync(directory)[0]);
  const bytes = readFileSync(file);
  const first = await s.api("GET", route);
  expect(first.status).toBe(200);
  expect(first.body).toEqual({ version: 1, unique: 1,
    hash: createHash("sha256").update(bytes).digest("hex"), pages: 1,
    sources: [{ url: s.collection.sources[0].url.split("#")[0], text: "<p>synthetic literal page</p>" }] });
  expect(JSON.stringify(first.body)).not.toContain(s.dataDir);
  const opened = await s.api("POST", "/api/auth/pairing", { label: "Synthetic report reader", scopes: ["client"] });
  expect(opened.status).toBe(200);
  const paired = await s.api("POST", "/api/auth/pair", { code: opened.body.code });
  expect(paired.body.token).toMatch(/^omb_sess_/);
  const memberHeaders = { authorization: `Bearer ${paired.body.token}` };
  expect((await s.api("GET", route, undefined, memberHeaders)).body).toEqual(first.body);
  expect((await s.api("PATCH", `/api/bots/${s.bot.id}`, { visibility: "admins" })).status).toBe(200);
  expect((await s.api("GET", route, undefined, memberHeaders)).status).toBe(404);
  expect((await s.api("PATCH", `/api/bots/${s.bot.id}`, { visibility: "everyone" })).status).toBe(200);
  expect((await s.api("GET", route, undefined, { authorization: "Bearer omb_sess_invalid_synthetic" })).status).toBe(401);
  expect((await s.api("GET", route.replace(id, "wrong-routine"))).status).toBe(404);
  expect((await s.api("GET", route.replace(run.id, "wrong-run"))).status).toBe(404);
  expect((await s.api("GET", route + "?path=%2Fetc%2Fpasswd")).status).toBe(400);
  const reject = async () => {
    const result = await s.api("GET", route);
    expect(result).toEqual({ status: 409, body: { code: "collection_report_invalid", error: "Collection report could not be verified." } });
  };
  const backup = file + ".owned-backup";
  renameSync(file, backup);
  await reject();
  symlinkSync(backup, file); await reject(); unlinkSync(file);
  linkSync(backup, file); await reject(); unlinkSync(file);
  execFileSync("/usr/bin/mkfifo", [file]); await reject(); unlinkSync(file);
  mkdirSync(file); await reject(); execFileSync("/bin/rmdir", [file]);
  writeFileSync(file, "{broken"); await reject(); unlinkSync(file);
  writeFileSync(file, Buffer.from(bytes.toString().replace("literal", "changed"))); await reject(); unlinkSync(file);
  writeFileSync(file, ""); truncateSync(file, 62_000_000); await reject(); unlinkSync(file);
  renameSync(backup, file);
  expect((await s.api("GET", route)).body).toEqual(first.body);
  const rootBackup = directory + ".owned-backup";
  renameSync(directory, rootBackup); symlinkSync(rootBackup, directory); await reject(); unlinkSync(directory); renameSync(rootBackup, directory);
  const changed = { ...s.collection, sources: [{ url: s.collection.sources[0].url.replace("/page", "/different") }] };
  expect((await s.api("PATCH", `/api/routines/${id}`, { collection: changed })).status).toBe(200);
  expect((await s.api("GET", route)).body).toEqual(first.body);
  expect((await s.api("DELETE", `/api/routines/${id}`)).status).toBe(200);
  expect(await s.api("GET", route)).toEqual(first);
  expect(s.reads).toEqual(["/page"]);
  expect(readFileSync(file)).toEqual(bytes);
  console.info("collectionReportEvidence=" + JSON.stringify({ artifactBase64: bytes.toString("base64"), response: first.body,
    typedRun: (await s.runs()).find(candidate => candidate.id === run.id), sourceReads: s.reads, artifactSha256: createHash("sha256").update(bytes).digest("hex") }));
  expect(existsSync(fixture!.fixtureDumpPath)).toBe(false);
  expect((await s.api("GET", route, undefined, { origin: "https://unpaired.invalid" })).status).toBe(403);
  expect((await s.api("GET", route, undefined, { authorization: "Bearer synthetic-bot-token" })).status).toBe(401);
  expect((await s.api("DELETE", `/api/bots/${s.bot.id}`)).status).toBe(200);
  const deleted = await s.api("GET", route);
  expect(deleted.status).toBe(404);
  expect(deleted.body.code).toBe("collection_report_not_found");
  expect(s.reads).toEqual(["/page"]);
  expect(readFileSync(file)).toEqual(bytes);
  expect(existsSync(fixture!.fixtureDumpPath)).toBe(false);
  console.info("ordinaryBotDeletionEvidence=" + JSON.stringify({ botId: s.bot.id, routineId: id, admittedID: run.id,
    retainedResponse: first, deletedResponse: deleted, sourceReads: s.reads }));
}, 90_000);
