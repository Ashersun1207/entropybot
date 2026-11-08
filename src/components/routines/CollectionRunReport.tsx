import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import type { RoutineRun } from "@/lib/routines";
import { ApiError } from "@/state/api";
import { BoundedJsonError } from "@/lib/bounded-json";
import { fetchCollectionReport } from "./collection-report-fetch";
import { collectionReportView, collectionSummary } from "./collection-report-view";

export function CollectionRunReport({ run }: { run: RoutineRun }) {
  return <Report key={`${run.routineId}:${run.id}`} run={run} />;
}

function Report({ run }: { run: RoutineRun }) {
  const summary = collectionSummary(run.output);
  const [report, setReport] = useState<ReturnType<typeof collectionReportView>>(null);
  const [error, setError] = useState<"collection.reportMissing" | "collection.reportDenied" | "collection.reportInvalid" | "collection.reportFailed" | null>(null);
  const [loading, setLoading] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const load = async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true); setError(null);
    try {
      const value = await fetchCollectionReport(run.routineId, run.id, controller.signal);
      if (controller.signal.aborted) return;
      const parsed = collectionReportView(value);
      if (!parsed || (summary && (parsed.pages !== summary.pages || parsed.unique !== summary.unique || parsed.hash !== summary.hash))) setError("collection.reportInvalid");
      else setReport(parsed);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof ApiError
        ? cause.status === 401 || cause.status === 403 ? "collection.reportDenied"
          : cause.status === 404 || (cause.status === 409 && cause.body?.code === "collection_report_unavailable") ? "collection.reportMissing"
            : cause.status === 409 || cause.status === 422 ? "collection.reportInvalid" : "collection.reportFailed"
        : cause instanceof BoundedJsonError ? "collection.reportInvalid" : "collection.reportFailed");
    } finally {
      if (!controller.signal.aborted) { active.current = null; setLoading(false); }
    }
  };
  const available = run.status === "completed" && Boolean(summary);
  return (
    <section aria-label={t("collection.report")} className="space-y-2 rounded-xl border border-hairline/40 bg-inset p-3 text-[12px] text-ink-secondary">
      {summary && <p>{t("collection.counts", summary)}</p>}
      <p>{t(available ? "collection.reportAvailable" : "collection.reportUnavailable")}</p>
      {run.error && <p className="text-danger">{t("collection.runFailed")}</p>}
      {available && !report && <button type="button" disabled={loading} onClick={() => void load()} className="ui-button text-[12px]">{t(loading ? "collection.loading" : "collection.viewReport")}</button>}
      {error && <p role="alert" className="text-danger">{t(error)}</p>}
      {report && <div>
        <p>{t("collection.inertHelp")}</p>
        {report.sources.map((source, index) => <details key={index} className="mt-2 rounded-lg border border-hairline/40 p-2">
          <summary className="cursor-pointer break-all text-ink">{t("collection.source", { number: index + 1 })}</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-ink">{source.url}{"\n\n"}{source.text.slice(0, 20_000)}</pre>
          {source.text.length > 20_000 && <p>{t("collection.previewBound")}</p>}
        </details>)}
      </div>}
    </section>
  );
}
