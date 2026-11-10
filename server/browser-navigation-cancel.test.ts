import { expect, it, vi } from "vitest";
import { BrowserNavigationCancelled, prepareNavigationStop, withNavigationCancellation, type NavigationStop } from "./browser-navigation-cancel.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}
const endpoint = "ws://127.0.0.1:1234/devtools/browser/test";

it.each(["https://fixture.invalid/old", "https://fixture.invalid/redirected"])("pins the engine target ID despite duplicates or redirect: %s", async url => {
  const send = vi.fn(async (method: string) => method === "Target.getTargets" ? { targetInfos: [
    { type: "page", targetId: "owned", url },
    { type: "page", targetId: "control", url: "https://fixture.invalid/old" },
  ] } : method === "Target.attachToTarget" ? { sessionId: "owned-session" } : { frameId: "frame" });
  const close = vi.fn();
  const target = await prepareNavigationStop(endpoint, "owned", () => true, async () => ({ send, close }));
  expect(target).not.toBeNull();
  await expect(target!.stop()).resolves.toBe(true);await expect(target!.stop()).resolves.toBe(true);
  expect(send.mock.calls.map(([method]) => method)).toEqual(["Target.getTargets", "Target.attachToTarget", "Page.stopLoading", "Page.navigate"]);
  expect(send).toHaveBeenCalledWith("Target.attachToTarget", { targetId: "owned", flatten: true });
  expect(send).toHaveBeenCalledWith("Page.stopLoading", {}, "owned-session");
  expect(send).toHaveBeenCalledWith("Page.navigate", { url: "about:blank" }, "owned-session");
  target!.close();expect(close).toHaveBeenCalledOnce();
});

it.each([
  { ids: [] }, { ids: ["other"] }, { ids: ["owned", "owned"] },
  { ids: Array.from({ length: 1100 }, (_, i) => `p${i}`) },
])("refuses missing, invalid or oversized target identity: $ids.length", async ({ ids }) => {
  const send = vi.fn(async () => ({ targetInfos: ids.map(targetId => ({ type: "page", targetId, url: "about:blank" })) }));
  const close = vi.fn();
  await expect(prepareNavigationStop(endpoint, "owned", () => true, async () => ({ send, close }))).resolves.toBeNull();
  expect(send).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
});

it.each(["errorText", "missing frame", "download", "disconnect", "target gone"])("does not report successful release on %s", async failure => {
  const send = vi.fn(async (method: string) => {
    if (method === "Target.getTargets") return { targetInfos: [{ type: "page", targetId: "owned" }] };
    if (method === "Target.attachToTarget") return { sessionId: "session" };
    if (failure === "target gone" && method === "Page.stopLoading") throw Error("target gone");
    if (method === "Page.navigate") {
      if (failure === "disconnect") throw Error("CDP disconnected");
      return failure === "errorText" ? { errorText: "net::ERR_ABORTED" } : failure === "download" ? { frameId: "frame", isDownload: true } : {};
    }
    return {};
  });
  const target = await prepareNavigationStop(endpoint, "owned", () => true, async () => ({ send, close: vi.fn() }));
  await expect(target!.stop()).resolves.toBe(false);target!.close();
  if (failure === "target gone") expect(send.mock.calls.map(([method]) => method)).not.toContain("Page.navigate");
});

it("does not prepare or dispatch an already cancelled call", async () => {
  const abort = new AbortController();abort.abort();
  const prepare = vi.fn(), work = vi.fn(), uncertain = vi.fn();
  await expect(withNavigationCancellation(abort.signal, prepare, work, uncertain)).rejects.toBeDefined();
  expect(prepare).not.toHaveBeenCalled();expect(work).not.toHaveBeenCalled();expect(uncertain).not.toHaveBeenCalled();
});

it("closes preparation without stopping a page if cancelled before dispatch", async () => {
  const abort = new AbortController();const prepared = deferred<NavigationStop | null>();
  const target = { stop: vi.fn(async () => true), close: vi.fn() };
  const work = vi.fn(), uncertain = vi.fn();
  const pending = withNavigationCancellation(abort.signal, () => prepared.promise, work, uncertain);
  const rejected = expect(pending).rejects.toBeDefined();
  abort.abort();prepared.resolve(target);await rejected;
  expect(work).not.toHaveBeenCalled();expect(target.stop).not.toHaveBeenCalled();
  expect(target.close).toHaveBeenCalledOnce();expect(uncertain).not.toHaveBeenCalled();
});

it("drains a cancelled request before releasing its page and suppresses late results", async () => {
  const abort = new AbortController();const reply = deferred<string>();const started = deferred<void>();
  const target = { stop: vi.fn(async () => { reply.resolve("late old result");return true; }), close: vi.fn() };
  const uncertain = vi.fn();
  const pending = withNavigationCancellation(abort.signal, async () => target, () => { started.resolve();return reply.promise; }, uncertain);
  const rejected = expect(pending).rejects.toBeInstanceOf(BrowserNavigationCancelled);
  await started.promise;abort.abort();await rejected;
  expect(target.stop).toHaveBeenCalledOnce();expect(target.close).toHaveBeenCalledOnce();expect(uncertain).not.toHaveBeenCalled();
});

it("marks unknown when there is no safe target instead of stopping other pages", async () => {
  const abort = new AbortController();const reply = deferred<string>();const started = deferred<void>();const uncertain = vi.fn();
  const pending = withNavigationCancellation(abort.signal, async () => null, () => { started.resolve();return reply.promise; }, uncertain);
  const rejected = expect(pending).rejects.toThrow(/could not be confirmed/);
  await started.promise;abort.abort();await rejected;
  expect(uncertain).toHaveBeenCalledOnce();reply.resolve("old work eventually answered");
});

it.each(["original RPC settled", "human takeover", "budget expired", "cleanup closed"])("does not blank after a delayed ACK when %s", async reason => {
  const ack = deferred<Record<string, unknown>>(), stopping = deferred<void>(), running = deferred<string>(), started = deferred<void>();
  let permitted = true;
  const send = vi.fn(async (method: string) => {
    if (method === "Target.getTargets") return { targetInfos: [{ type: "page", targetId: "owned" }] };
    if (method === "Target.attachToTarget") return { sessionId: "session" };
    if (method === "Page.stopLoading") { stopping.resolve();return ack.promise; }
    return { frameId: "frame" };
  });
  const abort = new AbortController();let target: NavigationStop | null = null;const uncertain = vi.fn();
  const pending = withNavigationCancellation(abort.signal, async current => target = await prepareNavigationStop(endpoint, "owned", current, async () => ({ send, close: vi.fn() })), () => { started.resolve();return running.promise; }, uncertain, () => permitted);
  const rejected = expect(pending).rejects.toBeInstanceOf(BrowserNavigationCancelled);
  await started.promise;abort.abort();await stopping.promise;
  if (reason === "original RPC settled") { running.resolve("original settled");await Promise.resolve();await Promise.resolve(); }
  else if (reason === "cleanup closed") target!.close();
  else permitted = false;
  ack.resolve({});await rejected;running.resolve("late reply");
  expect(send.mock.calls.map(([method]) => method)).not.toContain("Page.navigate");expect(uncertain).toHaveBeenCalledOnce();
});

it("bounds an unacknowledged stop and fences the late ACK", async () => {
  vi.useFakeTimers();
  try {
    const ack = deferred<Record<string, unknown>>(), started = deferred<void>(), stopping = deferred<void>(), reply = deferred<string>();
    const send = vi.fn(async (method: string) => {
      if (method === "Target.getTargets") return { targetInfos: [{ type: "page", targetId: "owned" }] };
      if (method === "Target.attachToTarget") return { sessionId: "session" };
      if (method === "Page.stopLoading") { stopping.resolve();return ack.promise; }
      return { frameId: "frame" };
    });
    const abort = new AbortController();const uncertain = vi.fn();
    const pending = withNavigationCancellation(abort.signal, current => prepareNavigationStop(endpoint, "owned", current, async () => ({ send, close: vi.fn() })), () => { started.resolve();return reply.promise; }, uncertain);
    const rejected = expect(pending).rejects.toThrow(/could not be confirmed/);
    await started.promise;abort.abort();await stopping.promise;await vi.advanceTimersByTimeAsync(1501);await rejected;
    expect(uncertain).toHaveBeenCalledOnce();ack.resolve({});reply.resolve("late");await Promise.resolve();await Promise.resolve();
    expect(send.mock.calls.map(([method]) => method)).not.toContain("Page.navigate");
  } finally { vi.useRealTimers(); }
});

it("removes the old abort handler after completion so it cannot stop the next task", async () => {
  const abort = new AbortController();const target = { stop: vi.fn(async () => true), close: vi.fn() };
  await expect(withNavigationCancellation(abort.signal, async () => target, async () => "done", vi.fn())).resolves.toBe("done");
  abort.abort();await Promise.resolve();expect(target.stop).not.toHaveBeenCalled();expect(target.close).toHaveBeenCalledOnce();
});
