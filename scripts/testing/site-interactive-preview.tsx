import { rememberConversation } from "../../src/lib/last-conversation";
import { wearSkin } from "../../src/lib/skins";
import { configureSitePreviewBase } from "./site-preview-base";
import { siteExample } from "./site-examples";
import { installSiteStorage } from "./site-browser-storage";
import { siteEnglish, siteText } from "./site-locale";

const params = new URLSearchParams(location.search);
const browserSite = document.documentElement.dataset.siteDemo === "browser";
if (browserSite) installSiteStorage();
const site = browserSite ? (await import("./site-browser-api")).installSiteBrowserApi() : null;
if (!browserSite) configureSitePreviewBase();
const botId = site?.mainBotId ?? params.get("bot");
try {
  if (botId && localStorage.getItem("entropybot.siteExperience") !== botId) {
    rememberConversation(botId);
    localStorage.setItem("entropybot.siteExperience", botId);
  }
} catch {
  if (botId) rememberConversation(botId);
}

const channel = "entropybot.site.v1";
const session = params.get("session");
const parentOrigin = browserSite ? location.origin : document.documentElement.dataset.siteParentOrigin ?? params.get("siteParentOrigin");
const roles = { research: siteText("资料助手", "Research assistant"), project: siteText("项目助手", "Project assistant"), personal: siteText("个人助理", "Personal assistant") } as const;
type Role = keyof typeof roles;
let ready = false;
let selectedRole: Role | null = null;
let bots: Array<{ id: string; name: string }> = [];
let connected = false;
let pendingSelection: { id: string; role: Role; focus: boolean; prompt?: string } | null = null;
try {
  connected = window.parent !== window && !!parentOrigin && new URL(document.referrer).origin === parentOrigin;
} catch {}
const post = (type: string, extra: Record<string, unknown> = {}) => {
  if (connected) window.parent.postMessage({ channel, session, type, ...extra }, parentOrigin!);
};
const selection = () => {
  const heading = document.querySelector("[data-chathead-pill]")?.textContent ?? "";
  return (Object.keys(roles) as Role[]).find(role => heading.includes(roles[role])) ?? null;
};
const confirmSelection = () => {
  if (!pendingSelection || selection() !== pendingSelection.role) return;
  const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
  if (!textarea?.placeholder.includes(roles[pendingSelection.role])) return;
  const pending = pendingSelection;
  pendingSelection = null;
  if (pending.prompt) {
    const preserved = !!textarea.value.trim();
    if (!preserved) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, pending.prompt);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.setSelectionRange(pending.prompt.length, pending.prompt.length);
    }
    post("applied", { id: pending.id, command: "example", role: pending.role, status: preserved ? "draft-preserved" : "draft-ready" });
  } else post("applied", { id: pending.id, command: "select", role: pending.role });
  if (pending.focus) textarea.focus({ preventScroll: true });
};
const checkState = () => {
  if (!ready && document.querySelector("textarea") && bots.length) {
    ready = true;
    post("ready");
    if (site) post("playback-state", { playing: site.isPlaying() });
  }
  const next = selection();
  if (ready && selectedRole !== next) {
    selectedRole = next;
    post("selection", { role: selectedRole });
  }
  confirmSelection();
};
window.addEventListener("site-playback-state", () => { if (ready && site) post("playback-state", { playing: site.isPlaying() }); });
const observer = new MutationObserver(checkState);
observer.observe(document.body, { subtree: true, childList: true, characterData: true });
window.addEventListener("message", event => {
  if (!connected || event.source !== window.parent || event.origin !== parentOrigin) return;
  const data = event.data;
  if (!data || data.channel !== channel || data.session !== session) return;
  if (data.type === "ping") {
    if (ready) post("ready");
    return;
  }
  if (!ready || typeof data.id !== "string" || data.id.length > 80) return;
  if (data.type === "playback" && typeof data.playing === "boolean" && site) {
    if (!site.setPlayback(data.playing)) return post("rejected", { id: data.id });
    if (data.playing) document.querySelector<HTMLElement>(`[data-sidebar-bot-row="${CSS.escape(site.mainBotId)}"]`)?.click();
    post("applied", { id: data.id, command: "playback", playing: site.isPlaying() });
  }
  if (data.type === "theme" && (data.skin === "midnight" || data.skin === "daylight")) {
    wearSkin(data.skin);
    post("applied", { id: data.id, command: "theme", skin: data.skin });
  }
  if (data.type === "example") {
    const example = siteExample(data.feature, data.choice, siteEnglish);
    if (!example) return post("rejected", { id: data.id });
    if (document.querySelector<HTMLTextAreaElement>("textarea")?.value.trim()) {
      post("applied", { id: data.id, command: "example", role: selection(), status: "draft-preserved" });
      document.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
      return;
    }
    const bot = bots.find(bot => bot.name === roles[example.role]);
    const row = bot && document.querySelector<HTMLElement>(`[data-sidebar-bot-row="${CSS.escape(bot.id)}"]`);
    if (!row) return post("rejected", { id: data.id });
    site?.setPlayback(false);
    pendingSelection = { id: data.id, role: example.role, focus: true, prompt: example.prompt };
    row.click();
    confirmSelection();
  }
  if (data.type === "select" && typeof data.role === "string" && Object.hasOwn(roles, data.role)) {
    const role = data.role as Role;
    const bot = bots.find(bot => bot.name === roles[role]);
    const row = bot && document.querySelector<HTMLElement>(`[data-sidebar-bot-row="${CSS.escape(bot.id)}"]`);
    if (!row) return post("rejected", { id: data.id });
    site?.setPlayback(false);
    pendingSelection = { id: data.id, role, focus: data.focus === true };
    row.click();
    confirmSelection();
  }
});
let composerFocused = false;
const focusEvents = new AbortController();
const announceFocus = (active: boolean) => {
  if (composerFocused === active) return;
  composerFocused = active;
  post("composer-focus", { active });
};
const readFocus = () => announceFocus(document.activeElement instanceof HTMLTextAreaElement);
document.addEventListener("focusin", readFocus, { signal: focusEvents.signal });
document.addEventListener("focusout", () => queueMicrotask(readFocus), { signal: focusEvents.signal });
window.addEventListener("blur", () => announceFocus(false), { signal: focusEvents.signal });
window.addEventListener("focus", readFocus, { signal: focusEvents.signal });
window.addEventListener("pagehide", () => { observer.disconnect(); focusEvents.abort(); }, { once: true });
const metadata = fetch("/api/bots?messages=0").then(async response => {
  if (!response.ok) throw new Error("Site fixture unavailable");
  bots = (await response.json()).bots;
  checkState();
});
await Promise.all([metadata, import("./site-screenshot-preview")]);
checkState();
