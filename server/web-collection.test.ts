import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { closeMessageDb } from "./message-db.ts";
import { RoutineManager, type RoutineManagerOptions } from "./routines.ts";
import { Runtime } from "./runtime/runtime.ts";
import { openRuntimeStore } from "./runtime/store.ts";
import type { TurnRunner } from "./runtime/types.ts";
import { collectWeb, collectionUrl, type CollectionOptions, type CollectionPlan } from "./web-collection.ts";

const dirs: string[] = [];
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); closeMessageDb(); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "wc-"));
  dirs.push(root);
  chmodSync(root, 0o700);
  const controller = new AbortController();
  let reads = 0;
  let time = 1000;
  const plan: CollectionPlan = { version: "synthetic-1", sources: [
    { url: "https://example.invalid/a#one", html: "<h1>A</h1>" },
    { url: "https://example.invalid/a#two", html: "<h1>duplicate</h1>" },
    { url: "https://example.invalid/b?q=1", html: "<script>inert</script>" },
  ], limits: { pages: 3, bytes: 1000, pageBytes: 100, attempts: 3, durationMs: 1000 } };
  const options: CollectionOptions = { run: { id: root, routineId: "routine", manual: true }, requestId: "manual-request", plan,
    outputRoot: root, signal: controller.signal, now: () => time,
    read: async source => { reads++; return source.html!; } };
  return { root, options, controller, reads: () => reads, advance: () => { time += 1001; }, reopen: () => closeMessageDb() };
}

describe("manual web collection with real files and command SQLite receipts", () => {
  it("dispatches one logical manual run through RoutineManager and Runtime, then reuses its stable report after reopen", async () => {
    const f = fixture();
    const store = openRuntimeStore(join(f.root, "runtime.sqlite"));
    let reportPath = "";
    const runner: TurnRunner = {
      validate: () => undefined, canStart: () => true, park: () => {}, changed: () => {},
      names: () => ({ requester: "fixture", assignee: "fixture", person: "fixture" }),
      run: async (_a, _input, signal) => {
        const report = await collectWeb({ ...f.options, signal });
        reportPath = report.path;
        return { kind: "completed", text: report.hash };
      }, report: () => {},
    };
    const runtime = new Runtime(store, runner);
    runtime.open();
    cleanups.push(() => { runtime.close(); store.close(); });
    let manager: RoutineManager;
    const managerOptions: RoutineManagerOptions = { file: join(f.root, "routines.json"), botState: () => "ready",
      createTask: () => ({ threadId: "fixture-thread" }),
      startTurn: async () => {
        const run = manager.listRuns()[0]!;
        f.options.run = run;
        const parent = runtime.begin({ origin: { kind: "routine", source: "routine", ref: run.id },
          requester: { kind: "routine_run", runId: run.id, threadId: "request" },
          assignee: { botId: "owner", destination: { kind: "standing_thread", threadId: "request" } }, brief: "collect", level: "auto" });
        runtime.enqueue({ parentId: parent.id, origin: parent.origin, requester: { kind: "bot_turn", botId: "owner", threadId: "request" },
          assignee: { botId: "collector", destination: { kind: "work_thread", threadId: "collect" } }, brief: "collect", levels: { own: "auto" }, driverKind: "claudeAgent" });
        runtime.tick();
      } };
    manager = new RoutineManager(managerOptions);
    cleanups.push(() => manager.close());
    const routine = manager.create({ name: "Synthetic collection", prompt: "collect", botId: "fixture", enabled: false, schedule: { type: "once", at: Date.now() + 100000 } });
    const request = { requestId: "manual-request", messageId: "message", botId: "fixture", threadId: "request", action: "run_now" as const, fingerprintVersion: 1 as const, fingerprint: createHash("sha256").update("immutable-fixture").digest("hex") };
    const first = manager.runNow(routine.id, request)!;
    expect(manager.runNow(routine.id, request)?.id).toBe(first.id);
    await manager.tick();
    await expect.poll(() => reportPath).not.toBe("");
    expect(f.reads()).toBe(3);
    expect(JSON.parse(readFileSync(reportPath, "utf8")).sources).toHaveLength(2);
    manager.close();
    manager = new RoutineManager(managerOptions);
    expect(manager.runNow(routine.id, request)?.id).toBe(first.id);
    f.reopen();
    expect(await collectWeb(f.options)).toMatchObject({ path: reportPath, pages: 3, unique: 2 });
    expect(f.reads()).toBe(3);
  });

  it.each(["page", "artifact", "completed"] as const)("recovers %s before subsequent dispatch/completion, reopening SQLite", async phase => {
    const f = fixture();
    let hit = false;
    f.options.fault = actual => { if (!hit && actual === phase) { hit = true; throw new Error("crash window"); } };
    await expect(collectWeb(f.options)).rejects.toThrow("crash window");
    f.reopen();
    const report = await collectWeb({ ...f.options, fault: undefined });
    expect(report).toMatchObject({ pages: 3, unique: 2 });
    expect(f.reads()).toBe(3);
  });

  it("never resends a reader effect accepted without a result receipt", async () => {
    const f = fixture();
    f.options.read = async () => { throw new Error("synthetic accepted effect, reply lost"); };
    await expect(collectWeb(f.options)).rejects.toThrow("reply lost");
    f.reopen();
    await expect(collectWeb({ ...f.options, read: async () => { throw new Error("must not resend"); } })).rejects.toThrow("outcome unknown");
  });

  it.each(["version", "input", "request"])("rejects changed %s before reusing checkpoints", async change => {
    const f = fixture();
    await collectWeb(f.options); f.reopen();
    if (change === "version") f.options.plan.version = "v2";
    if (change === "input") f.options.plan.sources[0]!.html = "changed";
    if (change === "request") f.options.requestId = "other";
    await expect(collectWeb(f.options)).rejects.toThrow("mismatch");
    expect(f.reads()).toBe(3);
  });

  it.each(["attempts", "bytes", "deadline"])("keeps cumulative %s limits across reopening", async limit => {
    const f = fixture();
    if (limit === "attempts") f.options.plan.limits.attempts = 1;
    if (limit === "bytes") f.options.plan.limits.bytes = 100;
    f.options.fault = phase => { if (phase === "page") throw new Error("crash"); };
    await expect(collectWeb(f.options)).rejects.toThrow("crash");
    f.reopen();
    if (limit === "deadline") f.advance();
    await expect(collectWeb({ ...f.options, fault: undefined })).rejects.toThrow(/exhausted/);
    expect(f.reads()).toBe(1);
  });

  it.each(["changed", "missing", "symlink"])("rejects completed output that is %s and retains third-party bytes", async mode => {
    const f = fixture();
    const report = await collectWeb(f.options);
    const third = join(f.root, "original.txt"); writeFileSync(third, "third party");
    if (mode === "changed") writeFileSync(report.path, "original bytes");
    else { rmSync(report.path); if (mode === "symlink") symlinkSync(third, report.path); }
    f.reopen();
    await expect(collectWeb(f.options)).rejects.toThrow();
    expect(readFileSync(third, "utf8")).toBe("third party");
    if (mode === "changed") expect(readFileSync(report.path, "utf8")).toBe("original bytes");
  });

  it("retains an uncheckpointed conflicting artifact", async () => {
    const f = fixture(); let path = "";
    f.options.fault = phase => { if (phase === "artifact") throw new Error("crash"); };
    await expect(collectWeb(f.options)).rejects.toThrow("crash");
    const { readdirSync } = await import("node:fs");
    path = join(f.root, readdirSync(f.root).find(name => name.endsWith(".json"))!);
    writeFileSync(path, "third party artifact"); f.reopen();
    await expect(collectWeb({ ...f.options, fault: undefined })).rejects.toThrow("conflict");
    expect(readFileSync(path, "utf8")).toBe("third party artifact");
  });

  it.each(["before", "reader", "artifact", "completed"])("cancels at %s without claiming rollback", async phase => {
    const f = fixture();
    if (phase === "before") f.controller.abort();
    if (phase === "reader") f.options.read = async () => { f.controller.abort(); return "accepted"; };
    f.options.fault = actual => { if (actual === phase) f.controller.abort(); };
    if (phase === "completed") expect(await collectWeb(f.options)).toMatchObject({ unique: 2 });
    else await expect(collectWeb(f.options)).rejects.toThrow();
    f.reopen();
    const resumed = { ...f.options, signal: new AbortController().signal, fault: undefined };
    if (phase === "reader") await expect(collectWeb(resumed)).rejects.toThrow("unknown");
    else expect(await collectWeb(resumed)).toMatchObject({ unique: 2 });
  });

  it("revalidates a completed artifact even after the execution deadline", async () => {
    const f = fixture();
    const report = await collectWeb(f.options);
    f.advance(); f.reopen();
    expect(await collectWeb(f.options)).toEqual(report);
    rmSync(report.path);
    await expect(collectWeb(f.options)).rejects.toThrow();
    expect(f.reads()).toBe(3);
  });

  it("bounds a stalled reader and does not resend after timeout", async () => {
    const f = fixture();
    f.options.plan.limits.durationMs = 25;
    let readerSignal: AbortSignal | undefined;
    f.options.read = (_source, signal) => { readerSignal = signal; return new Promise(() => {}); };
    await expect(collectWeb(f.options)).rejects.toThrow("deadline exhausted");
    expect(readerSignal?.aborted).toBe(true);
    f.reopen();
    await expect(collectWeb(f.options)).rejects.toThrow("unknown");
  });

  it("keeps meaningful queries, rejects userinfo and non-HTTP schemes and nonprivate roots", async () => {
    expect(collectionUrl("https://EXAMPLE.invalid:443/a?q=1#x")).toBe("https://example.invalid/a?q=1");
    expect(collectionUrl("https://example.invalid/a?q=2")).not.toBe(collectionUrl("https://example.invalid/a?q=1"));
    expect(() => collectionUrl("https://secret@example.invalid/")).toThrow();
    expect(() => collectionUrl("file:///fixture")).toThrow();
    const f = fixture(); chmodSync(f.root, 0o755);
    await expect(collectWeb(f.options)).rejects.toThrow("Private");
    expect(f.reads()).toBe(0);
  });
});
