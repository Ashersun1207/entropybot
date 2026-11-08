import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { closeMessageDb } from "./message-db.ts";
import { RoutineManager } from "./routines.ts";
import { Runtime } from "./runtime/runtime.ts";
import { openRuntimeStore } from "./runtime/store.ts";
import type { TurnRunner } from "./runtime/types.ts";
import { hostWebCollection, type CollectionHostOptions, type CollectionPublication } from "./web-collection-host.ts";
import { readInlineCollectionPage } from "./web-collection-reader.ts";
import { collectWeb } from "./web-collection.ts";

const cleanups: Array<() => void> = [];
afterEach(() => { closeMessageDb(); cleanups.splice(0).reverse().forEach(cleanup => cleanup()); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "wch-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const managerOptions = { file: join(root, "routines.json"), botState: () => "ready" as const,
    createTask: () => ({ threadId: "synthetic-task" }), startTurn: async () => {} };
  let manager = new RoutineManager(managerOptions);
  cleanups.push(() => manager.close());
  const routine = manager.create({ name: "Synthetic collection", prompt: "collect", botId: "fixture", enabled: false,
    schedule: { type: "once", at: Date.now() + 100000 } });
  const run = manager.runNow(routine.id)!;
  const published: CollectionPublication[] = [];
  let reads = 0;
  const options: CollectionHostOptions = {
    run, requestId: "synthetic-request", outputRoot: root, signal: new AbortController().signal,
    plan: { version: "synthetic-v1", sources: [
      { url: "https://example.invalid/a#one", html: "<h1>synthetic</h1>" },
      { url: "https://example.invalid/a#two", html: "<script>inert</script>" },
    ], limits: { pages: 2, bytes: 200, pageBytes: 100, attempts: 2, durationMs: 60000 } },
    read: async (...args) => { reads++; return readInlineCollectionPage(...args); },
    publish: async publication => { published.push(publication); },
  };
  return { root, options, published, reads: () => reads, reopen: () => {
    closeMessageDb(); manager.close(); manager = new RoutineManager(managerOptions);
    options.run = manager.listRuns().find(candidate => candidate.id === run.id)!;
  } };
}

describe("synthetic collection reader", () => {
  it("returns literal inline text at its UTF-8 bound without interpreting HTML", async () => {
    expect(await readInlineCollectionPage({ url: "https://example.invalid", html: "é<script>" }, new AbortController().signal, 10)).toBe("é<script>");
  });

  it.each([0, -1, Infinity, NaN, 1.5, 1_000_001])("rejects invalid byte limit %s", async limit => {
    await expect(readInlineCollectionPage({ url: "https://example.invalid", html: "" }, new AbortController().signal, limit)).rejects.toThrow("finite reader");
  });

  it("rejects missing HTML, oversized UTF-8 and cancellation", async () => {
    const signal = new AbortController().signal;
    await expect(readInlineCollectionPage({ url: "https://example.invalid" }, signal, 100)).rejects.toThrow("inline HTML");
    await expect(readInlineCollectionPage({ url: "https://example.invalid", html: "éé" }, signal, 3)).rejects.toThrow("byte limit");
    await expect(readInlineCollectionPage({ url: "https://example.invalid", html: "abcd" }, signal, 3)).rejects.toThrow("byte limit");
    await expect(readInlineCollectionPage({ url: "https://example.invalid", html: "" }, AbortSignal.abort(new Error("cancelled")), 3)).rejects.toThrow("cancelled");
  });
});

describe("collection host with real collection, runtime and durable receipts", () => {
  it("publishes once through a non-model runtime caller and reuses completion after both stores reopen", async () => {
    const f = fixture();
    let executions = 0;
    const runner: TurnRunner = {
      validate: () => undefined, canStart: () => true, park: () => {}, changed: () => {}, report: () => {},
      names: () => ({ requester: "fixture", assignee: "fixture", person: "fixture" }),
      run: async (assignment, _input, signal) => {
        if (assignment.depth === 0) return { kind: "completed", text: "synthetic host finished" };
        const report = await hostWebCollection({ ...f.options, signal });
        executions++;
        return { kind: "completed", text: report.hash };
      },
    };
    let store = openRuntimeStore(join(f.root, "runtime.sqlite"));
    let runtime = new Runtime(store, runner);
    cleanups.push(() => { runtime.close(); store.close(); });
    runtime.open();
    const request = { origin: { kind: "routine" as const, source: "routine" as const, ref: f.options.run.id },
      requester: { kind: "routine_run" as const, runId: f.options.run.id, threadId: "request" },
      assignee: { botId: "host", destination: { kind: "standing_thread" as const, threadId: "request" } },
      brief: "collect", level: "auto" as const };
    const parent = runtime.begin(request);
    const child = runtime.enqueue({ parentId: parent.id, origin: request.origin,
      requester: { kind: "bot_turn", botId: "host", threadId: "request" },
      assignee: { botId: "collector", destination: { kind: "work_thread", threadId: "collection" } },
      brief: "collect", levels: { own: "auto" }, driverKind: "claudeAgent" });
    if (!child.ok) throw new Error(child.reason);
    const assignment = child.assignment;
    runtime.tick();
    await expect.poll(() => executions).toBe(1);
    expect(f.published).toHaveLength(1);
    const report = await collectWeb(f.options);
    expect(f.published[0]!.text).toBe(`Web collection report\nPages: 2\nUnique: 1\nPath: ${JSON.stringify(report.path)}\nSHA-256: ${report.hash}`);
    expect(Buffer.byteLength(f.published[0]!.text)).toBeLessThanOrEqual(4096);
    expect(f.published[0]!.text).not.toContain("<script>");
    expect(JSON.parse(readFileSync(report.path, "utf8")).sources).toHaveLength(1);
    runtime.close(); store.close(); f.reopen();
    store = openRuntimeStore(join(f.root, "runtime.sqlite"));
    runtime = new Runtime(store, runner);
    runtime.open();
    expect(store.get(assignment.id)?.status).toBe("completed");
    expect(await hostWebCollection(f.options)).toEqual(report);
    expect(f.reads()).toBe(2);
    expect(f.published).toHaveLength(1);
  });

  it.each(["missing", "oversized"])("retains reader %s refusal and refuses resend after reopen", async mode => {
    const f = fixture();
    f.options.plan.sources[0]!.html = mode === "missing" ? undefined : "x".repeat(101);
    await expect(hostWebCollection(f.options)).rejects.toThrow(mode === "missing" ? "inline HTML" : "byte limit");
    f.reopen();
    await expect(hostWebCollection(f.options)).rejects.toThrow("outcome unknown");
    expect(f.reads()).toBe(1);
    expect(f.published).toHaveLength(0);
  });

  it.each(["attempts", "bytes"] as const)("preserves cumulative %s refusal across reopen", async limit => {
    const f = fixture();
    f.options.plan.limits[limit] = limit === "bytes" ? 100 : 1;
    await expect(hostWebCollection(f.options)).rejects.toThrow("cumulative budget");
    f.reopen();
    await expect(hostWebCollection(f.options)).rejects.toThrow("cumulative budget");
    expect(f.reads()).toBe(1);
    expect(f.published).toHaveLength(0);
  });

  it("bounds a pending reader and refuses its unknown outcome after reopen", async () => {
    const f = fixture();
    f.options.plan.limits.durationMs = 20;
    let signal: AbortSignal | undefined;
    f.options.read = (_source, readerSignal) => { signal = readerSignal; return new Promise(() => {}); };
    await expect(hostWebCollection(f.options)).rejects.toThrow("deadline exhausted");
    expect(signal?.aborted).toBe(true);
    f.reopen();
    await expect(hostWebCollection(f.options)).rejects.toThrow(/unknown|deadline exhausted/);
    expect(f.published).toHaveLength(0);
  });

  it("does not claim publication completion when the callback fails after accepting an effect", async () => {
    const f = fixture();
    f.options.publish = async publication => { f.published.push(publication); throw new Error("accepted, acknowledgement lost"); };
    await expect(hostWebCollection(f.options)).rejects.toThrow("acknowledgement lost");
    f.reopen();
    expect(await collectWeb(f.options)).toMatchObject({ pages: 2, unique: 1 });
    await expect(hostWebCollection(f.options)).rejects.toThrow("publication outcome unknown");
    expect(f.reads()).toBe(2);
    expect(f.published).toHaveLength(1);
  });

  it("refuses concurrent publication while the accepted callback is pending", async () => {
    const f = fixture();
    let release!: () => void;
    f.options.publish = publication => { f.published.push(publication); return new Promise(resolve => { release = resolve; }); };
    const first = hostWebCollection(f.options);
    await expect.poll(() => f.published.length).toBe(1);
    await expect(hostWebCollection(f.options)).rejects.toThrow("publication outcome unknown");
    release();
    const report = await first;
    f.reopen();
    expect(await hostWebCollection(f.options)).toEqual(report);
    expect(f.published).toHaveLength(1);
  });

  it("revalidates completed artifacts and plan binding before publication replay", async () => {
    const f = fixture();
    const report = await hostWebCollection(f.options);
    f.reopen();
    f.options.requestId = "changed";
    await expect(hostWebCollection(f.options)).rejects.toThrow("mismatch");
    f.options.requestId = "synthetic-request";
    rmSync(report.path);
    await expect(hostWebCollection(f.options)).rejects.toThrow();
    expect(f.published).toHaveLength(1);
  });
});
