import { useId, useState } from "react";
import { MEMORY_DEFAULT_RULES_MAX_BYTES } from "../../shared/memory-default-rules";
import { t } from "@/lib/i18n";
import { api, useStore, type Bot, type BotAnnouncement, type ConfigStatus } from "@/state/store";
import { AdminOnly } from "./AdminOnly";
import { Card } from "./SettingsPrimitives";

export function MemorySettings() {
  const { state, dispatch } = useStore();
  const save = async (value: string) => {
    const config = await api<ConfigStatus>("/api/config", {
      method: "PATCH", body: JSON.stringify({ memory: { defaultRules: value } }), timeoutMs: 10_000,
    });
    dispatch({ type: "configStatus", config });
  };
  return (
    <RulesEditor confirmed={state.config?.memory?.defaultRules ?? ""} disabled={state.config === null}
      label={t("settings.memory.defaultRules")} help={t("settings.memory.defaultRulesHelp")} onSave={save} />
  );
}

export function BotRulesSettings({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const save = async (value: string) => {
    const result = await api<{ bot: BotAnnouncement }>(`/api/bots/${bot.id}`, {
      method: "PATCH", body: JSON.stringify({ defaultRules: value }), timeoutMs: 10_000,
    });
    dispatch({ type: "botPatched", bot: result.bot });
  };
  return (
    <AdminOnly>
      <RulesEditor key={bot.id} confirmed={bot.defaultRules ?? ""} label={t("memory.rules")}
        help={t("memory.rulesHelp")} onSave={save} />
    </AdminOnly>
  );
}

function RulesEditor({ confirmed, label, help, disabled = false, onSave }: {
  confirmed: string; label: string; help: string; disabled?: boolean; onSave: (value: string) => Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const value = draft ?? confirmed;
  const bytes = new TextEncoder().encode(value).byteLength;
  const overBudget = bytes > MEMORY_DEFAULT_RULES_MAX_BYTES;
  const saving = status === "saving";
  const canSave = !disabled && value !== confirmed && !overBudget && !saving;

  const save = async () => {
    if (!canSave) return;
    setStatus("saving");
    try {
      await onSave(value);
      setDraft(null);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  return (
    <Card>
      <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label htmlFor={id} className="text-[14px] font-medium text-ink">{label}</label>
        <p id={`${id}-help`} className="text-[13px] text-ink-secondary">{help}</p>
        <textarea
          id={id} rows={8} value={value} disabled={saving || disabled}
          aria-describedby={`${id}-help ${id}-budget`} aria-invalid={overBudget}
          onChange={(event) => { setDraft(event.target.value); setStatus("idle"); }}
          className="min-h-[120px] w-full resize-y rounded-lg border border-hairline/40 bg-inset px-3 py-2 font-mono text-[14px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
          <button type="submit" className="ui-button ui-button-primary" disabled={!canSave}>
            {t(saving ? "settings.profile.saving" : "common.save")}
          </button>
          <span id={`${id}-budget`} className={overBudget ? "text-danger" : "text-ink-secondary"}>
            {t(overBudget ? "botIdentity.soul.bytesOver" : "botIdentity.soul.bytes", { bytes, limit: MEMORY_DEFAULT_RULES_MAX_BYTES })}
          </span>
          <span role="status">
            {status === "saved" && <span className="text-success">{t("settings.profile.saved")}</span>}
            {status === "error" && <span className="text-danger">{t("settings.profile.saveError")}</span>}
          </span>
        </div>
      </form>
    </Card>
  );
}
