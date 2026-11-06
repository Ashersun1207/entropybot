import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ handlers: new Map(), open: vi.fn(), loadVendor: vi.fn(), tag: "entropybot-v0.2.1" }));
vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "0.2.0", getPath: () => "/unused", hide: vi.fn() },
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

it("says up to date when the release tag is not newer", async () => {
  fixture.tag = "entropybot-v0.2.0";
  const updater = await import("./updater.mjs");
  updater.registerUpdaterIpc({ pageAllowed: () => true });
  await fixture.handlers.get("update:check")({});
  expect(fixture.handlers.get("update:get-state")({}).status).toBe("idle");
  expect(fixture.open).not.toHaveBeenCalled();
});
