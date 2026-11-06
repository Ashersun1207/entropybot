import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ handlers: new Map(), open: vi.fn(), loadVendor: vi.fn(), install: vi.fn(), send: vi.fn(), tag: "entropybot-v0.2.1" }));
vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "0.2.0", getPath: () => { throw new Error("manual check must not access app files"); }, hide: vi.fn(), relaunch: fixture.install, quit: fixture.install },
  clipboard: {},
  ipcMain: { handle: (name, handler) => fixture.handlers.set(name, handler) },
  shell: { openExternal: fixture.open },
}));
vi.mock("node:module", () => ({ createRequire: () => fixture.loadVendor }));

beforeEach(() => {
  vi.resetModules();
  fixture.handlers.clear();
  fixture.tag = "entropybot-v0.2.1";
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ tag_name: fixture.tag }) })));
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function manualUpdater() {
  const updater = await import("./updater.mjs");
  updater.registerUpdaterIpc({ pageAllowed: () => true });
  updater.attachUpdaterWindow({ webContents: { send: fixture.send } });
  return {
    check: () => fixture.handlers.get("update:check")({}),
    state: () => fixture.handlers.get("update:get-state")({}),
  };
}

function onlyOwnApiWasUsed() {
  expect(fetch).toHaveBeenCalled();
  for (const args of vi.mocked(fetch).mock.calls) {
    expect(args).toEqual(["https://api.github.com/repos/Ashersun1207/entropybot/releases/latest", {
      headers: { accept: "application/vnd.github+json", "user-agent": "entropybot-update-check" }, signal: expect.any(AbortSignal),
    }]);
  }
  expect(fixture.loadVendor).not.toHaveBeenCalled();
  expect(fixture.install).not.toHaveBeenCalled();
  expect(() => fixture.handlers.get("update:install")({})).toThrow(/GitHub Releases/);
}

it.each([
  ["network", () => Promise.reject(new Error("synthetic-token https://private.example.test/diagnostics"))],
  ...[403, 500, 503].map((status) => [`HTTP ${status}`, () => Promise.resolve({ ok: false, status, json: async () => { throw new Error("response body must not be read"); } })]),
  ["timeout", () => Promise.reject(new DOMException("synthetic-token timeout", "TimeoutError"))],
  ["bad JSON", () => Promise.resolve({ ok: true, json: async () => { throw new SyntaxError("synthetic-token broken JSON"); } })],
  ["missing tag", () => Promise.resolve({ ok: true, json: async () => ({ body: "synthetic-token" }) })],
  ...["", "   ", null, 123, { value: "synthetic-token" }, "synthetic-token", "entropybot-v", "0.2.1/https://private.example.test/synthetic-token"].map((tag_name) =>
    [`invalid tag ${JSON.stringify(tag_name)}`, () => Promise.resolve({ ok: true, json: async () => ({ tag_name }) })]),
])("reports a retryable manual check failure for %s, not idle/latest", async (_name, response) => {
  vi.mocked(fetch).mockImplementation(response);
  const errorLog = vi.spyOn(console, "error");
  const warnLog = vi.spyOn(console, "warn");
  const updater = await manualUpdater();
  await updater.check();
  expect(updater.state()).toMatchObject({ mode: "manual", status: "error", retryable: true, message: "Couldn't check for updates. Try again." });
  expect(JSON.stringify(updater.state())).not.toMatch(/synthetic-token|private\.example|stack|diagnostics/);
  expect(JSON.stringify(fixture.send.mock.calls)).not.toMatch(/synthetic-token|private\.example|stack|diagnostics/);
  expect(errorLog).not.toHaveBeenCalled();
  expect(warnLog).not.toHaveBeenCalled();
  expect(fixture.send.mock.calls.at(-1)).toEqual(["update:state", updater.state()]);
  expect(fixture.open).not.toHaveBeenCalled();
  onlyOwnApiWasUsed();
});

it("uses the configured finite timeout signal and exits checking on abort", async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  vi.mocked(fetch).mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const updater = await manualUpdater();
  const checking = updater.check();
  expect(updater.state().status).toBe("checking");
  expect(timeout).toHaveBeenCalledExactlyOnceWith(8_000);
  controller.abort(new DOMException("synthetic-token", "TimeoutError"));
  await checking;
  expect(updater.state()).toMatchObject({ status: "error", retryable: true });
  expect(JSON.stringify(updater.state())).not.toContain("synthetic-token");
  onlyOwnApiWasUsed();
});

it("shares in-flight scheduled and IPC checks, then allows a clean retry after failure", async () => {
  vi.useFakeTimers();
  let rejectFirst;
  let resolveSecond;
  vi.mocked(fetch)
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
  const module = await import("./updater.mjs");
  const updater = await manualUpdater();
  module.startUpdater();
  await vi.advanceTimersByTimeAsync(15_000);
  const ipc = updater.check();
  expect(fetch).toHaveBeenCalledTimes(1);
  rejectFirst(new Error("synthetic-token old failure"));
  await ipc;
  expect(updater.state().status).toBe("error");
  const retry = updater.check();
  expect(updater.state()).toMatchObject({ status: "checking", message: undefined, version: undefined, retryable: true });
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  expect(fetch).toHaveBeenCalledTimes(2);
  resolveSecond({ ok: true, json: async () => ({ tag_name: "entropybot-v0.2.1" }) });
  await retry;
  rejectFirst(new Error("synthetic-token late failure"));
  await Promise.resolve();
  expect(updater.state()).toMatchObject({ status: "available", version: "0.2.1", message: undefined, retryable: true });
  for (const name of ["messageCode", "messageKey", "messageParams"]) expect(updater.state()[name]).toBeUndefined();
  expect(JSON.stringify(fixture.send.mock.calls)).not.toContain("synthetic-token");
  onlyOwnApiWasUsed();
});

it("clears a previously available version when a scheduled check fails", async () => {
  vi.useFakeTimers();
  const module = await import("./updater.mjs");
  const updater = await manualUpdater();
  module.startUpdater();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(updater.state()).toMatchObject({ status: "available", version: "0.2.1" });
  vi.mocked(fetch).mockRejectedValueOnce(new Error("synthetic-token"));
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  expect(updater.state()).toMatchObject({ status: "error", version: undefined, retryable: true });
  expect(fixture.open).not.toHaveBeenCalled();
  fixture.tag = "entropybot-v0.2.0";
  await updater.check();
  expect(updater.state()).toMatchObject({ status: "idle", version: "0.2.0", message: undefined });
  expect(fixture.open).not.toHaveBeenCalled();
  onlyOwnApiWasUsed();
});

it("clears the old error on retry and reports no newer release", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error("synthetic-token"));
  const updater = await manualUpdater();
  await updater.check();
  expect(updater.state().status).toBe("error");
  fixture.tag = "entropybot-v0.2.0";
  await updater.check();
  expect(updater.state()).toMatchObject({ status: "idle", version: "0.2.0" });
  expect(updater.state().message).toBeUndefined();
  expect(fixture.send.mock.calls.at(-2)[1]).toMatchObject({ status: "checking", message: undefined, version: undefined });
  expect(fixture.open).not.toHaveBeenCalled();
  onlyOwnApiWasUsed();
});

it("clears the old error on retry and retains the fixed newer-release action", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error("synthetic-token"));
  const updater = await manualUpdater();
  await updater.check();
  expect(updater.state().status).toBe("error");
  await updater.check();
  expect(updater.state()).toMatchObject({ status: "available", version: "0.2.1" });
  expect(updater.state().message).toBeUndefined();
  expect(fixture.open).toHaveBeenCalledExactlyOnceWith("https://github.com/Ashersun1207/entropybot/releases");
  onlyOwnApiWasUsed();
});

it("checks for a newer release without loading a binary updater or installing it", async () => {
  vi.useFakeTimers();
  try {
    const updater = await import("./updater.mjs");
    updater.startUpdater({ watch: () => { throw new Error("quiet install must not start"); } });
    updater.registerUpdaterIpc({ pageAllowed: () => true });
    const initial = fixture.handlers.get("update:get-state")({});
    expect(initial.mode).toBe("manual");
    expect(initial.releasesUrl).toBe("https://github.com/Ashersun1207/entropybot/releases");
    expect(fixture.loadVendor).not.toHaveBeenCalled();
    expect(updater.reopenedOutOfSight()).toBe(false);
    expect(() => fixture.handlers.get("update:install")({})).toThrow(/GitHub Releases/);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://api.github.com/repos/Ashersun1207/entropybot/releases/latest", expect.any(Object));
    const state = fixture.handlers.get("update:get-state")({});
    expect(state.status).toBe("available");
    expect(state.version).toBe("0.2.1");
    expect(fixture.loadVendor).not.toHaveBeenCalled();
    expect(fixture.open).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("only an authorized window can check, and opens the fixed release URL when newer", async () => {
  const updater = await import("./updater.mjs");
  updater.registerUpdaterIpc({ pageAllowed: (event) => event.trusted === true });
  expect(() => fixture.handlers.get("update:check")({ trusted: false })).toThrow(/only available/);
  expect(fixture.open).not.toHaveBeenCalled();
  await fixture.handlers.get("update:check")({ trusted: true });
  expect(fetch).toHaveBeenCalledExactlyOnceWith("https://api.github.com/repos/Ashersun1207/entropybot/releases/latest", expect.any(Object));
  expect(fixture.open).toHaveBeenCalledExactlyOnceWith("https://github.com/Ashersun1207/entropybot/releases");
});

it.each(["entropybot-v0.2.0", "entropybot-v0.1.9", "entropybot-v0.2.0-rc.1"])("says up to date when the release tag %s is not newer", async (tag) => {
  fixture.tag = tag;
  const updater = await import("./updater.mjs");
  updater.registerUpdaterIpc({ pageAllowed: () => true });
  await fixture.handlers.get("update:check")({});
  expect(fixture.handlers.get("update:get-state")({}).status).toBe("idle");
  expect(fixture.open).not.toHaveBeenCalled();
});
