import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BlockList } from "node:net";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RoutineCollectionPlan } from "../shared/collection-plan.ts";
import { createAutomationReports, type AutomationReports } from "./automation-reports.ts";
import { commandReceipt } from "./commands.ts";
import { DATA_DIR } from "./config.ts";
import { closeMessageDb } from "./message-db.ts";
import { createRoutineCollectionDispatch } from "./routine-collection-dispatch.ts";
import { manualRoutineFingerprint } from "./routine-manual-request.ts";
import { RoutineManager, type RoutineRun } from "./routines.ts";
import { Store } from "./store.ts";
import { createCollectionHttpReader } from "./web-collection-http.ts";

const plan: RoutineCollectionPlan = { kind: "web-collection", version: 1,
  sources: [{ url: "https://collection-fixture.invalid/page#a" }, { url: "https://collection-fixture.invalid/page#b" }],
  limits: { pages: 2, bytes: 2048, pageBytes: 1024, attempts: 2, durationMs: 30_000 } };
const managers: RoutineManager[] = [];
beforeEach(() => { closeMessageDb(); rmSync(DATA_DIR, { recursive: true, force: true }); });
afterEach(async () => {
  for (const manager of managers.splice(0)) manager.close();
  await new Promise(resolve => setTimeout(resolve, 5));
  closeMessageDb();
});

function fixture() {
  const selection = () => ({ instanceId: "claude", model: "synthetic" });
  let store = new Store(selection);
  const bot = store.createBot({ name: "Synthetic collector" });
  let manager: RoutineManager;
  let reports: AutomationReports;
  let busy = false;
  const provider = vi.fn(async () => {});
  const request = vi.fn(async () => ({ statusCode: 200, headers: {}, destroy() {},
    async *[Symbol.asyncIterator]() { yield Buffer.from("literal synthetic page"); } }));
  const read = createCollectionHttpReader({ resolve: async () => [{ address: "93.184.216.34", family: 4 }], own: () => new BlockList(), request });
  const attach = () => {
    reports = createAutomationReports({ store, routines: () => manager ?? null, busy: () => busy, wrote() {}, notify() {} });
    const collection = createRoutineCollectionDispatch({ dataDir: DATA_DIR, reports, read });
    manager = new RoutineManager({ collection, botState: () => "ready", startTurn: provider,
      resolveResultsThread: () => ({ threadId: bot.threadId, main: true }),
      createTask: (botId, title, run) => {
        const task = store.createTask(botId, title, false);
        if (task && run) store.patchTask(botId, task.threadId, { routineRunId: run.id });
        return task;
      },
    });
    managers.push(manager);
  };
  attach();
  const routine = manager!.create({ name: "Typed collection", prompt: "Display instructions only", botId: bot.id, enabled: false,
    schedule: { type: "daily", time: "10:00", weekdays: [1] }, collection: plan });
  const authority = "b".repeat(64);
  const start = () => manager.runNow(routine.id, undefined, { origin: "http", routineId: routine.id, authority,
    requestId: `http:${"a".repeat(64)}`, fingerprintVersion: 1, fingerprint: manualRoutineFingerprint(routine, authority) })!;
  const current = (id: string) => manager.listRuns().find(run => run.id === id)!;
  const lines = () => store.messagesFor(bot.threadId).filter(message => message.automation);
  const restart = async () => {
    manager.close();
    await new Promise(resolve => setTimeout(resolve, 5));
    closeMessageDb();
    store = new Store(selection);
    attach();
    await manager.tick();
  };
  return { bot, start, current, lines, restart, request, provider, setBusy: (value: boolean) => { busy = value; },
    flush: () => reports.flush(), store: () => store, manager: () => manager };
}

it("does not confirm queued publication; resumes busy publication across repeated store/manager restart without rereading", async () => {
  const f = fixture();
  f.setBusy(true);
  const run = f.start();
  await expect.poll(() => f.current(run.id).report?.state).toBe("pending");
  expect(f.current(run.id).status).toBe("running");
  expect(f.lines()).toHaveLength(0);
  const key = createHash("sha256").update(JSON.stringify([run.routineId, run.id])).digest("hex");
  expect(commandReceipt("web-collection.publish.v1", `${key}:completed`)).toBeNull();
  await f.restart();
  await expect.poll(() => f.current(run.id).report?.state).toBe("pending");
  await f.restart();
  expect(f.request).toHaveBeenCalledTimes(2);
  f.setBusy(false); f.flush();
  await expect.poll(() => f.current(run.id).status).toBe("completed");
  expect(f.lines()).toHaveLength(1);
  expect(f.current(run.id).report?.state).toBe("posted");
  expect(commandReceipt("web-collection.publish.v1", `${key}:completed`)).not.toBeNull();
  const posted = f.lines()[0];
  await f.restart();
  expect(f.lines()).toEqual([posted]);
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.provider).not.toHaveBeenCalled();
});

it.each(["append", "report-state"] as const)("reconciles a committed report after %s acknowledgement failure, persisting its message identity without restart", async failure => {
  const f = fixture();
  let failed = false;
  if (failure === "append") {
    const store = f.store();
    const append = store.appendMessage.bind(store);
    vi.spyOn(store, "appendMessage").mockImplementation((threadId, message, command) => {
      const result = append(threadId, message, command);
      if (message.automation && !failed) { failed = true; throw new Error("Synthetic crash after durable report append"); }
      return result;
    });
  } else {
    const manager = f.manager();
    const note = manager.noteReport.bind(manager);
    vi.spyOn(manager, "noteReport").mockImplementation((id, report) => {
      if (report?.state === "posted" && !failed) { failed = true; throw new Error("Synthetic report-state acknowledgement failure"); }
      return note(id, report);
    });
  }
  const run = f.start();
  await expect.poll(() => f.current(run.id).status).toBe("completed");
  expect(failed).toBe(true);
  expect(f.lines()).toHaveLength(1);
  const posted = { state: "posted", threadId: f.bot.threadId, messageId: f.lines()[0]!.id };
  const durableReport = () => JSON.parse(readFileSync(join(DATA_DIR, "routines.json"), "utf8")).runs.find((saved: RoutineRun) => saved.id === run.id).report;
  expect(f.current(run.id).report).toEqual(posted);
  expect(durableReport()).toEqual(posted);
  f.flush(); f.flush();
  expect(f.current(run.id).report).toEqual(posted);
  expect(durableReport()).toEqual(posted);
  await f.restart();
  expect(f.current(run.id).report).toEqual(posted);
  expect(f.lines()).toHaveLength(1);
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.provider).not.toHaveBeenCalled();
});

it("does not acknowledge publication while report-state persistence keeps failing", async () => {
  const f = fixture();
  const manager = f.manager();
  const note = manager.noteReport.bind(manager);
  vi.spyOn(manager, "noteReport").mockImplementation((id, report) => {
    if (report?.state === "posted") throw new Error("Synthetic persistent report-state save failure");
    return note(id, report);
  });
  const run = f.start();
  await expect.poll(() => f.current(run.id).status).toBe("failed");
  expect(f.lines()).toHaveLength(1);
  const key = createHash("sha256").update(JSON.stringify([run.routineId, run.id])).digest("hex");
  expect(commandReceipt("web-collection.publish.v1", `${key}:completed`)).toBeNull();
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.provider).not.toHaveBeenCalled();
});

it("cancellation while reporting is busy prevents queued publication after flush and restart", async () => {
  const f = fixture();
  f.setBusy(true);
  const run = f.start();
  await expect.poll(() => f.current(run.id).report?.state).toBe("pending");
  await f.manager().cancelRun(run.id);
  f.setBusy(false); f.flush();
  expect(f.lines()).toHaveLength(0);
  await f.restart(); f.flush();
  expect(f.lines()).toHaveLength(0);
  expect(f.current(run.id).status).toBe("cancelled");
  expect(f.request).toHaveBeenCalledTimes(2);
});

it("cancels collection publication when its bot's unfinished runs are removed", async () => {
  const f = fixture();
  f.setBusy(true);
  const run = f.start();
  await expect.poll(() => f.current(run.id).report?.state).toBe("pending");
  f.manager().removeForBot(f.bot.id);
  expect(f.manager().listRuns()).toHaveLength(0);
  f.setBusy(false); f.flush();
  expect(f.lines()).toHaveLength(0);
  expect(f.request).toHaveBeenCalledTimes(2);
});

it("ordinary routines still dispatch through the original provider path", async () => {
  const f = fixture();
  const ordinary = f.manager().create({ name: "Ordinary", prompt: "Regular instructions", botId: f.bot.id,
    enabled: false, schedule: { type: "daily", time: "11:00", weekdays: [1] } });
  f.manager().runNow(ordinary.id);
  await expect.poll(() => f.provider.mock.calls.length).toBe(1);
  expect(f.request).not.toHaveBeenCalled();
});
