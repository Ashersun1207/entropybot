import { useId, useRef, useState } from "react";
import { MEMORY_DEFAULT_RULES_MAX_BYTES } from "../../shared/memory-default-rules";
import { t } from "@/lib/i18n";
import { api, useStore, type Bot, type BotAnnouncement, type ConfigStatus } from "@/state/store";
import { AboutMeSettings } from "./AboutMeSettings";
import { AdminOnly } from "./AdminOnly";
import { CopyButton } from "./MessageActions";
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
    <div className="@container/memory">
      <div className="grid min-w-0 items-start gap-4 @min-[760px]/memory:grid-cols-2 @min-[760px]/memory:grid-rows-[auto_auto_1fr]">
        <RulesEditor confirmed={state.config?.memory?.defaultRules ?? ""} disabled={state.config === null}
          label={t("settings.memory.defaultRules")} help={t("settings.memory.defaultRulesHelp")}
          example={t("settings.memory.ruleExample")} rows={4} onSave={save} />
        <MemoryEditingGuide />
        <div className="min-w-0 @min-[760px]/memory:col-start-2 @min-[760px]/memory:row-start-1 @min-[760px]/memory:row-span-3">
          <MemoryRulesGuide />
        </div>
        <Card>
          <AboutMeSettings />
        </Card>
      </div>
    </div>
  );
}

function memoryLocation() {
  return { library: t("botPanel.tab.library"), memory: t("botPanel.memoryRow") };
}

function MemoryExample({ text }: { text: string }) {
  const id = useId();
  return (
    <div className="group flex items-center justify-between gap-2 rounded-md bg-inset px-2.5 py-1.5 text-ink">
      <span id={id} className="min-w-0 select-text">{text}</span>
      <CopyButton text={text} describedBy={id} className="shrink-0 opacity-100" />
    </div>
  );
}

function MemoryEditingGuide() {
  return (
    <Card title={t("settings.memory.editGuide")}>
      <div data-memory-edit-guide className="space-y-2.5 text-[13px] leading-relaxed text-ink-secondary">
        <p>{t("settings.memory.editDirectHelp")}</p>
        <div>
          <p className="mb-1.5">{t("settings.memory.editByChatHelp")}</p>
          <MemoryExample text={t("settings.memory.chatRememberExample")} />
        </div>
        <p>{t("settings.memory.verifyEdit", memoryLocation())}</p>
        <details className="border-t border-hairline/50 pt-2">
          <summary className="cursor-pointer rounded-sm font-medium text-ink focus-visible:outline-focus">
            {t("settings.memory.editNotes")}
          </summary>
          <div className="mt-3 space-y-3">
            <section data-memory-rule-templates className="grid gap-1.5">
              <h3 className="font-medium text-ink">{t("settings.memory.ruleTemplates")}</h3>
              <p>{t("settings.memory.ruleTemplatesHelp")}</p>
              <MemoryExample text={t("settings.memory.ruleExample")} />
              <MemoryExample text={t("settings.memory.ruleSourcesExample")} />
              <MemoryExample text={t("settings.memory.ruleConfirmExample")} />
            </section>
            <section data-memory-chat-examples className="grid gap-1.5">
              <h3 className="font-medium text-ink">{t("settings.memory.chatExamples")}</h3>
              <p>{t("settings.memory.chatExamplesHelp")}</p>
              <MemoryExample text={t("settings.memory.chatCorrectExample")} />
              <MemoryExample text={t("settings.memory.chatPreferenceExample")} />
              <MemoryExample text={t("settings.memory.chatReviewExample")} />
              <MemoryExample text={t("settings.memory.chatForgetExample")} />
            </section>
            <ul data-memory-edit-notes className="list-disc space-y-1 ps-4">
              <li>{t("settings.memory.checkBoth")}</li>
              <li>{t("settings.memory.forgetScope")}</li>
              <li>{t("settings.memory.ruleEditScope")}</li>
              <li>{t("settings.memory.keepSecretsOut")}</li>
            </ul>
          </div>
        </details>
      </div>
    </Card>
  );
}

function MemoryRulesGuide() {
  const botMemory = memoryLocation();
  const entries = [
    { title: t("settings.memory.botRules"), detail: t("settings.memory.botRulesHelp", botMemory) },
    { title: t("botSettings.simple.instructions"), file: "SOUL.md", detail: t("settings.memory.soulHelp", { instructions: t("botSettings.simple.instructions") }) },
    { title: t("settings.memory.notes"), file: "MEMORY.md · memory/", detail: t("settings.memory.filesHelp", botMemory) },
    { title: t("settings.profile.aboutMe"), detail: t("settings.memory.sharedPreferences") },
    { title: t("settings.memory.projectRules"), file: "AGENTS.md", detail: t("settings.memory.projectRulesHelp") },
  ];
  return (
    <Card title={t("settings.memory.overview")}>
      <dl className="divide-y divide-hairline/50 text-[13px] leading-relaxed">
        {entries.map(({ title, file, detail }) => (
          <div key={title} className="grid gap-1 py-2.5 first:pt-0 last:pb-0">
            <dt className="flex flex-wrap items-baseline gap-x-2 font-medium text-ink">
              {title}
              {file && <code className="text-[12px] font-normal text-ink-secondary">{file}</code>}
            </dt>
            <dd className="text-ink-secondary">{detail}</dd>
          </div>
        ))}
      </dl>
    </Card>
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

function RulesEditor({ confirmed, label, help, example, rows = 8, disabled = false, onSave }: {
  confirmed: string; label: string; help: string; example?: string; rows?: number; disabled?: boolean; onSave: (value: string) => Promise<void>;
}) {
  const id = useId();
  const editor = useRef<HTMLTextAreaElement>(null);
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
        {example && !value.trim() && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-secondary">
            <span>{example}</span>
            <button type="button" className="ui-button" disabled={disabled || saving}
              onClick={() => { setDraft(example); setStatus("idle"); editor.current?.focus(); }}>
              {t("settings.memory.useExample")}
            </button>
          </div>
        )}
        <textarea
          ref={editor} id={id} rows={rows} value={value} disabled={saving || disabled}
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
