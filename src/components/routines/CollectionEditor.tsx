import { useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { t } from "@/lib/i18n";
import type { Routine, RoutineInput } from "@/lib/routines";
import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "../bot-settings/BotEditorContext";
import { BotPicker } from "./BotPicker";
import { collectionPlan, collectionSources } from "./collection-input";

export function CollectionEditor({ routine, bots, initialBotId, lockedBotId, onClose }: {
  routine?: Routine; bots: Bot[]; initialBotId?: string; lockedBotId?: string; onClose: () => void;
}) {
  const { dispatch } = useStore();
  const { request } = useBotEditor();
  const [name, setName] = useState(routine?.name ?? "");
  const [botId, setBotId] = useState(lockedBotId ?? routine?.botId ?? initialBotId ?? bots[0]?.id ?? "");
  const [urls, setUrls] = useState(routine?.collection?.sources.map(source => source.url).join("\n") ?? "");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useModalDialog(ref, onClose);
  const sources = collectionSources(urls);
  const limits = routine?.collection?.limits;
  const overBudget = Boolean(sources && limits && (sources.length > limits.pages || sources.length > limits.attempts));
  const valid = Boolean(name.trim() && sources && !overBudget && bots.some(bot => bot.id === botId));
  const save = async () => {
    if (!valid || !sources || savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setError(false);
    const input: RoutineInput = {
      name: name.trim(), prompt: routine?.prompt ?? t("collection.title"), botId,
      collection: collectionPlan(sources, routine?.collection), enabled: false, runOn: "maus", target: "bot",
      schedule: routine?.schedule ?? { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] },
      runOnStartup: false, continuity: false, attachments: [], checks: null, deliver: null,
      resultsThreadId: botId === routine?.botId ? routine.resultsThreadId ?? null : null,
    };
    try {
      const response = await request(routine ? `/api/routines/${routine.id}` : "/api/routines", {
        method: routine ? "PATCH" : "POST", body: JSON.stringify(input),
      });
      dispatch({ type: "routinePatched", routine: response.routine });
      onClose();
    } catch { setError(true); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 backdrop-blur-sm" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t("collection.title")} tabIndex={-1} className="max-h-[94vh] w-full max-w-[760px] overflow-y-auto rounded-2xl border border-hairline/60 bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-hairline/40 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-ink">{t("collection.title")}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded-full p-2 text-ink-secondary hover:bg-raised"><X size={18} /></button>
        </div>
        <div className="space-y-5 px-5 py-5 sm:px-8">
          <p className="text-[13px] leading-relaxed text-ink-secondary">{t("collection.manualHelp")}</p>
          <input autoFocus value={name} onChange={event => setName(event.target.value)} aria-label={t("routines.editor.titleLabel")} placeholder={t("routines.editor.titlePlaceholder")} className="w-full border-b border-hairline/60 bg-transparent pb-2 text-[22px] font-medium text-ink outline-none focus:border-accent" />
          <div><div className="mb-2 text-[13px] font-medium text-ink">{t("routines.editor.who")}</div>
            <BotPicker bots={bots} selected={[botId]} multiple={false} locked={Boolean(lockedBotId)} onChange={ids => setBotId(ids[0] ?? "")} />
          </div>
          <label className="block text-[13px] font-medium text-ink">{t("collection.urls")}
            <textarea value={urls} onChange={event => setUrls(event.target.value)} rows={7} aria-label={t("collection.urls")} aria-describedby="collection-url-help" aria-invalid={Boolean(urls && (!sources || overBudget))} className="mt-2 w-full resize-y rounded-xl border border-hairline/50 bg-inset px-3.5 py-3 font-mono text-[13px] text-ink outline-none focus:border-accent" />
          </label>
          <p id="collection-url-help" className="text-[12px] text-ink-secondary">{t("collection.urlHelp")}</p>
          {urls && !sources && <p role="alert" className="text-[12px] text-danger">{t("collection.invalidUrls")}</p>}
          {overBudget && <p role="alert" className="text-[12px] text-danger">{t("collection.overBudget")}</p>}
          {error && <p role="alert" className="text-[12px] text-danger">{t("collection.saveFailed")}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-hairline/40 px-5 py-3.5">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-[13px] text-ink-secondary hover:bg-raised">{t("common.cancel")}</button>
          <button type="button" onClick={() => void save()} disabled={!valid || saving} className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2 text-[13px] font-semibold text-accent-ink disabled:opacity-40">{saving && <Loader2 size={14} className="animate-spin" />}{t("automations.editor.app.save")}</button>
        </div>
      </div>
    </div>
  );
}
