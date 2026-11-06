// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import type { ConfigStatus } from "@/state/store";

const fixture = vi.hoisted(() => ({ config: null as Partial<ConfigStatus> | null, api: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ state: { config: fixture.config }, dispatch: fixture.dispatch }),
}));
const { MemorySettings } = await import("./MemorySettings");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const memory = (patch: Partial<NonNullable<ConfigStatus["memoryEmbedding"]>> = {}) => ({
  enabled: false, configured: false, storage: "none" as const, url: "https://embedding.example.test/v1/embeddings",
  model: "synthetic-embedding", dimensions: 1024, timeoutMs: 8000, ...patch,
});
const status = (patch: Parameters<typeof memory>[0] = {}) => ({ memoryEmbedding: memory(patch) }) as ConfigStatus;
const render = () => act(async () => root.render(createElement(MemorySettings)));
const button = (name: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === name)!;
const click = async (node: HTMLElement) => { await act(async () => node.click()); };
const input = async (label: string, value: string) => {
  const field = label === t("memorySettings.keyLabel") ? host.querySelector<HTMLInputElement>("input[type=password]")!
    : host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return field;
};
const bridge = (patch: Parameters<typeof memory>[0] = { configured: true, storage: "secure" }) => {
  const setCredential = vi.fn().mockResolvedValue(status(patch));
  window.ogb = { setCredential } as unknown as NonNullable<Window["ogb"]>;
  return setCredential;
};

beforeEach(() => {
  setLocale("en");
  fixture.config = status();
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fixture.dispatch.mockImplementation((action: { config: ConfigStatus }) => {
    fixture.config = action.config;
    root.render(createElement(MemorySettings));
  });
  delete window.ogb;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete window.ogb;
  setLocale("en");
});

it("PATCHes only non-sensitive parameters and leaves credentials out of HTTP", async () => {
  fixture.api.mockResolvedValue(status({ enabled: true, model: "updated", dimensions: 512, timeoutMs: 4000 }));
  await render();
  await click(host.querySelector('[role="switch"]')!);
  await input(t("memorySettings.model"), "updated");
  await input(t("memorySettings.dimensions"), "512");
  await input(t("memorySettings.timeoutMs"), "4000");
  await click(button(t("memorySettings.save")));
  expect(fixture.api).toHaveBeenCalledExactlyOnceWith("/api/config", { method: "PATCH", body: JSON.stringify({ memoryEmbedding: {
    enabled: true, url: memory().url, model: "updated", dimensions: 512, timeoutMs: 4000,
  } }) });
  expect(fixture.dispatch).toHaveBeenCalledWith({ type: "configStatus", config: fixture.config });
  expect(host.textContent).toContain(t("memorySettings.saved"));
});

it("keeps the secure key out of PATCH even when a new key has been entered", async () => {
  bridge();
  fixture.api.mockResolvedValue(status({ model: "updated" }));
  await render();
  await input(t("memorySettings.keyLabel"), "synthetic-secret");
  await input(t("memorySettings.model"), "updated");
  await click(button(t("memorySettings.save")));
  expect(JSON.stringify(fixture.api.mock.calls)).not.toContain("synthetic-secret");
});

it.each(["0", "-3", "1.5", ""]) ("rejects invalid dimensions %s before PATCH", async (value) => {
  await render();
  await input(t("memorySettings.dimensions"), value);
  expect(button(t("memorySettings.save")).disabled).toBe(true);
  expect(fixture.api).not.toHaveBeenCalled();
});

it("rejects credentials in the endpoint", async () => {
  await render();
  await input(t("memorySettings.url"), "https://user:secret@embedding.example.test/v1/embeddings");
  expect(button(t("memorySettings.save")).disabled).toBe(true);
});

it("saves through the memory credential slot and clears only after secure success", async () => {
  const setCredential = bridge();
  await render();
  const key = await input(t("memorySettings.keyLabel"), "synthetic-secret");
  expect(key.type).toBe("password");
  await click(button(t("memorySettings.saveKey")));
  expect(setCredential).toHaveBeenCalledExactlyOnceWith("memoryEmbeddingKey", "synthetic-secret");
  expect(key.value).toBe("");
  expect(host.textContent).toContain(t("memorySettings.keySaved"));
  expect(fixture.api).not.toHaveBeenCalled();
});

it("serializes repeated credential clicks while a secure save is pending", async () => {
  let finish!: (value: ConfigStatus) => void;
  const setCredential = bridge().mockImplementation(() => new Promise<ConfigStatus>((resolve) => { finish = resolve; }));
  await render();
  await input(t("memorySettings.keyLabel"), "synthetic-secret");
  const save = button(t("memorySettings.saveKey"));
  await act(async () => { save.click(); save.click(); });
  expect(setCredential).toHaveBeenCalledTimes(1);
  expect(save.disabled).toBe(true);
  await act(async () => finish(status({ configured: true, storage: "secure" })));
  expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
});

it("replaces and removes a saved key through the same bridge with an empty deletion value", async () => {
  fixture.config = status({ configured: true, storage: "secure" });
  const setCredential = bridge();
  await render();
  await input(t("memorySettings.keyLabel"), "synthetic-replacement");
  await click(button(t("memorySettings.replaceKey")));
  expect(setCredential).toHaveBeenLastCalledWith("memoryEmbeddingKey", "synthetic-replacement");
  setCredential.mockResolvedValue(status());
  await click(button(t("memorySettings.removeKey")));
  expect(setCredential).toHaveBeenLastCalledWith("memoryEmbeddingKey", "");
  expect(fixture.config?.memoryEmbedding?.configured).toBe(false);
  expect(host.textContent).toContain(t("memorySettings.keyRemoved"));
  expect(fixture.api).not.toHaveBeenCalled();
});

it("keeps a failed key edit and never renders the bridge error", async () => {
  bridge().mockRejectedValue(new Error("vendor-body synthetic-secret"));
  await render();
  const key = await input(t("memorySettings.keyLabel"), "synthetic-secret");
  await click(button(t("memorySettings.saveKey")));
  expect(key.value).toBe("synthetic-secret");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("memorySettings.keyFailed"));
  expect(host.textContent).not.toContain("vendor-body");
  expect(fixture.api).not.toHaveBeenCalled();
});

it.each(["plaintext", "unavailable", undefined] as const)("does not confirm a key saved without secure status: %s", async (storage) => {
  bridge({ configured: true, storage: storage as "plaintext" });
  await render();
  const key = await input(t("memorySettings.keyLabel"), "synthetic-secret");
  await click(button(t("memorySettings.saveKey")));
  expect(key.value).toBe("synthetic-secret");
  expect(host.textContent).not.toContain(t("memorySettings.keySaved"));
  expect(host.textContent).not.toContain(t("memorySettings.secureStorage"));
});

it("does not report deletion confirmed while secure storage is unavailable", async () => {
  fixture.config = status({ configured: true, storage: "secure" });
  bridge({ configured: false, storage: "unavailable" });
  await render();
  await click(button(t("memorySettings.removeKey")));
  expect(host.textContent).toContain(t("memorySettings.keyFailed"));
  expect(host.textContent).not.toContain(t("memorySettings.keyRemoved"));
});

it("never tries to delete a process environment key from the desktop credential slot", async () => {
  fixture.config = status({ configured: true, storage: "environment" });
  const setCredential = bridge();
  await render();
  expect(button(t("memorySettings.removeKey")).disabled).toBe(true);
  expect(setCredential).not.toHaveBeenCalled();
});

it("offers no HTTP or plaintext key fallback without the bridge", async () => {
  fixture.config = status({ configured: true, storage: "plaintext" });
  await render();
  expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.disabled).toBe(true);
  expect(button(t("memorySettings.replaceKey")).disabled).toBe(true);
  expect(button(t("memorySettings.removeKey")).disabled).toBe(true);
  expect(host.textContent).toContain(t("memorySettings.desktopRequired"));
  expect(host.textContent).toContain(t("memorySettings.plaintext"));
  expect(host.textContent).not.toContain(t("memorySettings.secureStorage"));
  expect(fixture.api).not.toHaveBeenCalled();
});

it.each(["secure", "plaintext", "environment", "unavailable", "none", undefined] as const)("describes the actual credential source %s", async (storage) => {
  fixture.config = status({ configured: storage !== "none", storage: storage as "none" });
  await render();
  const expected = storage === "secure" ? "memorySettings.secureStorage" : storage === "plaintext" ? "memorySettings.plaintext"
    : storage === "environment" ? "memorySettings.environment" : storage === "unavailable" ? "memorySettings.storageUnavailable"
      : storage === "none" ? "memorySettings.notConfigured" : "memorySettings.storageUnknown";
  expect(host.textContent).toContain(t(expected));
  if (storage !== "secure") expect(host.textContent).not.toContain(t("memorySettings.secureStorage"));
});

it("tests saved settings with an empty body and reports only verified dimensions", async () => {
  fixture.config = status({ configured: true, storage: "environment" });
  fixture.api.mockResolvedValue({ ok: true, dimensions: 1024 });
  await render();
  await click(button(t("memorySettings.test")));
  expect(fixture.api).toHaveBeenCalledExactlyOnceWith("/api/memory/embedding/test", { method: "POST", body: "{}" });
  expect(host.textContent).toContain(t("memorySettings.testOk", { dimensions: 1024 }));
});

it("requires saving parameters and any draft key before testing", async () => {
  fixture.config = status({ configured: true, storage: "secure" });
  bridge();
  await render();
  await input(t("memorySettings.model"), "unsaved");
  expect(button(t("memorySettings.test")).disabled).toBe(true);
  await input(t("memorySettings.model"), memory().model);
  await input(t("memorySettings.keyLabel"), "synthetic-secret");
  expect(button(t("memorySettings.test")).disabled).toBe(true);
  expect(host.textContent).toContain(t("memorySettings.saveFirst"));
  expect(fixture.api).not.toHaveBeenCalled();
});

it.each([{ ok: false, reason: "synthetic-secret" }, { ok: true, dimensions: 3 }, { ok: true, dimensions: "synthetic-secret" }])("redacts malformed or failed test responses %j", async (result) => {
  fixture.config = status({ configured: true, storage: "secure" });
  fixture.api.mockResolvedValue(result);
  await render();
  await click(button(t("memorySettings.test")));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("memorySettings.testFailed"));
  expect(host.textContent).not.toContain("synthetic-secret");
});

it("redacts a test timeout without clearing the saved configuration", async () => {
  fixture.config = status({ configured: true, storage: "secure" });
  fixture.api.mockRejectedValue(new Error("timeout: synthetic-secret"));
  await render();
  await click(button(t("memorySettings.test")));
  expect(host.textContent).toContain(t("memorySettings.testFailed"));
  expect(host.textContent).not.toContain("synthetic-secret");
  expect(fixture.config.memoryEmbedding?.configured).toBe(true);
});

it("redacts transport errors and keeps unsaved parameters after save failure", async () => {
  fixture.api.mockRejectedValue(new Error("synthetic-secret vendor-response"));
  await render();
  const model = await input(t("memorySettings.model"), "keep-me");
  await click(button(t("memorySettings.save")));
  expect(model.value).toBe("keep-me");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(t("memorySettings.saveFailed"));
  expect(host.textContent).not.toContain("vendor-response");
});

it("renders Chinese disclosure and shows an older server as unavailable", async () => {
  setLocale("zh-CN");
  await render();
  expect(host.textContent).toContain("记忆文本和检索查询会发送");
  expect(host.textContent).toContain("可能产生费用");
  expect(button("保存记忆设置")).toBeDefined();
  fixture.config = null;
  await render();
  expect(host.textContent).toContain(t("memorySettings.unavailable"));
  expect(host.querySelector("input")).toBeNull();
});
