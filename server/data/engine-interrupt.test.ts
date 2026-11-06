import { getEventListeners } from "node:events";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Lane, createDataEngine, drainLanes, type DataEngineOptions } from "./engine.ts";
import { DataFailure, type DataEngine } from "./types.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function statement() {
  return { entered: deferred<void>(), dispatch: deferred<void>(), dispatched: deferred<void>(), result: deferred<string>() };
}

class ControlledConnection {
  readonly events: string[] = [];
  readonly statements = new Map<string, ReturnType<typeof statement>>();
  ignoreInterrupt = false;
  private waiting: ReturnType<typeof statement> | null = null;
  private active: ReturnType<typeof statement> | null = null;
  readonly interrupt = vi.fn(() => {
    this.events.push(`interrupt:${this.active ? "running" : this.waiting ? "before-dispatch" : "idle"}`);
    if (!this.ignoreInterrupt) this.active?.result.reject(new Error("INTERRUPT Error: Interrupted!"));
  });
  readonly lane = new Lane(this as unknown as DuckDBConnection);

  start(sql: string, options: { signal?: AbortSignal; timeoutMs?: number } = { timeoutMs: 100 }) {
    const pending = statement();
    this.statements.set(sql, pending);
    const outcome = this.lane.run(sql, options, () => this.run(sql)).then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }),
    );
    return { ...pending, outcome };
  }

  async run(sql: string): Promise<string> {
    const pending = this.statements.get(sql)!;
    this.waiting = pending;
    this.events.push(`work:${sql}`);
    pending.entered.resolve();
    await pending.dispatch.promise;
    this.active = pending;
    this.events.push(`dispatch:${sql}`);
    pending.dispatched.resolve();
    try { return await pending.result.promise; }
    finally {
      if (this.waiting === pending) this.waiting = null;
      if (this.active === pending) this.active = null;
    }
  }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("redelivers a public interrupt lost before dispatch instead of letting the statement finish normally", async () => {
  const conn = new ControlledConnection();
  const work = conn.start("early-public");
  await work.entered.promise;
  conn.lane.interrupt();
  expect(conn.events).toEqual(["work:early-public", "interrupt:before-dispatch"]);
  work.dispatch.resolve();
  await work.dispatched.promise;
  await vi.advanceTimersByTimeAsync(10);
  work.result.resolve("finished without interrupt");
  const result = await work.outcome;
  expect(result.error).toMatchObject({ error: { code: "cancelled", sql: "early-public" } });
  expect(conn.events).toContain("interrupt:running");
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps idle/queued interrupts harmless and rejects an already aborted queued item before work", async () => {
  const conn = new ControlledConnection();
  conn.lane.interrupt();
  const first = conn.start("first");
  conn.lane.interrupt();
  const abort = new AbortController();
  abort.abort();
  const skipped = conn.start("skipped", { signal: abort.signal });
  await first.entered.promise;
  expect(conn.interrupt).not.toHaveBeenCalled();
  first.dispatch.resolve();
  first.result.resolve("first done");
  expect((await first.outcome).value).toBe("first done");
  expect((await skipped.outcome).error).toMatchObject({ error: { code: "cancelled", message: "Cancelled before it ran." } });
  expect(conn.events).not.toContain("work:skipped");
  const next = conn.start("next");
  next.dispatch.resolve();
  next.result.resolve("next done");
  expect((await next.outcome).value).toBe("next done");
  expect(vi.getTimerCount()).toBe(0);
});

it("uses the same redelivery for an AbortSignal that arrives before dispatch", async () => {
  const conn = new ControlledConnection();
  const abort = new AbortController();
  const work = conn.start("early-signal", { signal: abort.signal, timeoutMs: 100 });
  await work.entered.promise;
  expect(getEventListeners(abort.signal, "abort")).toHaveLength(1);
  abort.abort();
  work.dispatch.resolve();
  await work.dispatched.promise;
  await vi.advanceTimersByTimeAsync(10);
  expect((await work.outcome).error).toMatchObject({ error: { code: "cancelled" } });
  expect(conn.interrupt.mock.calls.length).toBeGreaterThan(1);
  expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("stops a dispatched statement and cleans its signal and timers before the next statement", async () => {
  const conn = new ControlledConnection();
  const abort = new AbortController();
  const work = conn.start("during", { signal: abort.signal, timeoutMs: 100 });
  work.dispatch.resolve();
  await work.dispatched.promise;
  conn.lane.interrupt();
  expect((await work.outcome).error).toMatchObject({ error: { code: "cancelled" } });
  expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
  const stoppedCalls = conn.interrupt.mock.calls.length;
  abort.abort();
  conn.lane.interrupt();
  const next = conn.start("after", { timeoutMs: 1_000 });
  next.dispatch.resolve();
  await next.dispatched.promise;
  await vi.advanceTimersByTimeAsync(200);
  expect(conn.interrupt).toHaveBeenCalledTimes(stoppedCalls);
  next.result.resolve("unaffected");
  expect((await next.outcome).value).toBe("unaffected");
  expect(vi.getTimerCount()).toBe(0);
});

it("creates one retry interval for repeated stops and ignores a stale interval callback during the next item", async () => {
  const intervals = vi.spyOn(globalThis, "setInterval");
  const conn = new ControlledConnection();
  const work = conn.start("repeated");
  await work.entered.promise;
  conn.lane.interrupt();
  conn.lane.interrupt();
  conn.lane.interrupt();
  expect(intervals).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(2);
  const stale = intervals.mock.calls[0][0] as () => void;
  work.dispatch.resolve();
  await work.dispatched.promise;
  await vi.advanceTimersByTimeAsync(10);
  expect((await work.outcome).error).toMatchObject({ error: { code: "cancelled" } });
  const next = conn.start("next-live", { timeoutMs: 1_000 });
  next.dispatch.resolve();
  await next.dispatched.promise;
  const calls = conn.interrupt.mock.calls.length;
  stale();
  await vi.advanceTimersByTimeAsync(200);
  expect(conn.interrupt).toHaveBeenCalledTimes(calls);
  next.result.resolve("clean next");
  expect((await next.outcome).value).toBe("clean next");
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["public", "timeout"])("keeps the first %s cause without refreshing the execute deadline", async (first) => {
  const intervals = vi.spyOn(globalThis, "setInterval");
  const conn = new ControlledConnection();
  conn.ignoreInterrupt = true;
  const abort = new AbortController();
  const work = conn.start("cause-order", { signal: abort.signal, timeoutMs: 30 });
  await work.entered.promise;
  if (first === "public") conn.lane.interrupt();
  await vi.advanceTimersByTimeAsync(25);
  if (first === "public") conn.lane.interrupt();
  await vi.advanceTimersByTimeAsync(10);
  abort.abort();
  conn.lane.interrupt();
  const calls = conn.interrupt.mock.calls.length;
  await vi.advanceTimersByTimeAsync(100);
  expect(conn.interrupt).toHaveBeenCalledTimes(calls);
  expect(intervals).toHaveBeenCalledTimes(first === "public" ? 1 : 0);
  expect(vi.getTimerCount()).toBe(0);
  work.dispatch.resolve();
  await work.dispatched.promise;
  work.result.reject(new Error("native stopped later"));
  expect((await work.outcome).error).toMatchObject({ error: {
    code: first === "public" ? "cancelled" : "timeout", sql: "cause-order",
    ...(first === "timeout" ? { retryable: true, hint: expect.stringContaining("30 ms") } : {}),
  } });
  expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
});

it("delivers timeout once at the deadline without creating a retry timer", async () => {
  const intervals = vi.spyOn(globalThis, "setInterval");
  const conn = new ControlledConnection();
  const work = conn.start("timeout", { timeoutMs: 30 });
  work.dispatch.resolve();
  await work.dispatched.promise;
  await vi.advanceTimersByTimeAsync(30);
  expect((await work.outcome).error).toMatchObject({ error: { code: "timeout", retryable: true, sql: "timeout" } });
  expect(conn.interrupt).toHaveBeenCalledTimes(1);
  expect(intervals).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["success", "sql-error", "data-failure"])("retains %s completion semantics and finally cleanup after stop", async (ending) => {
  const conn = new ControlledConnection();
  conn.ignoreInterrupt = true;
  const abort = new AbortController();
  const work = conn.start("completion", { signal: abort.signal, timeoutMs: 100 });
  await work.entered.promise;
  conn.lane.interrupt();
  work.dispatch.resolve();
  await work.dispatched.promise;
  const preserved = new DataFailure({ code: "sql_error", message: "fixture provider failure" });
  if (ending === "success") work.result.resolve("successful work is still returned");
  else work.result.reject(ending === "data-failure" ? preserved : new Error("fixture statement rejected"));
  const result = await work.outcome;
  if (ending === "success") expect(result.value).toBe("successful work is still returned");
  else if (ending === "data-failure") expect(result.error).toBe(preserved);
  else expect(result.error).toMatchObject({ error: { code: "cancelled" } });
  expect(getEventListeners(abort.signal, "abort")).toHaveLength(0);
  const calls = conn.interrupt.mock.calls.length;
  abort.abort();
  await vi.advanceTimersByTimeAsync(200);
  expect(conn.interrupt).toHaveBeenCalledTimes(calls);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not convert an ordinary work error or interrupt a parallel lane", async () => {
  const stopped = new ControlledConnection();
  const parallel = new ControlledConnection();
  const first = stopped.start("first");
  const other = parallel.start("other");
  first.dispatch.resolve();
  other.dispatch.resolve();
  await Promise.all([first.dispatched.promise, other.dispatched.promise]);
  stopped.lane.interrupt();
  expect((await first.outcome).error).toMatchObject({ error: { code: "cancelled" } });
  expect(parallel.interrupt).not.toHaveBeenCalled();
  other.result.resolve("parallel completed");
  expect((await other.outcome).value).toBe("parallel completed");
  const broken = stopped.start("broken");
  broken.dispatch.resolve();
  await broken.dispatched.promise;
  broken.result.reject(new Error("fixture SQL error"));
  expect((await broken.outcome).error).toMatchObject({ error: { code: "sql_error", message: "fixture SQL error" } });
  expect(vi.getTimerCount()).toBe(0);
});

it("stops retrying at the original deadline even if dispatch happens too late, preserving a successful work result", async () => {
  const conn = new ControlledConnection();
  const work = conn.start("late-dispatch", { timeoutMs: 20 });
  await work.entered.promise;
  conn.lane.interrupt();
  await vi.advanceTimersByTimeAsync(30);
  const calls = conn.interrupt.mock.calls.length;
  expect(vi.getTimerCount()).toBe(0);
  work.dispatch.resolve();
  await work.dispatched.promise;
  await vi.advanceTimersByTimeAsync(100);
  expect(conn.interrupt).toHaveBeenCalledTimes(calls);
  work.result.resolve("finished after the delivery window");
  expect((await work.outcome).value).toBe("finished after the delivery window");
  expect(vi.getTimerCount()).toBe(0);
});

it("drain expires without pretending work stopped, then drains after the owned work is released", async () => {
  const conn = new ControlledConnection();
  conn.ignoreInterrupt = true;
  const work = conn.start("held", { timeoutMs: 100 });
  work.dispatch.resolve();
  await work.dispatched.promise;
  conn.lane.interrupt();
  const expired = drainLanes([conn.lane], 20);
  await vi.advanceTimersByTimeAsync(20);
  expect(await expired).toBe(false);
  conn.ignoreInterrupt = false;
  conn.lane.interrupt();
  expect((await work.outcome).error).toMatchObject({ error: { code: "cancelled" } });
  expect(await drainLanes([conn.lane], 20)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["interrupt", "close"])("uses BotDb.%s through the asynchronous open result and drains before closing handles", async (action) => {
  const root = mkdtempSync(join(tmpdir(), "omb-data-interrupt-"));
  let engine: DataEngine | undefined;
  const pending = statement();
  onTestFinished(async () => {
    pending.dispatch.resolve();
    pending.result.resolve("fixture released for cleanup");
    await engine?.closeAll();
    await rm(root, { recursive: true, force: true });
  });
  const conn = new ControlledConnection();
  conn.statements.set("SELECT blocked", pending);
  const order: string[] = [];
  const botClose = vi.fn(() => { order.push("close-bot"); });
  const panelClose = vi.fn(() => { order.push("close-panel"); });
  const instanceClose = vi.fn(() => { order.push("close-instance"); });
  const bot = {
    run: (sql: string) => sql.startsWith("CREATE SCHEMA") ? Promise.resolve({}) : conn.run(sql).finally(() => { order.push("work-settled"); }),
    runAndReadAll: async () => ({ getRowsJson: () => [] }),
    interrupt: conn.interrupt, closeSync: botClose,
  };
  let connects = 0;
  const binding = {
    version: () => "fixture",
    DuckDBInstance: { create: async () => ({ connect: async () => connects++ === 0 ? bot : { closeSync: panelClose }, closeSync: instanceClose }) },
  } as unknown as NonNullable<DataEngineOptions["binding"]>;
  engine = createDataEngine({ binding, botFolder: (id) => join(root, id), dataDir: root, env: {} });
  const database = await engine.forBot("fixture-bot");
  const outcome = database.run("SELECT blocked", { connection: "bot", timeoutMs: 100 }).then(
    (value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }),
  );
  await pending.entered.promise;
  const closing = action === "close" ? database.close() : Promise.resolve(database.interrupt("bot"));
  expect(conn.interrupt).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(0);
  expect(conn.events).toContain("interrupt:before-dispatch");
  expect(botClose).not.toHaveBeenCalled();
  pending.dispatch.resolve();
  await pending.dispatched.promise;
  await vi.advanceTimersByTimeAsync(10);
  expect((await outcome).error).toMatchObject({ error: { code: "cancelled" } });
  await closing;
  await engine.closeAll();
  expect(order).toEqual(["work-settled", "close-bot", "close-panel", "close-instance"]);
  expect(botClose).toHaveBeenCalledTimes(1);
  expect(panelClose).toHaveBeenCalledTimes(1);
  expect(instanceClose).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
