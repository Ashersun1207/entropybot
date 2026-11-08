import { z } from "zod";
import type { RoutineCollectionPlan } from "../shared/collection-plan.ts";
import { collectionUrl } from "./web-collection.ts";

const finite = (max: number) => z.number().int().min(1).max(max);
const schema = z.object({
  kind: z.literal("web-collection"), version: z.literal(1),
  sources: z.array(z.object({ url: z.string().min(1).max(8192).transform(collectionUrl) }).strict()).min(1).max(100),
  limits: z.object({ pages: finite(100), bytes: finite(10_000_000), pageBytes: finite(1_000_000),
    attempts: finite(100), durationMs: finite(86_400_000) }).strict(),
}).strict().refine(plan => plan.sources.length <= plan.limits.pages, "Collection page limit is smaller than its sources");

export function cleanCollectionPlan(value: unknown): RoutineCollectionPlan | undefined {
  if (value === undefined) return undefined;
  try { return schema.parse(value); }
  catch { throw Object.assign(new Error("Invalid versioned collection plan or finite limits"), { status: 400 }); }
}

export function assertCollectionScope(input: { collection?: RoutineCollectionPlan; target?: string; runOn?: string;
  enabled?: boolean; runOnStartup?: boolean; checks?: unknown; deliver?: unknown; attachments?: unknown[]; continuity?: boolean }) {
  if (!input.collection) return;
  if ((input.target ?? "bot") !== "bot" || (input.runOn ?? "maus") !== "maus" || input.enabled !== false ||
    input.runOnStartup || input.checks != null || input.deliver != null || input.attachments?.length || input.continuity) {
    throw Object.assign(new Error("Collection requires manual-only (enabled: false), local bot execution without startup, checks, continuity, attachments or brief delivery"), { status: 400 });
  }
}
