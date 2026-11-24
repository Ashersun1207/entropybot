// @vitest-environment happy-dom
import { act, createElement, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { initialState, reducer, type Bot } from "@/state/store";
import { BotRulesSettings } from "../MemorySettings";

const request = vi.hoisted(() => vi.fn());
const currentStore = vi.hoisted(() => vi.fn());
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(), api: request, useStore: currentStore,
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("saves and clears a single bot's Markdown, and discards unsaved text when switching bots", async () => {
  const first: Bot = {
    id: "first", threadId: "a", name: "First", title: "", description: "", messages: [],
    defaultRules: "## Existing rules", notifications: true, color: "green", unread: false,
    modelSelection: { instanceId: "fake", model: "fixture" },
  };
  const second = { ...first, id: "second", defaultRules: undefined };
  function Panel({ id }: { id: string }) {
    const [state, dispatch] = useReducer(reducer, { ...initialState, bots: [first, second] });
    currentStore.mockReturnValue({ state, dispatch });
    return createElement(BotRulesSettings, { bot: state.bots.find((bot) => bot.id === id)! });
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (id: string) => act(() => root.render(createElement(Panel, { id })));
  const area = () => host.querySelector("textarea")!;
  const save = () => host.querySelector("button")!;
  const edit = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area(), value);
    area().dispatchEvent(new Event("input", { bubbles: true }));
  });
  try {
    render(first.id);
    expect(area().value).toBe(first.defaultRules);
    edit("规".repeat(1_334));
    expect(save().disabled).toBe(true);
    expect(area().getAttribute("aria-invalid")).toBe("true");
    render(second.id);
    expect(area().value).toBe("");
    render(first.id);
    const rules = "## 回复\n- 先给结论。";
    edit(rules);
    request.mockRejectedValueOnce(new Error("temporary failure"));
    await act(async () => save().click());
    expect(area().value).toBe(rules);
    expect(save().disabled).toBe(false);
    for (const value of [rules, ""]) {
      edit(value);
      const next = { ...first };
      if (value) next.defaultRules = value;
      else delete next.defaultRules;
      request.mockResolvedValueOnce({ bot: next });
      await act(async () => save().click());
      expect(request).toHaveBeenLastCalledWith("/api/bots/first", {
        method: "PATCH", body: JSON.stringify({ defaultRules: value }), timeoutMs: 10_000,
      });
      expect(area().value).toBe(value);
      expect(save().disabled).toBe(true);
    }
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
