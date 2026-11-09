// @vitest-environment happy-dom
import { act, createElement, type Dispatch } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreProvider, useStore, initialState, type Action, type Bot } from "./store";
import { EventDetails } from "../components/RoutineCalendarPage";
import type { Routine } from "../lib/routines";
import { MANUAL_RUN_STORAGE } from "./routine-run-intent";
import { testManualRunLocks } from "../testing/manual-run-locks";

vi.mock("@/lib/live-events", async (original) => ({ ...await original<typeof import("@/lib/live-events")>(), openLiveEvents: () => () => {} }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
const bot: Bot = { id: "bot", threadId: "thread", name: "Fixture", title: "", description: "", color: "green", notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "fake", model: "fake" } };
const routine: Routine = { id: "routine", botId: bot.id, name: "Fixture", prompt: "Synthetic", target: "bot", runOn: "maus", enabled: true, schedule: { type: "interval", everyMinutes: 60, anchorAt: 1 }, durationMinutes: 30, nextRunAt: null, createdAt: 1, updatedAt: 1 };
const contextId = `mr1_${"a".repeat(64)}`;
const json = (body: unknown) => new Response(JSON.stringify(body));
const run = { id: "22222222-2222-4222-8222-222222222222", routineId: routine.id, routineName: routine.name, botId: bot.id, target: "bot", runOn: "maus", status: "queued", manual: true, triggerSource: "manual", createdAt: 1, scheduledFor: 1 };
let root: Root | undefined;
let host: HTMLDivElement;
let dispatch: Dispatch<Action>;
let posts: RequestInit[];
let answer: () => Promise<Response>;
let currentContext: string;
let profile: Promise<Response>;
const flush = async () => { await act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); }); };
function mount(details = false) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  function Capture() {
    dispatch = useStore().dispatch;
    return details ? createElement(EventDetails, { item: { kind: "routine", id: "fixture", at: Date.now(), durationMinutes: 30, routine, run: null }, bots: [bot], onClose: vi.fn(), onEdit: vi.fn(), onCallChanged: vi.fn(), onOpenRoom: vi.fn() }) : null;
  }
  act(() => root!.render(createElement(StoreProvider, null, createElement(Capture))));
}
function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  expect(button, host.textContent ?? "").toBeTruthy(); act(() => button!.click());
}
beforeEach(() => {
  vi.spyOn(navigator, "locks", "get").mockReturnValue(testManualRunLocks());
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear();
  initialState.bots = [bot]; initialState.routines = [routine]; posts = []; currentContext = contextId;
  answer = async () => json({ run }); profile = Promise.resolve(json({ bot }));
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (path, init) => {
    if (path === "/.well-known/entropybot/environment") return json({ environmentId: "11111111-1111-4111-8111-111111111111", capabilities: { manualRoutineRequests: 1 } });
    if (path === "/api/auth/session") return json({ kind: "loopback", manualRoutineRequests: { version: 1, contextId: currentContext } });
    if (path === "/api/bots/bot") return profile;
    if (path === "/api/routines/routine/run-protected") { posts.push(init!); return answer(); }
    if (typeof path === "string" && path.startsWith("/api/bots?")) return json({ bots: [bot], groups: [] });
    if (typeof path === "string" && path.startsWith("/api/routines?")) return json({ routines: [routine], runs: [] });
    if (path === "/api/instances") return json({ instances: [] });
    if (path === "/api/config") return json({});
    if (path === "/api/webhooks") return json({ webhooks: [] });
    if (path === "/api/notifications") return json({ notifications: [] });
    if (path === "/api/live/call") return json({ call: null });
    throw Error(`Unexpected fixture request ${path}`);
  }));
});
afterEach(() => {
  if (root) act(() => root!.unmount()); root = undefined; host?.remove(); initialState.bots = []; initialState.routines = [];
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
});
const key = (i: number) => new Headers(posts[i].headers).get("Idempotency-Key");

function stallMetadataFetch(phase: "initial" | "post-settings", endpoint: "environment" | "session", subscribers = 2) {
  const original = fetch;
  const counts = { environment: 0, session: 0 };
  const calls: { endpoint: string; ordinal: number; init: RequestInit | undefined }[] = [];
  const stalledOrdinal = phase === "initial" ? 1 : subscribers + 1;
  let release: (() => Promise<void>) | undefined;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>((path, init) => {
    const name = path === "/.well-known/entropybot/environment" ? "environment" : path === "/api/auth/session" ? "session" : null;
    if (name) {
      const ordinal = ++counts[name];
      calls.push({ endpoint: name, ordinal, init });
      if (name === endpoint && ordinal === stalledOrdinal) return new Promise<Response>((resolve) => {
        release = async () => { resolve(await original(path, init)); };
      });
    }
    return original(path, init);
  }));
  return {
    calls, stalledOrdinal,
    release: async () => { const pending = release; release = undefined; await pending?.(); },
  };
}

const preflightCases = (["initial", "post-settings"] as const).flatMap((phase) =>
  (["environment", "session"] as const).flatMap((endpoint) => [false, true].map((priorPending) => [phase, endpoint, priorPending] as const)));

describe("actual StoreProvider and routine details consumer", () => {
  it("refuses joined Retry subscribers for a replacement held behind settings without clearing details uncertainty", async () => {
    const originalKey = crypto.randomUUID();
    localStorage.setItem(MANUAL_RUN_STORAGE, JSON.stringify({ version: 1, entries: [{
      environmentId: "11111111-1111-4111-8111-111111111111", contextId, routineId: routine.id, key: originalKey, phase: "pending",
    }] }));
    let release!: (response: Response) => void;
    profile = new Promise((resolve) => { release = resolve; }); mount(true);
    const replacementStarted = vi.fn(); const retry = { onStarted: vi.fn(), onError: vi.fn(), onSettled: vi.fn() };
    act(() => {
      dispatch({ type: "updateBot", botId: bot.id, patch: { title: "Saved" } });
      dispatch({ type: "runRoutine", routineId: routine.id, acknowledgePriorRun: true, onStarted: replacementStarted });
    });
    await flush(); expect(posts).toHaveLength(0);
    click("Retry");
    act(() => dispatch({ type: "runRoutine", routineId: routine.id, acknowledgePriorRun: false, ...retry }));
    await flush(); expect(retry.onSettled).not.toHaveBeenCalled();
    release(json({ bot: { ...bot, title: "Saved" } })); await flush();
    expect(replacementStarted).toHaveBeenCalledExactlyOnceWith(run);
    expect(retry.onStarted).not.toHaveBeenCalled();
    expect(retry.onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reason: "blocked" }));
    expect(retry.onSettled).toHaveBeenCalledOnce();
    expect(posts).toHaveLength(1); expect(key(0)).not.toBe(originalKey);
    expect(JSON.parse(localStorage.getItem(MANUAL_RUN_STORAGE)!).entries[0]).toMatchObject({ key: key(0), phase: "confirmed" });
    expect(host.textContent).toContain("Retry"); expect(host.textContent).toContain("Start another run…");
  });
  it.each(["null", "getter", "method", "rejection"])("shows explicit %s coordination feedback without dispatching", async (failure) => {
    const getter = vi.spyOn(navigator, "locks", "get");
    if (failure === "getter") getter.mockImplementation(() => { throw Error("denied"); });
    else getter.mockReturnValue((failure === "null" ? null : { request: () => {
      if (failure === "method") throw Error("denied");
      return Promise.reject(Error("denied"));
    } }) as unknown as LockManager);
    mount(true); click("Run now"); await flush();
    expect(host.textContent).toContain("This browser could not safely coordinate task runs.");
    expect(host.textContent).toContain("HTTPS"); expect(posts).toHaveLength(0);
    expect(host.textContent).toContain("Run now"); expect(host.textContent).not.toContain("Start another run…");
    expect(localStorage.getItem(MANUAL_RUN_STORAGE)).toBeNull();
  });
  it("settles all subscribers at the lock deadline, permits cancellation, and cannot dispatch a late grant", async () => {
    let grant!: LockGrantedCallback<unknown>;
    vi.spyOn(navigator, "locks", "get").mockReturnValue({ request: (_name: string, _options: LockOptions, callback: LockGrantedCallback<unknown>) => {
      grant = callback; return new Promise(() => {});
    } } as unknown as LockManager);
    const original = fetch; const cancelled = vi.fn();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>((path, init) => {
      if (path === `/api/routine-runs/${run.id}/cancel`) { cancelled(); return Promise.resolve(json({})); }
      return original(path, init);
    }));
    mount(); const subscribers = [0, 1].map(() => ({ onError: vi.fn(), onSettled: vi.fn() }));
    act(() => subscribers.forEach((subscriber) => dispatch({ type: "runRoutine", routineId: routine.id, ...subscriber })));
    await flush(); expect(grant).toBeTypeOf("function");
    act(() => dispatch({ type: "cancelRoutineRun", runId: run.id })); await flush();
    expect(cancelled).toHaveBeenCalledOnce(); expect(posts).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); await flush();
    for (const subscriber of subscribers) {
      expect(subscriber.onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reason: "coordination" }));
      expect(subscriber.onSettled).toHaveBeenCalledOnce();
    }
    expect(() => grant({} as Lock)).toThrow(); await flush(); expect(posts).toHaveLength(0);
  });
  it.each(preflightCases)("settles subscribers after a stalled %s %s preflight (prior pending: %s)", async (phase, endpoint, priorPending) => {
    mount();
    if (priorPending) {
      answer = async () => { throw Error("lost response"); };
      act(() => dispatch({ type: "runRoutine", routineId: routine.id, onError: vi.fn() })); await flush();
    }
    answer = async () => json({ run });
    const previousPosts = posts.length, previousMarker = localStorage.getItem(MANUAL_RUN_STORAGE);
    const stall = stallMetadataFetch(phase, endpoint);
    const callbacks = [0, 1].map(() => ({ onStarted: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }));
    try {
      act(() => { for (const subscription of callbacks) dispatch({ type: "runRoutine", routineId: routine.id, ...subscription }); });
      await flush();
      expect(posts).toHaveLength(previousPosts);
      for (const subscription of callbacks) expect(subscription.onSettled).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); await flush();
      expect(posts).toHaveLength(previousPosts);
      expect(localStorage.getItem(MANUAL_RUN_STORAGE)).toBe(previousMarker);
      for (const subscription of callbacks) {
        expect(subscription.onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reason: "blocked" }));
        expect(subscription.onSettled).toHaveBeenCalledTimes(1); expect(subscription.onStarted).not.toHaveBeenCalled();
      }
      const pair = stall.calls.filter((call) => call.ordinal === stall.stalledOrdinal);
      expect(pair).toHaveLength(2);
      for (const call of pair) {
        expect(call.init?.cache).toBe("no-store"); expect(call.init?.credentials).toBe("same-origin");
        expect(call.init?.signal?.aborted).toBe(true);
      }
      await stall.release(); await flush(); expect(posts).toHaveLength(previousPosts);
      const onStarted = vi.fn();
      act(() => dispatch({ type: "runRoutine", routineId: routine.id, onStarted })); await flush();
      expect(onStarted).toHaveBeenCalledExactlyOnceWith(run); expect(posts).toHaveLength(previousPosts + 1);
      if (priorPending) expect(key(previousPosts)).toBe(key(0));
      expect(new Headers(posts[previousPosts].headers).get("X-Entropybot-Manual-Context")).toBe(contextId);
      for (const subscription of callbacks) expect(subscription.onSettled).toHaveBeenCalledTimes(1);
    } finally { await stall.release(); await flush(); }
  });
  it.each(["initial", "post-settings"] as const)("releases the details busy state after a stalled %s preflight", async (phase) => {
    mount(true); const stall = stallMetadataFetch(phase, "session", 1);
    try {
      click("Run now"); await flush();
      expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Starting…")?.disabled).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); await flush();
      expect(posts).toHaveLength(0);
      expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Run now")?.disabled).toBe(false);
      await stall.release(); await flush(); expect(posts).toHaveLength(0);
      click("Run now"); await flush(); expect(posts).toHaveLength(1);
    } finally { await stall.release(); await flush(); }
  });
  it("notifies every coalesced subscriber once after the settings barrier", async () => {
    let release!: (res: Response) => void; profile = new Promise((done) => { release = done; }); mount();
    const first = { onStarted: vi.fn(), onError: vi.fn(), onSettled: vi.fn() };
    const second = { onStarted: vi.fn(), onError: vi.fn(), onSettled: vi.fn() };
    act(() => { dispatch({ type: "updateBot", botId: bot.id, patch: { title: "Saved" } }); dispatch({ type: "runRoutine", routineId: routine.id, ...first }); dispatch({ type: "runRoutine", routineId: routine.id, ...second }); });
    await flush(); expect(posts).toHaveLength(0); expect(first.onSettled).not.toHaveBeenCalled();
    release(json({ bot: { ...bot, title: "Saved" } })); await flush(); expect(posts).toHaveLength(1);
    for (const callbacks of [first, second]) { expect(callbacks.onStarted).toHaveBeenCalledExactlyOnceWith(run); expect(callbacks.onError).not.toHaveBeenCalled(); expect(callbacks.onSettled).toHaveBeenCalledTimes(1); }
  });
  it("fans unknown outcomes to every subscriber and retains identity after provider unmount", async () => {
    mount(); answer = async () => { throw Error("lost"); };
    const errors = [vi.fn(), vi.fn()]; const settled = [vi.fn(), vi.fn()];
    act(() => { for (let i = 0; i < 2; i++) dispatch({ type: "runRoutine", routineId: routine.id, onError: errors[i], onSettled: settled[i] }); });
    await flush(); for (let i = 0; i < 2; i++) { expect(errors[i]).toHaveBeenCalledTimes(1); expect(settled[i]).toHaveBeenCalledTimes(1); }
    act(() => root!.unmount()); root = undefined; host.remove(); mount(); answer = async () => json({ run });
    act(() => dispatch({ type: "runRoutine", routineId: routine.id })); await flush(); expect(key(1)).toBe(key(0));
  });
  it("rejects a scope change while waiting for saved settings", async () => {
    let release!: (res: Response) => void; profile = new Promise((done) => { release = done; }); mount(); const onError = vi.fn();
    act(() => { dispatch({ type: "updateBot", botId: bot.id, patch: { title: "Saved" } }); dispatch({ type: "runRoutine", routineId: routine.id, onError }); });
    await flush(); currentContext = `mr1_${"b".repeat(64)}`; release(json({ bot })); await flush();
    expect(posts).toHaveLength(0); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ reason: "changed" }));
  });
  it("does not subscribe a changed account to an old in-flight response", async () => {
    mount(); let release!: (res: Response) => void; answer = () => new Promise((done) => { release = done; });
    const oldStarted = vi.fn(), newStarted = vi.fn(), onError = vi.fn();
    act(() => dispatch({ type: "runRoutine", routineId: routine.id, onStarted: oldStarted })); await flush();
    currentContext = `mr1_${"b".repeat(64)}`;
    act(() => dispatch({ type: "runRoutine", routineId: routine.id, onStarted: newStarted, onError })); await flush();
    expect(posts).toHaveLength(1); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ reason: "changed" }));
    release(json({ run })); await flush(); expect(oldStarted).toHaveBeenCalledTimes(1); expect(newStarted).not.toHaveBeenCalled();
  });
  it.each(["Retry", "Start another run…"])("recovers confirmed-readback uncertainty through the real %s control", async (control) => {
    mount(true);
    const storage = localStorage;
    let failNextRead = false, failures = 0;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => {
        if (key === MANUAL_RUN_STORAGE && failNextRead) { failNextRead = false; failures++; throw Error("readback denied"); }
        return storage.getItem(key);
      },
      setItem: (key: string, value: string) => {
        storage.setItem(key, value);
        if (key === MANUAL_RUN_STORAGE && failures === 0 && JSON.parse(value).entries.some((entry: { phase: string }) => entry.phase === "confirmed")) failNextRead = true;
      },
    });
    click("Run now"); await flush();
    expect(failures).toBe(1); expect(posts).toHaveLength(1);
    expect(JSON.parse(storage.getItem(MANUAL_RUN_STORAGE)!).entries[0].phase).toBe("confirmed");
    expect(host.textContent).toContain("previous request may already have run");
    if (control === "Start another run…") {
      const confirm = vi.fn().mockReturnValue(false); window.confirm = confirm;
      click(control); await flush(); expect(posts).toHaveLength(1);
      confirm.mockReturnValue(true); click(control); await flush();
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining("will not be cancelled"));
      expect(posts).toHaveLength(2); expect(key(1)).not.toBe(key(0));
    } else {
      answer = async () => { throw Error("lost replay response"); }; click(control); await flush();
      expect(key(1)).toBe(key(0));
      answer = async () => json({ run }); click(control); await flush(); expect(key(2)).toBe(key(0));
      expect(host.textContent).not.toContain("Start another run…");
      click("Run now"); await flush(); expect(key(3)).not.toBe(key(0));
    }
    expect(JSON.parse(storage.getItem(MANUAL_RUN_STORAGE)!).entries[0].phase).toBe("confirmed");
  });
  it("restores readback uncertainty in a new provider before allowing a deliberate new operation", async () => {
    mount(true);
    const storage = localStorage;
    let failNext = false, failed = false;
    vi.stubGlobal("localStorage", {
      getItem: (name: string) => {
        if (failNext) { failNext = false; failed = true; throw Error("readback denied"); }
        return storage.getItem(name);
      },
      setItem: (name: string, value: string) => {
        storage.setItem(name, value);
        if (!failed && JSON.parse(value).entries[0].phase === "confirmed") failNext = true;
      },
    });
    click("Run now"); await flush(); expect(failed).toBe(true);
    act(() => root!.unmount()); root = undefined; host.remove(); mount(true);
    expect(host.textContent).toContain("previous request may already have run");
    expect(posts).toHaveLength(1);
    click("Retry"); await flush(); expect(key(1)).toBe(key(0));
    click("Run now"); await flush(); expect(key(2)).not.toBe(key(0));
  });
  it.each([false, true])("fences a late response after provider unmount (replace: %s)", async (replace) => {
    mount(true); let release!: (response: Response) => void;
    answer = () => new Promise((resolve) => { release = resolve; });
    click("Run now"); await flush(); expect(posts).toHaveLength(1);
    act(() => root!.unmount()); root = undefined; host.remove(); mount(true);
    answer = async () => json({ run });
    if (replace) {
      window.confirm = vi.fn().mockReturnValue(true);
      click("Start another run…"); await flush(); expect(key(1)).not.toBe(key(0));
    }
    const stored = localStorage.getItem(MANUAL_RUN_STORAGE)!;
    release(json({ run })); await flush(); expect(posts).toHaveLength(replace ? 2 : 1);
    if (replace) expect(localStorage.getItem(MANUAL_RUN_STORAGE)).toBe(stored);
    else {
      click("Retry"); await flush(); expect(key(1)).toBe(key(0));
      click("Run now"); await flush(); expect(key(2)).not.toBe(key(0));
    }
  });
  it("reconciles again after closing and reopening details in the same provider", async () => {
    mount(true); click("Run now"); await flush();
    act(() => root!.render(createElement(StoreProvider, null)));
    function Details() { return createElement(EventDetails, { item: { kind: "routine", id: "reopened", at: Date.now(), durationMinutes: 30, routine, run: null }, bots: [bot], onClose: vi.fn(), onEdit: vi.fn(), onCallChanged: vi.fn(), onOpenRoom: vi.fn() }); }
    act(() => root!.render(createElement(StoreProvider, null, createElement(Details))));
    click("Retry"); await flush(); expect(key(1)).toBe(key(0));
    click("Run now"); await flush(); expect(key(2)).not.toBe(key(0));
  });
  it("renders unknown/retry/success/new-run through the real details button", async () => {
    mount(true); answer = async () => { throw Error("lost"); }; click("Run now"); await flush();
    expect(host.textContent).toContain("previous request may already have run");
    answer = async () => json({ run }); click("Retry"); await flush(); expect(key(1)).toBe(key(0));
    click("Run now"); await flush(); expect(key(2)).not.toBe(key(1));
  });
  it("requires explicit acknowledgement before intentionally replacing an unknown request", async () => {
    mount(true); answer = async () => { throw Error("lost"); }; click("Run now"); await flush();
    const confirm = vi.fn().mockReturnValue(false); window.confirm = confirm; click("Start another run…"); await flush(); expect(posts).toHaveLength(1);
    confirm.mockReturnValue(true); answer = async () => json({ run }); click("Start another run…"); await flush();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("will not be cancelled")); expect(key(1)).not.toBe(key(0));
    expect(JSON.parse(localStorage.getItem(MANUAL_RUN_STORAGE)!).entries[0].phase).toBe("confirmed");
  });
});
