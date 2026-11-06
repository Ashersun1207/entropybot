import { useEffect, useRef, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { Card, SettingRow, Switch } from "./SettingsPrimitives";

type MemoryStatus = NonNullable<ConfigStatus["memoryEmbedding"]>;
type Draft = { enabled: boolean; url: string; model: string; dimensions: string; timeoutMs: string };
const STORAGE_TEXT: Record<MemoryStatus["storage"], LocaleKey> = {
  secure: "memorySettings.secureStorage",
  plaintext: "memorySettings.plaintext",
  environment: "memorySettings.environment",
  unavailable: "memorySettings.storageUnavailable",
  none: "memorySettings.notConfigured",
};
const draftFrom = (saved: MemoryStatus): Draft => ({ enabled: saved.enabled, url: saved.url, model: saved.model, dimensions: String(saved.dimensions), timeoutMs: String(saved.timeoutMs) });

function validDraft(draft: Draft): boolean {
  try {
    const url = new URL(draft.url.trim());
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
      && Boolean(draft.model.trim()) && [draft.dimensions, draft.timeoutMs].every((value) =>
        /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0);
  } catch {
    return false;
  }
}

export function MemorySettings() {
  const { state } = useStore();
  return state.config?.memoryEmbedding
    ? <MemorySettingsForm saved={state.config.memoryEmbedding} />
    : <Card title={t("settings.section.memory")} subtitle={t("memorySettings.unavailable")} />;
}

function MemorySettingsForm({ saved }: { saved: MemoryStatus }) {
  const { dispatch } = useStore();
  const [draft, setDraft] = useState(() => draftFrom(saved));
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string; test?: boolean } | null>(null);
  const bridge = window.ogb?.setCredential;
  const secure = Boolean(bridge) && window.ogb?.remoteClient?.active !== true;
  const removable = ["secure", "plaintext", "unavailable"].includes(saved.storage);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(saved));
  const unsaved = dirty || Boolean(key);

  useEffect(() => {
    setDraft(draftFrom(saved));
    setFeedback((current) => current?.test ? null : current);
  }, [saved.enabled, saved.url, saved.model, saved.dimensions, saved.timeoutMs]);
  useEffect(() => {
    setFeedback((current) => current?.test ? null : current);
  }, [saved.configured, saved.storage]);

  const change = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFeedback(null);
  };
  const applied = (config: ConfigStatus) => dispatch({ type: "configStatus", config });
  const run = async (action: () => Promise<void>, failure: string) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setFeedback(null);
    try { await action(); }
    catch { setFeedback({ error: true, text: failure }); }
    finally { operation.current = false; setBusy(false); }
  };
  const save = () => {
    if (!dirty || !validDraft(draft)) return;
    void run(async () => {
      const status = await api<ConfigStatus>("/api/config", { method: "PATCH", body: JSON.stringify({ memoryEmbedding: {
        enabled: draft.enabled, url: draft.url.trim(), model: draft.model.trim(),
        dimensions: Number(draft.dimensions), timeoutMs: Number(draft.timeoutMs),
      } }) });
      applied(status);
      setDraft(draftFrom(status.memoryEmbedding ?? saved));
      setFeedback({ error: false, text: t("memorySettings.saved") });
    }, t("memorySettings.saveFailed"));
  };
  const credential = (remove: boolean) => {
    if (!secure || !bridge || (!remove && !key.trim()) || (remove && !removable)) return;
    void run(async () => {
      const status = await bridge("memoryEmbeddingKey", remove ? "" : key.trim());
      applied(status);
      const result = status.memoryEmbedding;
      if (!result || (remove ? !["none", "environment"].includes(result.storage) : result.storage !== "secure" || !result.configured)) {
        throw new Error("credential_transaction_unconfirmed");
      }
      setKey("");
      setFeedback({ error: false, text: t(remove ? "memorySettings.keyRemoved" : "memorySettings.keySaved") });
    }, t("memorySettings.keyFailed"));
  };
  const test = () => {
    if (unsaved || !saved.configured) return;
    void run(async () => {
      const result = await api<{ ok: boolean; dimensions: number }>("/api/memory/embedding/test", { method: "POST", body: "{}" });
      if (!result.ok || !Number.isSafeInteger(result.dimensions) || result.dimensions < 1 || result.dimensions !== saved.dimensions) {
        setFeedback({ error: true, text: t("memorySettings.testFailed") });
        return;
      }
      setFeedback({ error: false, test: true, text: t("memorySettings.testOk", { dimensions: result.dimensions }) });
    }, t("memorySettings.testFailed"));
  };

  return (
    <div className="space-y-4" data-memory-settings>
      <Card title={t("settings.section.memory")} subtitle={t("memorySettings.intro")}>
        <p className="text-[13px] leading-relaxed text-ink-secondary">{t("memorySettings.privacy")}</p>
      </Card>
      <form onSubmit={(event) => { event.preventDefault(); save(); }} className="space-y-4">
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <legend className="sr-only">{t("memorySettings.parameters")}</legend>
          <SettingRow title={t("memorySettings.enabled")} subtitle={t("memorySettings.localFallback")}>
            <Switch checked={draft.enabled} aria-label={t("memorySettings.enabled")} onClick={() => change("enabled", !draft.enabled)} />
          </SettingRow>
          {(["url", "model", "dimensions", "timeoutMs"] as const).map((field) => (
            <SettingRow key={field} title={t(`memorySettings.${field}`)}>
              <input className="ui-input w-full" aria-label={t(`memorySettings.${field}`)} value={draft[field]}
                type={field === "url" ? "url" : field === "model" ? "text" : "number"}
                min={field === "dimensions" || field === "timeoutMs" ? 1 : undefined}
                step={field === "dimensions" || field === "timeoutMs" ? 1 : undefined}
                autoComplete="off" spellCheck={false} onChange={(event) => change(field, event.target.value)} />
            </SettingRow>
          ))}
          <div className="space-y-2 px-4">
            <p className="text-[12px] text-ink-secondary">{t("memorySettings.endpointHint")}</p>
            {dirty && !validDraft(draft) && <p role="alert" className="text-[13px] text-danger">{t("memorySettings.invalid")}</p>}
            <button type="submit" className="ui-button" disabled={!dirty || !validDraft(draft)}>{t("memorySettings.save")}</button>
          </div>
        </fieldset>
      </form>
      <Card title={t("memorySettings.keyTitle")}>
        <p className="text-[13px] text-ink-secondary">{t(saved.configured ? "memorySettings.configured" : "memorySettings.notConfigured")}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">{t(Object.hasOwn(STORAGE_TEXT, saved.storage) ? STORAGE_TEXT[saved.storage] : "memorySettings.storageUnknown")}</p>
        {!secure && <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">{t("memorySettings.desktopRequired")}</p>}
        <label className="mt-3 block text-[13px] text-ink" htmlFor="memory-embedding-key">{t("memorySettings.keyLabel")}</label>
        <input id="memory-embedding-key" type="password" className="ui-input mt-2 w-full" autoComplete="new-password" spellCheck={false}
          value={key} disabled={busy || !secure} onChange={(event) => { setKey(event.target.value); setFeedback(null); }} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="ui-button" disabled={busy || !secure || !key.trim()} onClick={() => credential(false)}>
            {t(saved.configured ? "memorySettings.replaceKey" : "memorySettings.saveKey")}
          </button>
          <button type="button" className="ui-button" disabled={busy || !secure || !removable} onClick={() => credential(true)}>{t("memorySettings.removeKey")}</button>
        </div>
      </Card>
      <Card title={t("memorySettings.testTitle")} subtitle={t("memorySettings.testHint")}>
        {unsaved && <p className="mb-3 text-[13px] text-ink-secondary">{t("memorySettings.saveFirst")}</p>}
        <button type="button" className="ui-button" disabled={busy || unsaved || !saved.configured} onClick={test}>{t("memorySettings.test")}</button>
      </Card>
      {busy && <p role="status" className="px-4 text-[13px] text-ink-secondary">{t("memorySettings.busy")}</p>}
      {feedback && <p role={feedback.error ? "alert" : "status"} className={`px-4 text-[13px] ${feedback.error ? "text-danger" : "text-ink-secondary"}`}>{feedback.text}</p>}
    </div>
  );
}
