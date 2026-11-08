import { t } from "../lib/i18n";
import type { RoutineRun } from "../lib/routines";
import { decodeManualRoutineScope, type ManualRoutineScope } from "../lib/session";
import { api } from "./api";

export const MANUAL_RUN_STORAGE = "entropybot.manual-routine-intents.v1";
type Marker = ManualRoutineScope & { routineId: string; key: string; phase: "pending" | "confirmed" };
type Ledger = { version: 1; entries: Marker[] };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sameScope = (a: ManualRoutineScope, b: ManualRoutineScope) => a.environmentId === b.environmentId && a.contextId === b.contextId;

export class ManualRunError extends Error {
  constructor(readonly reason: "blocked" | "unknown" | "changed") { super(t(`routines.manual.${reason}`)); }
}

function load(storage: Storage): Ledger {
  const raw = storage.getItem(MANUAL_RUN_STORAGE);
  if (raw === null) return { version: 1, entries: [] };
  if (raw.length > 32_000) throw new ManualRunError("blocked");
  const ledger = JSON.parse(raw) as Ledger;
  if (ledger?.version !== 1 || !Array.isArray(ledger.entries) || ledger.entries.length > 32 || ledger.entries.some((m) =>
    !m || typeof m.environmentId !== "string" || !uuid.test(m.environmentId) || typeof m.contextId !== "string" ||
    !/^mr1_[a-f0-9]{64}$/.test(m.contextId) || typeof m.routineId !== "string" || !m.routineId || m.routineId.length > 256 ||
    typeof m.key !== "string" || !uuid.test(m.key) || !["pending", "confirmed"].includes(m.phase)) ||
    new Set(ledger.entries.map((m) => m.routineId)).size !== ledger.entries.length) throw new ManualRunError("blocked");
  return ledger;
}

function save(storage: Storage, marker: Marker) {
  const ledger = load(storage);
  ledger.entries = ledger.entries.filter((m) => m.routineId !== marker.routineId);
  if (ledger.entries.length >= 32) {
    const confirmed = ledger.entries.findIndex((m) => m.phase === "confirmed");
    if (confirmed < 0) throw new ManualRunError("blocked");
    ledger.entries.splice(confirmed, 1);
  }
  ledger.entries.push(marker);
  const encoded = JSON.stringify(ledger);
  storage.setItem(MANUAL_RUN_STORAGE, encoded);
  if (storage.getItem(MANUAL_RUN_STORAGE) !== encoded) throw new ManualRunError("blocked");
}

async function authoritativeScope(): Promise<ManualRoutineScope> {
  const [environment, session] = await Promise.all([
    api<unknown>("/.well-known/entropybot/environment", { cache: "no-store", credentials: "same-origin" }),
    api<unknown>("/api/auth/session", { cache: "no-store", credentials: "same-origin" }),
  ]);
  const scope = decodeManualRoutineScope(environment, session);
  if (!scope) throw new ManualRunError("blocked");
  return scope;
}

export function decodeManualRun(body: unknown, routineId: string): RoutineRun | null {
  const response = Object(body) as { run?: RoutineRun; error?: unknown; ok?: unknown };
  const run = response.run;
  return response.error === undefined && response.ok !== false && run && typeof run.id === "string" && uuid.test(run.id) && run.routineId === routineId && run.manual === true &&
    run.triggerSource === "manual" && run.webhookId === undefined && run.deliveryId === undefined && run.eventSource === undefined &&
    typeof run.botId === "string" && run.botId.length > 0 && typeof run.routineName === "string" &&
    ["bot", "room-goal"].includes(run.target) && ["maus", "cloud"].includes(run.runOn) &&
    ["queued", "running", "waiting", "completed", "failed", "missed", "cancelled"].includes(run.status) &&
    Number.isFinite(run.createdAt) && Number.isFinite(run.scheduledFor) ? run : null;
}

export function createRoutineRunIntents() {
  const inFlight = new Map<string, { scope: Promise<ManualRoutineScope>; promise: Promise<RoutineRun> }>();
  const uncertain = new Map<string, Marker>();
  const execute = async (routineId: string, scope: ManualRoutineScope, settings: () => Promise<void>, acknowledgePriorRun: boolean): Promise<RoutineRun> => {
    let marker: Marker | undefined;
    try {
      const storage = globalThis.localStorage;
      const previous = load(storage).entries.find((m) => m.routineId === routineId);
      const held = uncertain.get(routineId);
      if (held && (!previous || previous.key !== held.key)) throw new ManualRunError("blocked");
      if (previous?.phase === "pending" && !sameScope(previous, scope) && !acknowledgePriorRun) throw new ManualRunError("changed");
      await settings();
      const current = await authoritativeScope();
      if (!sameScope(scope, current)) throw new ManualRunError("changed");
      // Re-read after awaits so another mounted consumer's unknown request keeps its identity.
      const latest = load(storage).entries.find((m) => m.routineId === routineId);
      if (latest?.phase === "pending" && !sameScope(latest, scope) && !acknowledgePriorRun) throw new ManualRunError("changed");
      marker = latest?.phase === "pending" && !acknowledgePriorRun ? latest : {
        ...scope, routineId, key: crypto.randomUUID(), phase: "pending",
      };
      save(storage, marker);
      uncertain.set(routineId, marker);
      const body: unknown = await api(`/api/routines/${encodeURIComponent(routineId)}/run-protected`, {
        method: "POST", credentials: "same-origin", timeoutMs: 30_000,
        headers: { "Idempotency-Key": marker.key, "X-Entropybot-Manual-Context": marker.contextId },
      });
      const run = decodeManualRun(body, routineId);
      if (!run) throw new ManualRunError("unknown");
      const persisted = load(storage).entries.find((m) => m.routineId === routineId);
      if (!persisted || persisted.key !== marker.key || !sameScope(persisted, marker)) throw new ManualRunError("unknown");
      save(storage, { ...marker, phase: "confirmed" });
      uncertain.delete(routineId);
      return run;
    } catch (error) {
      if (error instanceof ManualRunError) throw error;
      throw new ManualRunError(marker ? "unknown" : "blocked");
    }
  };
  return {
    run(routineId: string, settings: () => Promise<void>, acknowledgePriorRun = false): Promise<RoutineRun> {
      const pending = inFlight.get(routineId);
      const scope = authoritativeScope().catch(() => { throw new ManualRunError("blocked"); });
      if (pending) {
        return Promise.all([scope, pending.scope]).then(([current, captured]) => {
          if (!sameScope(captured, current)) throw new ManualRunError("changed");
          return pending.promise;
        });
      }
      const promise = scope.then((captured) => execute(routineId, captured, settings, acknowledgePriorRun));
      const entry = { scope, promise };
      inFlight.set(routineId, entry);
      void promise.finally(() => { if (inFlight.get(routineId) === entry) inFlight.delete(routineId); }).catch(() => {});
      return promise;
    },
  };
}
