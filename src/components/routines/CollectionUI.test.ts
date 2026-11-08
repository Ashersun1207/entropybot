// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";
import { BotEditorContext } from "../bot-settings/BotEditorContext";
import { CollectionEditor } from "./CollectionEditor";
import { CollectionRunReport } from "./CollectionRunReport";
import { collectionSources, collectionPlan } from "./collection-input";
import { collectionReportView, collectionSummary } from "./collection-report-view";

const mocks = vi.hoisted(() => ({ request: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/state/store", async original => ({ ...await original<typeof import("@/state/store")>(), useStore: () => ({ dispatch: mocks.dispatch }) }));
vi.mock("@/components/Avatar", () => ({ BotAvatar: () => null }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
const bot = { id: "bot", name: "Fixture", title: "", modelSelection: { instanceId: "fake", model: "fake" } } as Bot;
const plan = collectionPlan([{ url: "https://fixture.invalid/page" }]);
const routine: Routine = { id: "routine", name: "Fixture", prompt: "Metadata", botId: bot.id, collection: plan, target: "bot", runOn: "maus", enabled: false, schedule: { type: "daily", time: "09:00", weekdays: [1] }, durationMinutes: 30, nextRunAt: null, createdAt: 1, updatedAt: 1 };
const run: RoutineRun = { id: "run", routineId: routine.id, routineName: routine.name, botId: bot.id, collection: plan, target: "bot", runOn: "maus", manual: true, status: "completed", scheduledFor: 1, createdAt: 1, output: 'Web collection report\nPages: 2\nUnique: 1\nPath: "/secret/server/path"\nSHA-256: ' + "a".repeat(64) };
const content = { version: 1, pages: 2, unique: 1, hash: "a".repeat(64), sources: [{ url: "https://fixture.invalid/page", text: '<img src="https://evil.invalid/pixel" onerror="alert(1)">\n[open](file:///secret)\n<script>alert(1)</script>' }] };
let host: HTMLDivElement, root: Root;
const flush = async () => { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); };
const render = async (element: ReturnType<typeof createElement>) => { act(() => root.render(element)); await flush(); };
const click = async (label: string) => { const button = [...host.querySelectorAll("button")].find(node => node.textContent === label)!; expect(button, host.textContent ?? "").toBeTruthy(); await act(async () => button.click()); await flush(); };
const fill = async (selector: string, value: string) => { const node = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!; act(() => {
  const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true }));
}); await flush(); };
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); mocks.request.mockReset(); mocks.dispatch.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function editor(existing?: Routine) {
  return createElement(BotEditorContext.Provider, { value: { request: mocks.request } }, createElement(CollectionEditor, { routine: existing, bots: [bot], onClose: vi.fn() }));
}

describe("manual collection editor", () => {
  it("creates a source-only finite plan through the existing editor transport, without running", async () => {
    mocks.request.mockResolvedValue({ routine }); await render(editor());
    expect(mocks.request).not.toHaveBeenCalled();
    expect(host.querySelectorAll('input[type="time"],input[type="date"],input[type="checkbox"],select')).toHaveLength(0);
    await fill('input', 'My pages');
    await fill('textarea', 'https://fixture.invalid/a#one\nhttps://fixture.invalid/a#two');
    await click('Save');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.request.mock.calls[0]; expect(url).toBe('/api/routines'); expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ name: 'My pages', enabled: false, runOn: 'maus', target: 'bot', botId: bot.id, runOnStartup: false, checks: null, deliver: null, continuity: false, collection: { kind: 'web-collection', version: 1, sources: [{url:'https://fixture.invalid/a'}, {url:'https://fixture.invalid/a'}], limits: {pages:2, attempts:2} } });
  });
  it("edits without losing mode, budgets, schedule metadata or display prompt", async () => {
    mocks.request.mockResolvedValue({ routine }); await render(editor(routine)); await fill('input', 'Renamed'); await click('Save');
    const [url, init] = mocks.request.mock.calls[0]; expect(url).toBe('/api/routines/routine'); expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toMatchObject({ prompt: routine.prompt, collection: plan, schedule: routine.schedule, enabled: false });
  });
  it("rejects invalid input and over-budget edits rather than dropping lines", async () => {
    await render(editor(routine));
    for (const urls of ['https://user:pass@fixture.invalid', 'not a url', Array.from({length:101}, ()=>'https://fixture.invalid').join('\n')]) {
      await fill('textarea', urls); expect(host.querySelector('[role=alert]')?.textContent).toContain('Check every line'); expect([...host.querySelectorAll('button')].find(b=>b.textContent==='Save')?.disabled).toBe(true);
    }
    await fill('textarea', 'https://fixture.invalid/a\nhttps://fixture.invalid/b'); expect(host.textContent).toContain('exceeds the saved'); expect(mocks.request).not.toHaveBeenCalled();
  });
  it("guards duplicate saves and renders fixed errors without upstream paths", async () => {
    let reject!: (reason: Error) => void; mocks.request.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    await render(editor(routine)); const button = [...host.querySelectorAll('button')].find(b=>b.textContent==='Save')!;
    act(() => { button.click(); button.click(); }); expect(mocks.request).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('/private/secret'))); await flush(); expect(host.textContent).toContain('could not be saved'); expect(host.textContent).not.toContain('/private/secret');
  });
});

describe("collection report renderer (synthetic transport only)", () => {
  it("loads only on explicit action, never renders server paths or active source markup, and bounds previews", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...content, sources: [{ ...content.sources[0], text: content.sources[0].text + 'x'.repeat(30_000) }] })));
    vi.stubGlobal('fetch', fetcher); await render(createElement(CollectionRunReport, { run })); expect(fetcher).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Pages: 2 · Unique sources: 1'); expect(host.textContent).not.toContain('/secret/server/path');
    await click('View report'); expect(fetcher.mock.calls[0][0]).toBe('/api/routines/routine/runs/run/collection-report');
    expect(host.querySelectorAll('a,img,script,iframe')).toHaveLength(0); expect(host.querySelector('pre')?.textContent).toContain(content.sources[0].text);
    expect(host.querySelector('pre')!.textContent!.length).toBeLessThan(20_100); expect(host.textContent).toContain('first 20,000'); expect(host.querySelector('details')?.open).toBe(false);
  });
  it.each([[404, 'missing'], [403, 'do not have access'], [409, 'could not be verified'], [500, 'could not be loaded']] as const)("shows a distinct fixed failure for HTTP %s", async (status, text) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'/private/secret <img>'}), {status})));
    await render(createElement(CollectionRunReport, { run })); await click('View report'); expect(host.querySelector('[role=alert]')?.textContent).toContain(text); expect(host.textContent).not.toContain('/private/secret'); expect(host.querySelector('pre')).toBeNull();
  });
  it.each([{...content, pages:3}, {...content, hash:'b'.repeat(64)}, {...content, sources:[{url:content.sources[0].url,text:42}]}])("rejects malformed and mismatched report data %#", async value => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(value))));
    await render(createElement(CollectionRunReport, { run })); await click('View report'); expect(host.textContent).toContain('could not be verified'); expect(host.querySelector('pre')).toBeNull();
  });
  it("discards late responses after switching exact run", async () => {
    let resolve!: (value: Response) => void; vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(done => {resolve=done;})));
    await render(createElement(CollectionRunReport, { run })); await click('View report'); await render(createElement(CollectionRunReport, { run:{...run,id:'other',output:undefined,status:'running'} }));
    await act(async () => resolve(new Response(JSON.stringify(content)))); await flush(); expect(host.textContent).toContain('No completed report'); expect(host.querySelector('pre')).toBeNull();
  });
});

describe("collection input and report boundary", () => {
  it.each(['file:///tmp/x','https://u:p@fixture.invalid','https://fixture.invalid/a b','<https://fixture.invalid>','https://fixture.invalid/\\evil','https://fixture.invalid/'+'a'.repeat(8192)])('refuses %s', input => expect(collectionSources(input)).toBeNull());
  it('normalizes fragments but never silently deduplicates or truncates', () => expect(collectionSources('https://fixture.invalid/a#one\n\nhttps://fixture.invalid/a#two')).toEqual([{url:'https://fixture.invalid/a'},{url:'https://fixture.invalid/a'}]));
  it('never treats arbitrary output or invalid counts as summary', () => { expect(collectionSummary('Path: /private/secret')).toBeNull(); expect(collectionSummary('Web collection report\nPages: 1\nUnique: 2')).toBeNull(); });
  it('refuses hostile report shapes and bounds', () => {
    for(const value of [null,{}, {...content,unique:101}, {...content,hash:'bad'}, {...content,sources:[{url:'file:///secret',text:'x'}]}, {...content,sources:[{url:'https://u:p@fixture.invalid',text:'x'}]}, {...content,sources:[{url:'https://fixture.invalid',text:'x'.repeat(1_000_001)}]}]) expect(collectionReportView(value)).toBeNull();
    expect(collectionReportView(content)).toEqual(content);
  });
});
