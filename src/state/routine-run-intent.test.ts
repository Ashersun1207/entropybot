// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoutineRunIntents, MANUAL_RUN_STORAGE } from "./routine-run-intent";
import { decodeManualRoutineScope, readSessionState } from "../lib/session";

const contextId = `mr1_${"a".repeat(64)}`;
const environment = { environmentId: "11111111-1111-4111-8111-111111111111", capabilities: { manualRoutineRequests: 1 } };
const session = { kind: "loopback", manualRoutineRequests: { version: 1, contextId } };
const run = { id: "22222222-2222-4222-8222-222222222222", routineId: "routine", routineName: "Fixture", botId: "bot", target: "bot", runOn: "maus", status: "queued", manual: true, triggerSource: "manual", createdAt: 1, scheduledFor: 1 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let posts: RequestInit[];
let answer: () => Promise<Response>;
let auth: unknown;
let env: unknown;
const request = vi.fn<typeof fetch>(async (path, init) => {
  if (path === "/.well-known/entropybot/environment") return json(env);
  if (path === "/api/auth/session") return json(auth);
  expect(path).toBe("/api/routines/routine/run-protected");
  posts.push(init!);
  expect(JSON.parse(localStorage.getItem(MANUAL_RUN_STORAGE)!).entries[0].phase).toBe("pending");
  return answer();
});
const key = (i: number) => new Headers(posts[i].headers).get("Idempotency-Key");
const settings = async () => {};
beforeEach(() => {
  localStorage.clear(); posts = []; auth = structuredClone(session); env = structuredClone(environment);
  answer = async () => json({ run }); vi.stubGlobal("fetch", request); request.mockClear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("protected manual intent", () => {
  it("coalesces concurrent subscribers even when one preflight completes after the response", async () => {
    const owner = createRoutineRunIntents(); const first = owner.run("routine", settings);
    let release!: (response: Response) => void;
    request.mockImplementationOnce(() => new Promise((done) => { release = done; }));
    const second = owner.run("routine", settings);
    await first; expect(posts).toHaveLength(1);
    release(json(environment)); await expect(second).resolves.toEqual(run); expect(posts).toHaveLength(1);
  });
  it("keeps unknown identity through a new owner, then closes only a validated response", async () => {
    answer = async () => { throw new TypeError("lost response"); };
    await expect(createRoutineRunIntents().run("routine", settings)).rejects.toMatchObject({ reason: "unknown" });
    answer = async () => json({ run });
    await expect(createRoutineRunIntents().run("routine", settings)).resolves.toEqual(run);
    expect(key(1)).toBe(key(0));
    await createRoutineRunIntents().run("routine", settings);
    expect(key(2)).not.toBe(key(1));
    expect(new Headers(posts[0].headers).get("X-Entropybot-Manual-Context")).toBe(contextId);
  });
  it.each([401, 409, 429, 404])("does not rotate on HTTP %i or fall back", async (status) => {
    const owner = createRoutineRunIntents(); answer = async () => json({ error: "refused" }, status);
    await expect(owner.run("routine", settings)).rejects.toMatchObject({ reason: "unknown" });
    await expect(owner.run("routine", settings)).rejects.toMatchObject({ reason: "unknown" });
    expect(key(1)).toBe(key(0)); expect(posts).toHaveLength(2);
  });
  it.each([{}, { run: {} }, { run, error: "contradiction" }, { run, ok: false }, { run: { ...run, manual: false } }, { run: { ...run, routineId: "other" } }, { run: { ...run, triggerSource: "webhook" } }, { run: { ...run, webhookId: "event" } }, { run: { ...run, id: "" } }])("does not close contradictory or missing run %j", async (body) => {
    const owner = createRoutineRunIntents(); answer = async () => json(body);
    await expect(owner.run("routine", settings)).rejects.toMatchObject({ reason: "unknown" });
    answer = async () => json({ run }); await owner.run("routine", settings); expect(key(1)).toBe(key(0));
  });
  it("retains malformed JSON and aborted delivery as unknown", async () => {
    const owner = createRoutineRunIntents(); answer = async () => new Response("{");
    await expect(owner.run("routine", settings)).rejects.toMatchObject({ reason: "unknown" });
    answer = async () => { throw new DOMException("timeout", "AbortError"); };
    await expect(owner.run("routine", settings)).rejects.toMatchObject({ reason: "unknown" });
    expect(key(1)).toBe(key(0));
  });
  it("blocks a switch during settings without POST and blocks cross-account recovery", async () => {
    const owner = createRoutineRunIntents();
    await expect(owner.run("routine", async () => { auth = { ...session, manualRoutineRequests: { version: 1, contextId: `mr1_${"b".repeat(64)}` } }; })).rejects.toMatchObject({ reason: "changed" });
    expect(posts).toHaveLength(0);
    auth = session; answer = async () => { throw Error("lost"); };
    await expect(owner.run("routine", settings)).rejects.toThrow();
    const stored = localStorage.getItem(MANUAL_RUN_STORAGE);
    auth = { ...session, manualRoutineRequests: { version: 1, contextId: `mr1_${"b".repeat(64)}` } };
    await expect(createRoutineRunIntents().run("routine", settings)).rejects.toMatchObject({ reason: "changed" });
    expect(localStorage.getItem(MANUAL_RUN_STORAGE)).toBe(stored); expect(posts).toHaveLength(1);
    answer = async () => json({ run }); await createRoutineRunIntents().run("routine", settings, true);
    expect(key(1)).not.toBe(key(0));
  });
  it.each(["{", '{"version":2,"entries":[]}', '{"version":1,"entries":[{}]}'])("fails closed on corrupt or unsupported storage %s", async (raw) => {
    localStorage.setItem(MANUAL_RUN_STORAGE, raw);
    await expect(createRoutineRunIntents().run("routine", settings)).rejects.toMatchObject({ reason: "blocked" });
    expect(posts).toHaveLength(0); expect(localStorage.getItem(MANUAL_RUN_STORAGE)).toBe(raw);
  });
  it("fails closed when storage cannot be read", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw Error("denied"); } });
    await expect(createRoutineRunIntents().run("routine", settings)).rejects.toMatchObject({ reason: "blocked" }); expect(posts).toHaveLength(0);
  });
  it("fails closed when pending persistence is unavailable", async () => {
    const storage = localStorage;
    vi.stubGlobal("localStorage", { getItem: storage.getItem.bind(storage), setItem: () => { throw Error("quota"); } });
    await expect(createRoutineRunIntents().run("routine", settings)).rejects.toThrow(); expect(posts).toHaveLength(0);
  });
  it("retains the same identity after confirmed-state persistence fails", async () => {
    const owner = createRoutineRunIntents(); const storage = localStorage; let writes = 0;
    vi.stubGlobal("localStorage", { getItem: storage.getItem.bind(storage), setItem: (k: string, v: string) => { if (++writes === 2) throw Error("quota"); storage.setItem(k, v); } });
    await expect(owner.run("routine", settings)).rejects.toMatchObject({ reason: "unknown" });
    vi.stubGlobal("localStorage", storage); await owner.run("routine", settings); expect(key(1)).toBe(key(0));
  });
  it.each([{}, { capabilities: { manualRoutineRequests: "1" } }, { ...environment, capabilities: { manualRoutineRequests: 2 } }, { ...environment, environmentId: "label" }])("fails closed on unsupported environment %j", async (value) => {
    env = value; await expect(createRoutineRunIntents().run("routine", settings)).rejects.toMatchObject({ reason: "blocked" }); expect(posts).toHaveLength(0);
  });
  it.each([{}, { ...session, trust: "service" }, { ...session, kind: "unknown" }, { ...session, manualRoutineRequests: { version: 2, contextId } }, { ...session, manualRoutineRequests: { version: 1, contextId: contextId.toUpperCase() } }])("uses strict auth instead of general loopback fallback %j", async (value) => {
    auth = value; expect(decodeManualRoutineScope(environment, value)).toBeNull();
    await expect(createRoutineRunIntents().run("routine", settings)).rejects.toMatchObject({ reason: "blocked" }); expect(posts).toHaveLength(0);
  });
  it("retains protocol metadata on authenticated session reads", async () => {
    expect(await readSessionState(request)).toMatchObject(session);
    auth = { kind: "session", id: "synthetic", scopes: ["client"], manualRoutineRequests: session.manualRoutineRequests };
    expect(await readSessionState(request)).toMatchObject({ manualRoutineRequests: session.manualRoutineRequests });
    expect(decodeManualRoutineScope(environment, auth)).toEqual({ environmentId: environment.environmentId, contextId });
  });
});
