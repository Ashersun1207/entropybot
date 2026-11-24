// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { AppSettingsSection } from "@/state/store";

const fx = vi.hoisted(() => ({
  section: "engines" as AppSettingsSection,
  advanced: false,
  config: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  dispatch: vi.fn(),
  api: vi.fn(),
}));
const { marker } = vi.hoisted(() => ({ marker: (name: string) => () => `MARKER:${name};` }));

vi.mock("@/state/store", async (original) => {
  const actual = await original<typeof import("@/state/store")>();
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => { fx.listeners.add(listener); return () => { fx.listeners.delete(listener); }; };
  let snapshot = { section: fx.section, config: fx.config };
  const read = () => snapshot.section === fx.section && snapshot.config === fx.config ? snapshot : (snapshot = { section: fx.section, config: fx.config });
  return {
    ...actual,
    api: (...args: unknown[]) => fx.api(...args),
    useStore: () => {
      const { section, config } = useSyncExternalStore(subscribe, read);
      return { state: { ...actual.initialState, appSettingsSection: section, config, instances: [], bots: [] }, dispatch: fx.dispatch };
    },
  };
});
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fx.advanced, setAdvancedMode: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn(), track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => null }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("./EnginesSettings", () => ({ EnginesSettings: marker("engines") }));
vi.mock("./DecisionModelSettings", () => ({ DecisionModelSettings: marker("decisionModel") }));
vi.mock("./RemoteComputerSection", () => ({ RemoteComputerSection: marker("companion") }));
vi.mock("./CustomDomainSettings", () => ({ CustomDomainSettings: () => null }));
vi.mock("./CompanionSection", () => ({ CompanionSection: () => null }));
vi.mock("./ServerPairingCard", () => ({ ServerPairingCard: () => null }));
vi.mock("./ConnectedWorkspacesSettings", () => ({ ConnectedWorkspacesSettings: marker("desktopWorkspaces") }));
vi.mock("./LocalComputerSection", () => ({ LocalComputerSection: marker("computer") }));
vi.mock("./CloudAccountSettings", () => ({ CloudAccountSettings: marker("cloudAccount") }));
vi.mock("./OrganizationSettings", () => ({ OrganizationSettings: marker("organization") }));
vi.mock("./PeopleSection", () => ({ PeopleSection: marker("people") }));
vi.mock("./ActivitySection", () => ({ ActivitySection: marker("activity") }));
vi.mock("./UsageSection", () => ({ UsageSection: marker("usage") }));
vi.mock("./ImportSettings", () => ({ ImportSettings: marker("import") }));
vi.mock("./LoginsSettings", () => ({ LoginsSettings: marker("logins") }));
vi.mock("./BrowserSettingsRows", () => ({ BuiltInBrowserRow: marker("browser"), ServerSitesRow: () => null }));

const { SettingsModal } = await import("./SettingsModal");

let host: HTMLDivElement;
let root: Root;

function publish() {
  for (const listener of Array.from(fx.listeners)) listener();
}

const search = () => host.querySelector<HTMLInputElement>("[data-settings-search]")!;
const result = (id: string) => host.querySelector<HTMLButtonElement>(`[data-settings-key-result="${id}"]`);
const row = (id: string) => host.querySelector<HTMLElement>(`[data-key-row="${id}"]`)!;

function type(value: string) {
  flushSync(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search(), value);
    search().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  setLocale("en");
  fx.section = "engines";
  fx.config = { composio: { configured: false }, box: { configured: false }, vps: { configured: false, sshAlias: "" } };
  fx.dispatch.mockReset();
  fx.dispatch.mockImplementation((action: { type: string; section?: AppSettingsSection; config?: Record<string, unknown> }) => {
    if (action.type === "toggleAppSettings" && action.section) fx.section = action.section;
    if (action.type === "configStatus") fx.config = action.config!;
    publish();
  });
  vi.stubGlobal("ogb", undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("searching Settings for a key", () => {
  it.each([false, true])("lists it by name and section and lands on its row, focused (Advanced: %s)", async (advanced) => {
    fx.advanced = advanced;
    flushSync(() => root.render(createElement(SettingsModal)));
    type("fish");
    const found = result("fishAudio")!;
    expect(found.textContent).toBe("Fish Audio API key · Voice and calls");
    flushSync(() => found.click());
    expect(search().value).toBe("");
    expect(fx.section).toBe("connections");
    const input = () => row("fishAudio").querySelector<HTMLInputElement>("[data-key-input]");
    await vi.waitFor(() => expect(document.activeElement).toBe(input()));
    expect(row("fishAudio").hasAttribute("data-key-highlight")).toBe(true);
    expect(row("fishAudio").closest("[hidden]")).toBeNull();
  });

  it("names the OpenAI key twice: once for models, once for live calls", () => {
    flushSync(() => root.render(createElement(SettingsModal)));
    type("openai");
    expect(result("openai")!.textContent).toBe("OpenAI API key · AI providers");
    expect(result("liveCalls")!.textContent).toBe("OpenAI key · Voice and calls");
  });

  it("says plainly when nothing matches", () => {
    flushSync(() => root.render(createElement(SettingsModal)));
    type("zzzz");
    expect(host.textContent).toContain("Nothing matches “zzzz”");
    expect(host.querySelector("[data-settings-key-result]")).toBeNull();
  });
});

it.each([false, true])("opens Memory and saves the Markdown editor through config (Advanced: %s)", async (advanced) => {
  fx.advanced = advanced;
  fx.section = "memory";
  const { loadConfig } = await import("../../server/config");
  fx.config = { ...fx.config, memory: loadConfig().memory, profile: { aboutMe: "My time zone is UTC" } };
  const updated = "## 回复\n- 先给结论";
  const patchConfig = vi.fn().mockRejectedValueOnce(new Error("temporary failure"))
    .mockResolvedValueOnce({ ...fx.config, memory: { defaultRules: updated } })
    .mockResolvedValueOnce({ ...fx.config, memory: { defaultRules: "" } });
  fx.api.mockReset();
  fx.api.mockImplementation((path, init) => path === "/api/profile/learned" ? Promise.resolve({ learned: [] }) : patchConfig(path, init));
  flushSync(() => root.render(createElement(SettingsModal)));

  const editor = () => [...host.querySelectorAll("label")].find((item) => item.textContent === "Global default rules")?.control as HTMLTextAreaElement;
  const aboutMe = host.querySelector<HTMLTextAreaElement>("#profile-about-me");
  const guide = host.querySelector("dl")?.textContent;
  expect(editor().form!.textContent).toContain("Bots without their own rules");
  for (const text of ["Library → What it remembers → Rules", "replace the entire global set", "SOUL.md", "MEMORY.md", "memory/", "AGENTS.md", "Settings → General"]) {
    expect(guide).toContain(text);
  }
  const editingGuide = host.querySelector("[data-memory-edit-guide]");
  const more = editingGuide?.querySelector<HTMLDetailsElement>("details");
  const editingNotes = more?.querySelector("[data-memory-edit-notes]");
  for (const text of ["Edit global rules and About me", "one-on-one chat", "Check what was saved"]) {
    expect([...editingGuide!.children].filter((item) => item !== more).map((item) => item.textContent).join(" ")).toContain(text);
  }
  expect(more?.hasAttribute("open")).toBe(false);
  expect(editingGuide?.querySelectorAll("button")).toHaveLength(3);
  expect(more?.querySelectorAll("button")).toHaveLength(2);
  expect(more?.textContent).toContain("the 25th to the 28th");
  expect(more?.textContent).toContain("to About me");
  for (const text of ["check both", "tool permissions", "API keys"]) {
    expect(editingNotes?.textContent).toContain(text);
  }
  expect(aboutMe?.value).toBe("My time zone is UTC");
  expect([...host.querySelectorAll("textarea")]).toEqual([editor(), aboutMe]);
  expect(editor().value).toBe("");
  expect(editor().getAttribute("rows")).toBe("4");
  const example = () => [...editor().form!.querySelectorAll("button")].find((button) => button.textContent === "Insert example");
  flushSync(() => example()!.click());
  expect(editor().value).toContain("Start progress updates");
  expect(patchConfig).not.toHaveBeenCalled();
  flushSync(() => root.render(null));
  flushSync(() => root.render(createElement(SettingsModal)));
  const area = editor();
  expect(area.value).toBe("");
  const save = () => area.form!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const edit = (text: string) => flushSync(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  edit("规".repeat(1_334));
  expect(area.getAttribute("aria-invalid")).toBe("true");
  expect(save().disabled).toBe(true);
  expect(area.form!.textContent).toContain("4002 / 4000 bytes");
  expect(patchConfig).not.toHaveBeenCalled();

  edit(updated);
  const status = () => area.form!.querySelector('[role="status"]')?.textContent;
  flushSync(() => save().click());
  await vi.waitFor(() => expect(status()).toContain("Could not save"));
  expect(area.value).toBe(updated);
  flushSync(() => save().click());
  await vi.waitFor(() => expect(status()).toBe("Saved"));
  const patch = { method: "PATCH", body: JSON.stringify({ memory: { defaultRules: updated } }), timeoutMs: 10_000 };
  expect(patchConfig).toHaveBeenCalledTimes(2);
  expect(patchConfig).toHaveBeenLastCalledWith("/api/config", patch);
  expect(save().disabled).toBe(true);
  expect(example()).toBeUndefined();

  edit("");
  flushSync(() => save().click());
  await vi.waitFor(() => expect(status()).toBe("Saved"));
  expect(patchConfig).toHaveBeenLastCalledWith("/api/config", { ...patch, body: JSON.stringify({ memory: { defaultRules: "" } }) });
  flushSync(() => root.render(null));
  flushSync(() => root.render(createElement(SettingsModal)));
  expect(host.querySelector<HTMLTextAreaElement>("form textarea")?.value).toBe("");
});
