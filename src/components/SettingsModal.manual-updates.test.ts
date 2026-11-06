// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import type { UpdaterState } from "@/lib/updater";

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (event: object) => any>(),
  listeners: new Set<(state: UpdaterState) => void>(),
  pushed: [] as UpdaterState[], open: vi.fn(), install: vi.fn(), vendor: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "0.2.0", getPath: () => { throw new Error("must not access app files"); }, relaunch: fixture.install, quit: fixture.install },
  clipboard: {}, ipcMain: { handle: (name: string, handler: (event: object) => any) => fixture.handlers.set(name, handler) }, shell: { openExternal: fixture.open },
}));
vi.mock("node:module", async (original) => {
  const actual = await original<typeof import("node:module")>();
  return { ...actual, default: { ...actual, createRequire: () => fixture.vendor }, createRequire: () => fixture.vendor };
});
import { UpdatesRow } from "./AppSettingsRows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const state = () => fixture.handlers.get("update:get-state")!({}) as UpdaterState;
const button = () => host.querySelector("button")!;
const click = async () => { await act(async () => button().click()); };
const render = async () => { await act(async () => root.render(createElement(UpdatesRow))); };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  fixture.handlers.clear(); fixture.listeners.clear(); fixture.pushed = [];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ tag_name: "entropybot-v0.2.0" }) })));
  const modulePath = "../../electron/updater.mjs";
  const updater: {
    registerUpdaterIpc(options: { pageAllowed(event: object): boolean }): void;
    attachUpdaterWindow(window: { webContents: { send(channel: string, state: UpdaterState): void } }): void;
  } = await import(modulePath);
  updater.registerUpdaterIpc({ pageAllowed: () => true });
  updater.attachUpdaterWindow({ webContents: { send: (_channel: string, update: UpdaterState) => {
    fixture.pushed.push(update);
    for (const listener of fixture.listeners) listener(update);
  } } });
  window.ogb = { updater: {
    check: () => fixture.handlers.get("update:check")!({}), install: fixture.install,
    onState: (listener: (update: UpdaterState) => void) => {
      fixture.listeners.add(listener); listener(state());
      return () => { fixture.listeners.delete(listener); };
    },
  } } as unknown as NonNullable<Window["ogb"]>;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount()); host?.remove(); delete window.ogb;
  setLocale("en"); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each(["en", "zh-CN", "pt-br"])("renders the real manual updater failure and retries without installing in %s", async (locale) => {
  setLocale(locale);
  const canary = "SECRET_UPDATE_CANARY https://private.example.test/?token=secret";
  vi.mocked(fetch).mockRejectedValueOnce(new Error(canary));
  await render();
  expect(host.textContent).not.toContain(t("settings.updates.latest"));
  await click();
  expect(state()).toMatchObject({ status: "error", mode: "manual", retryable: true });
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("sidebar.update.checkFailed"));
  expect(button().textContent).toBe(t("common.tryAgain"));
  expect(button().disabled).toBe(false);
  expect(host.textContent).not.toContain(t("settings.updates.latest"));
  expect(JSON.stringify([state(), fixture.pushed, host.innerHTML])).not.toMatch(/SECRET_UPDATE_CANARY|private\.example|token=secret|Error:/);
  await click();
  expect(state()).toMatchObject({ status: "idle", version: "0.2.0", message: undefined });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain(t("settings.updates.latest"));
  expect(button().textContent).toBe(t("settings.updates.check"));
  for (const [url] of vi.mocked(fetch).mock.calls) expect(url).toBe("https://api.github.com/repos/Ashersun1207/entropybot/releases/latest");
  expect(fixture.install).not.toHaveBeenCalled(); expect(fixture.vendor).not.toHaveBeenCalled(); expect(fixture.open).not.toHaveBeenCalled();
});

it("removes the error while retrying, then shows the newer version and fixed release-page action", async () => {
  setLocale("en");
  let resolve!: (response: any) => void;
  vi.mocked(fetch).mockRejectedValueOnce(new Error("SECRET_UPDATE_CANARY"))
    .mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await render(); await click();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await click();
  expect(state()).toMatchObject({ status: "checking", message: undefined, version: undefined, retryable: true });
  expect(button().disabled).toBe(true);
  expect(button().textContent).toBe(t("settings.updates.checking"));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => resolve({ ok: true, json: async () => ({ tag_name: "entropybot-v0.2.1" }) }));
  expect(state()).toMatchObject({ status: "available", version: "0.2.1", message: undefined });
  expect(host.textContent).toContain(t("settings.updates.manualAvailable", { version: "0.2.1" }));
  expect(button().textContent).toBe(t("settings.updates.openReleases"));
  expect(fixture.open).toHaveBeenCalledExactlyOnceWith("https://github.com/Ashersun1207/entropybot/releases");
  expect(fixture.install).not.toHaveBeenCalled(); expect(fixture.vendor).not.toHaveBeenCalled();
});
