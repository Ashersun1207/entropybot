// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

vi.mock("@/state/store", async (original) => {
  const store = await original<typeof import("@/state/store")>();
  return { ...store, useStore: () => ({ state: store.initialState, dispatch: vi.fn() }) };
});
vi.mock("../DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: { host: { platform: "other" } } }) }));
const { MemorySection } = await import("./MemorySection");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shows the HTTP 409 refusal after Undo without changing the editor or announcing restoration", async () => {
  const message = "This memory changed since that journal entry. Reread and review the current memory before undoing.";
  const requests: string[] = [];
  const row = { id: "old-edit", at: Date.now(), botId: "fixture", path: "MEMORY.md", actor: "person", via: "ui", kind: "edited", beforeHash: "a", afterHash: "b", diff: "-A\n+B", added: 1, removed: 1, canRevert: true };
  const capacity = { lines: 1, bytes: 1, maxLines: 200, maxBytes: 24000, loadedLines: 1, loadedBytes: 1, truncated: false, hash: "c" };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://fixture.test");
    requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
    let body: unknown;
    let status = 200;
    if (url.pathname.endsWith("/revert")) { status = 409; body = { error: message }; }
    else if (url.pathname.endsWith("/journal")) body = { entries: [row] };
    else if (url.pathname.endsWith("/upkeep")) body = { enabled: false, modelSteps: false };
    else if (url.pathname.endsWith("/file")) body = { path: "MEMORY.md", text: "C: current unrelated fact", hash: "c", exists: true };
    else body = { botId: "fixture", workspacePath: "/synthetic", index: capacity, topics: [], logs: [] };
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    const bot = { id: "fixture", name: "Memo", memoryEnabled: true, memoryUpkeep: false } as Bot;
    await act(async () => root.render(createElement(MemorySection, { bot, onToggle: vi.fn() })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const editor = host.querySelector("textarea")!;
    expect(editor.value).toBe("C: current unrelated fact");
    const undo = [...host.querySelectorAll("button")].find((button) => button.textContent === "Undo")!;
    expect(undo).toBeDefined();
    const count = requests.length;
    await act(async () => undo.click());
    expect(host.textContent).toContain(message);
    expect(host.textContent).not.toContain("Restored");
    expect(editor.value).toBe("C: current unrelated fact");
    expect(undo.disabled).toBe(false);
    expect(requests.slice(count)).toEqual(["POST /api/bots/fixture/memory/journal/old-edit/revert"]);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
