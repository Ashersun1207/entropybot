// @vitest-environment happy-dom
import { act, createElement, type Dispatch } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreProvider, useStore, initialState, type Action, type Bot } from "./store";
import { EventDetails } from "../components/RoutineCalendarPage";
import type { Routine } from "../lib/routines";
import { MANUAL_RUN_STORAGE } from "./routine-run-intent";

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
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear();
  initialState.bots = [bot]; initialState.routines = [routine]; posts = []; currentContext = contextId;
  answer = async () => json({ run }); profile = Promise.resolve(json({ bot }));
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (path, init) => {
    if (path === "/.well-known/entropybot/environment") return json({ environmentId: "11111111-1111-4111-8111-111111111111", capabilities: { manualRoutineRequests: 1 } });
    if (path === "/api/auth/session") return json({ kind: "loopback", manualRoutineRequests: { version: 1, contextId: currentContext } });
    if (path === "/api/bots/bot") return profile;
    if (path === "/api/routines/routine/run-protected") { posts.push(init!); return answer(); }
    throw Error(`Unexpected fixture request ${path}`);
  }));
});
afterEach(() => {
  if (root) act(() => root!.unmount()); root = undefined; host?.remove(); initialState.bots = []; initialState.routines = [];
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
});
const key = (i: number) => new Headers(posts[i].headers).get("Idempotency-Key");

describe("actual StoreProvider and routine details consumer", () => {
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
