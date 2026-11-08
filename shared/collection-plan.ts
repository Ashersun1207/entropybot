/** Explicit manual collection execution; every admitted run retains its own plan. */
export interface RoutineCollectionPlan {
  kind: "web-collection";
  version: 1;
  sources: Array<{ url: string }>;
  limits: { pages: number; bytes: number; pageBytes: number; attempts: number; durationMs: number };
}
