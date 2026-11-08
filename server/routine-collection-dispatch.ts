import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AutomationReports } from "./automation-reports.ts";
import type { RoutineRun } from "./routines.ts";
import { createCollectionHttpReader } from "./web-collection-http.ts";
import { hostWebCollection } from "./web-collection-host.ts";
import type { CollectionOptions } from "./web-collection.ts";

export interface CollectionDispatch {
  start(run: RoutineRun, requestId: string, settled: (output?: string, error?: string) => void): void;
  cancel(runId: string): void;
}

export function createRoutineCollectionDispatch(options: {
  dataDir: string;
  reports: Pick<AutomationReports, "publishCollection">;
  read?: CollectionOptions["read"];
}): CollectionDispatch {
  const active = new Map<string, AbortController>();
  const read = options.read ?? createCollectionHttpReader();
  return {
    start(run, requestId, settled) {
      if (active.has(run.id)) throw new Error("Collection dispatch already active");
      const controller = new AbortController();
      active.set(run.id, controller);
      const execute = async () => {
        if (!run.collection || !run.manual || run.triggerSource !== "manual" || run.target !== "bot" || run.runOn !== "maus") {
          throw new Error("Collection requires manual local bot execution");
        }
        const outputRoot = join(options.dataDir, "collection-reports");
        mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
        let output: string | undefined;
        const publish = async ({ text, signal }: { text: string; signal: AbortSignal }) => {
          await options.reports.publishCollection(run, text, AbortSignal.any([signal, AbortSignal.timeout(60_000)]));
          output = text;
        };
        const report = await hostWebCollection({ run, requestId, plan: { ...run.collection, version: "web-collection/1" },
          outputRoot, read, signal: controller.signal, publish, reconcile: publish });
        return output ?? `Web collection report\nPages: ${report.pages}\nUnique: ${report.unique}\nPath: ${JSON.stringify(report.path)}\nSHA-256: ${report.hash}`;
      };
      void execute().then(output => settled(output), () => settled(undefined, "Collection could not finish; inspect its durable receipts before authorizing a new run"))
        .catch(error => console.error("collection: could not settle run", error))
        .finally(() => active.delete(run.id));
    },
    cancel(runId) { active.get(runId)?.abort(new Error("Collection stopped")); },
  };
}
