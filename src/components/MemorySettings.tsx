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
          templates={[t("settings.memory.ruleExample"), t("settings.memory.ruleSourcesExample"), t("settings.memory.ruleConfirmExample")]}
          rows={4} onSave={save} />
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

function MemoryExample({ text, onInsert, insertDisabled }: { text: string; onInsert?: () => void; insertDisabled?: boolean }) {
  const id = useId();
  return (
    <div className="group flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md bg-inset px-2.5 py-1.5 text-ink">
      <span id={id} className="min-w-[9rem] flex-1 select-text">{text}</span>
      <div className="flex shrink-0 items-center gap-1">
        {onInsert && <button type="button" className="ui-button" aria-describedby={id} disabled={insertDisabled} onClick={onInsert}>
          {t("settings.memory.useExample")}
        </button>}
        <CopyButton text={text} describedBy={id} className="shrink-0 opacity-100" />
      </div>
    </div>
  );
}

function MemoryEditingGuide() {
  return (
    <Card title={t("settings.memory.editGuide")}>
      <div data-memory-edit-guide className="space-y-2.5 text-[13px] leading-relaxed text-ink-secondary">
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

function RulesEditor({ confirmed, label, help, templates, rows = 8, disabled = false, onSave }: {
  confirmed: string; label: string; help: string; templates?: readonly string[]; rows?: number; disabled?: boolean; onSave: (value: string) => Promise<void>;
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
  const ruleLines = value.split(/\r?\n/).map((line) => line.trim());
  const insert = (template: string) => {
    setDraft(value.trim() ? `${value}${value.endsWith("\n") ? "" : "\n"}${template}` : template);
    setStatus("idle");
    editor.current?.focus();
  };

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
        {templates && (
          <details data-memory-rule-templates className="border-t border-hairline/50 pt-2 text-[13px] leading-relaxed text-ink-secondary">
            <summary className="cursor-pointer rounded-sm font-medium text-ink focus-visible:outline-focus">
              {t("settings.memory.ruleTemplates")}
            </summary>
            <div className="mt-2 grid gap-1.5">
              <p>{t("settings.memory.ruleTemplatesHelp")}</p>
              {templates.map((text) => <MemoryExample key={text} text={text}
                onInsert={() => insert(text)} insertDisabled={disabled || saving || ruleLines.includes(text)} />)}
            </div>
          </details>
        )}
      </form>
    </Card>
  );
}
