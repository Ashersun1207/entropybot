import { expect, it, vi } from "vitest";
import { BrowserNavigationCancelled, prepareNavigationStop, withNavigationCancellation, type NavigationStop } from "./browser-navigation-cancel.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}

it("pins one unique page and never closes a browser or unrelated page", async () => {
  const send = vi.fn(async (method: string) => method === "Target.getTargets" ? { targetInfos: [
    { type: "page", targetId: "owned", url: "https://fixture.invalid/old" },
    { type: "page", targetId: "control", url: "https://fixture.invalid/control" },
    { type: "iframe", targetId: "frame", url: "https://fixture.invalid/old" },
  ] } : method === "Target.attachToTarget" ? { sessionId: "owned-session" } : {});
  const close = vi.fn();
  const target = await prepareNavigationStop("ws://127.0.0.1:1234/devtools/browser/test", "https://fixture.invalid/old", async () => ({ send, close }));
  expect(target).not.toBeNull();
  if (!target) throw new Error("target was not prepared");
  expect(send).toHaveBeenCalledWith("Target.attachToTarget", { targetId: "owned", flatten: true });
  await expect(target.stop()).resolves.toBe(true);
  await expect(target.stop()).resolves.toBe(true);
  expect(send.mock.calls.filter(([method]) => method === "Page.stopLoading")).toHaveLength(1);
  expect(send).toHaveBeenCalledWith("Page.stopLoading", {}, "owned-session");
  expect(send).toHaveBeenCalledWith("Page.navigate", { url: "about:blank" }, "owned-session");
  expect(send.mock.calls.map(([method]) => method)).toEqual(["Target.getTargets", "Target.attachToTarget", "Page.stopLoading", "Page.navigate"]);
  target.close();expect(close).toHaveBeenCalledOnce();
});

it.each([{ ids: [] as string[] }, { ids: ["first", "second"] }])("refuses a missing or ambiguous active page without touching another target: $ids", async ({ ids }) => {
  const send = vi.fn(async () => ({ targetInfos: ids.map(targetId => ({ type: "page", targetId, url: "about:blank" })) }));
  const close = vi.fn();
  await expect(prepareNavigationStop("ws://127.0.0.1:1234", "about:blank", async () => ({ send, close }))).resolves.toBeNull();
  expect(send).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
});

it("does not prepare or dispatch an already cancelled call", async () => {
  const abort = new AbortController();abort.abort();
  const prepare = vi.fn(), work = vi.fn(), uncertain = vi.fn();
  await expect(withNavigationCancellation(abort.signal, prepare, work, uncertain)).rejects.toBeDefined();
  expect(prepare).not.toHaveBeenCalled();expect(work).not.toHaveBeenCalled();expect(uncertain).not.toHaveBeenCalled();
});

it("closes preparation without stopping a page if cancelled before dispatch", async () => {
  const abort = new AbortController();
  const prepared = deferred<NavigationStop | null>();
  const target = { stop: vi.fn(async () => true), close: vi.fn() };
  const work = vi.fn(), uncertain = vi.fn();
  const pending = withNavigationCancellation(abort.signal, () => prepared.promise, work, uncertain);
  const rejected = expect(pending).rejects.toBeDefined();
  abort.abort();prepared.resolve(target);await rejected;
  expect(work).not.toHaveBeenCalled();expect(target.stop).not.toHaveBeenCalled();
  expect(target.close).toHaveBeenCalledOnce();expect(uncertain).not.toHaveBeenCalled();
});

it("drains a cancelled request before releasing its page and suppresses late results", async () => {
  const abort = new AbortController();const reply = deferred<string>();
  const started = deferred<void>();
  const target = { stop: vi.fn(async () => { reply.resolve("late old result");return true; }), close: vi.fn() };
  const uncertain = vi.fn();
  const pending = withNavigationCancellation(abort.signal, async () => target, () => { started.resolve();return reply.promise; }, uncertain);
  const rejected = expect(pending).rejects.toBeInstanceOf(BrowserNavigationCancelled);
  await started.promise;abort.abort();await rejected;
  expect(target.stop).toHaveBeenCalledOnce();expect(target.close).toHaveBeenCalledOnce();expect(uncertain).not.toHaveBeenCalled();
});

it("marks unknown when there is no safe target instead of stopping other pages", async () => {
  const abort = new AbortController();const reply = deferred<string>();const started = deferred<void>();
  const uncertain = vi.fn();
  const pending = withNavigationCancellation(abort.signal, async () => null, () => { started.resolve();return reply.promise; }, uncertain);
  const rejected = expect(pending).rejects.toThrow(/could not be confirmed/);
  await started.promise;abort.abort();await rejected;
  expect(uncertain).toHaveBeenCalledOnce();reply.resolve("old work eventually answered");
});

it("retains uncertainty if stopLoading fails", async () => {
  const abort = new AbortController();const reply = deferred<string>();const started = deferred<void>();
  const target = { stop: vi.fn(async () => { throw new Error("CDP disconnected"); }), close: vi.fn() };
  const uncertain = vi.fn();
  const pending = withNavigationCancellation(abort.signal, async () => target, () => { started.resolve();return reply.promise; }, uncertain);
  const rejected = expect(pending).rejects.toThrow(/could not be confirmed/);
  await started.promise;abort.abort();await rejected;
  expect(uncertain).toHaveBeenCalledOnce();expect(target.close).toHaveBeenCalledOnce();reply.resolve("finished later");
});

it("refuses an oversized target list rather than scan it", async () => {
  const send = vi.fn(async () => ({ targetInfos: Array.from({ length: 1100 }, (_, i) => ({ type: "page", targetId: `p${i}`, url: "about:blank" })) }));
  const close = vi.fn();
  await expect(prepareNavigationStop("ws://127.0.0.1:1234", "about:blank", async () => ({ send, close }))).resolves.toBeNull();
  expect(send).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
});

it("removes the old abort handler after completion so it cannot stop the next task", async () => {
  const abort = new AbortController();const target = { stop: vi.fn(async () => true), close: vi.fn() };
  await expect(withNavigationCancellation(abort.signal, async () => target, async () => "done", vi.fn())).resolves.toBe("done");
  abort.abort();await Promise.resolve();expect(target.stop).not.toHaveBeenCalled();expect(target.close).toHaveBeenCalledOnce();
});
