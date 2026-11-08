import { routineRunVisible, type VisibleSet } from "../bot-visibility.ts";
import { CollectionReportError, readCollectionReport } from "../collection-report-access.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { RoutineManager } from "../routines.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createCollectionReportAccessRoutes(deps: {
  dataDir: string;
  routines(): Pick<RoutineManager, "listRuns" | "collectionRequestId"> | null;
  visible(auth: RequestAuth): VisibleSet;
  botExists(id: string): boolean;
  threadBot(id: string): string | undefined;
}): RouteHandler {
  return async ({ req, res, url, path, method, auth, json }) => {
    const match = /^\/api\/routines\/([\w-]+)\/runs\/([\w-]+)\/collection-report$/.exec(path);
    if (!match || method !== "GET") return PASS;
    res.setHeader("cache-control", "private, no-store");
    res.setHeader("x-content-type-options", "nosniff");
    if (auth.kind === "loopback" && req.headers.authorization) return json(res, 401, { code: "collection_report_unauthorized", error: "Collection report credentials are not valid for this client." });
    if (auth.kind === "loopback" && auth.trust === "service") return json(res, 403, { code: "collection_report_forbidden", error: "Collection report access requires an authorized client." });
    if (url.search) return json(res, 400, { code: "collection_report_query", error: "Collection report does not accept query parameters." });
    const manager = deps.routines();
    const run = manager?.listRuns().find(candidate => candidate.id === match[2] && candidate.routineId === match[1]);
    const visible = deps.visible(auth);
    if (!run || !run.botId || !run.threadId || !run.resultsThreadId || !deps.botExists(run.botId) || !routineRunVisible(run, visible) ||
      [run.threadId, run.resultsThreadId, run.sourceThreadId].some(id => id && (deps.threadBot(id) !== run.botId || !visible.thread(id)))) {
      return json(res, 404, { code: "collection_report_not_found", error: "No such collection report." });
    }
    const requestId = manager!.collectionRequestId(run.id, run.routineId);
    if (!requestId) return json(res, 409, { code: "collection_report_unavailable", error: "Collection report is not available." });
    try { return json(res, 200, readCollectionReport(deps.dataDir, run, requestId)); }
    catch (error) {
      if (!(error instanceof CollectionReportError)) throw error;
      return json(res, 409, { code: error.code, error: error.message });
    }
  };
}
