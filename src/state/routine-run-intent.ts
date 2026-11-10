import { t } from "../lib/i18n";
import { randomUuid } from "../lib/random-uuid";
import type { RoutineRun } from "../lib/routines";
import { decodeManualRoutineScope, type ManualRoutineScope } from "../lib/session";
import { api } from "./api";
import { ManualRunCoordinationError, withManualRunLedger } from "./manual-run-coordination";

export const MANUAL_RUN_STORAGE = "entropybot.manual-routine-intents.v1";
/** Maximum time for one manual-run metadata preflight, including response bodies. */
export const MANUAL_ROUTINE_PREFLIGHT_TIMEOUT_MS = 5_000;
type Marker = ManualRoutineScope & { routineId: string; key: string; phase: "pending" | "confirmed" };
type Ledger = { version: 1; entries: Marker[] };
type RunOperation = { marker: Marker; run: RoutineRun };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sameScope = (a: ManualRoutineScope, b: ManualRoutineScope) => a.environmentId === b.environmentId && a.contextId === b.contextId;
const sameMarker = (a: Marker, b: Marker | undefined) => !!b && a.key === b.key && sameScope(a, b);

export class ManualRunError extends Error {
  constructor(readonly reason: "blocked" | "unknown" | "changed" | "coordination") { super(t(`routines.manual.${reason}`)); }
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

export function hasStoredManualRunIntent(routineId: string): boolean {
  try { return load(globalThis.localStorage).entries.some((marker) => marker.routineId === routineId); }
  catch { return true; }
}

function isCompleted(marker: Marker, completed: ReadonlyMap<string, Marker>) {
  const known = completed.get(marker.routineId);
  return marker.phase === "confirmed" && known?.key === marker.key && sameScope(known, marker);
}

function save(storage: Storage, marker: Marker, completed: ReadonlyMap<string, Marker>) {
  const ledger = load(storage);
  ledger.entries = ledger.entries.filter((m) => m.routineId !== marker.routineId);
  if (ledger.entries.length >= 32) {
    const confirmed = ledger.entries.findIndex((m) => isCompleted(m, completed));
    if (confirmed < 0) throw new ManualRunError("blocked");
    ledger.entries.splice(confirmed, 1);
  }
  ledger.entries.push(marker);
  const encoded = JSON.stringify(ledger);
  storage.setItem(MANUAL_RUN_STORAGE, encoded);
  if (storage.getItem(MANUAL_RUN_STORAGE) !== encoded) throw new ManualRunError("blocked");
}

async function authoritativeScope(): Promise<ManualRoutineScope> {
  const controller = new AbortController();
  const deadline = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new ManualRunError("blocked")), { once: true });
  });
  const timer = setTimeout(() => controller.abort(), MANUAL_ROUTINE_PREFLIGHT_TIMEOUT_MS);
  const init = { cache: "no-store", credentials: "same-origin", timeoutMs: MANUAL_ROUTINE_PREFLIGHT_TIMEOUT_MS, signal: controller.signal } as const;
  try {
    const [environment, session] = await Promise.race([
      Promise.all([
        api<unknown>("/.well-known/entropybot/environment", init),
        api<unknown>("/api/auth/session", init),
      ]),
      deadline,
    ]);
    const scope = decodeManualRoutineScope(environment, session);
    if (!scope) throw new ManualRunError("blocked");
    return scope;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
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
  const inFlight = new Map<string, { scope: Promise<ManualRoutineScope>; promise: Promise<RunOperation> }>();
  const uncertain = new Map<string, Marker>();
  const completed = new Map<string, Marker>();
  const needsRecovery = (marker: Marker) => !isCompleted(marker, completed);
  const execute = async (routineId: string, scope: ManualRoutineScope, settings: () => Promise<void>, acknowledgePriorRun: boolean | undefined, recovery: Marker | undefined): Promise<RunOperation> => {
    let marker: Marker | undefined;
    try {
      const storage = globalThis.localStorage;
      const previous = load(storage).entries.find((m) => m.routineId === routineId);
      const held = uncertain.get(routineId);
      if (held && (!previous || previous.key !== held.key || !sameScope(previous, held))) throw new ManualRunError("blocked");
      if (previous && (held || needsRecovery(previous) || acknowledgePriorRun === false) && !sameScope(previous, scope) && !acknowledgePriorRun) throw new ManualRunError("changed");
      await settings();
      const current = await authoritativeScope();
      if (!sameScope(scope, current)) throw new ManualRunError("changed");
      const reserved = await withManualRunLedger(() => {
        const latest = load(storage).entries.find((m) => m.routineId === routineId);
        if (held && !sameMarker(held, latest) || recovery && !sameMarker(recovery, latest)) throw new ManualRunError("blocked");
        const pending = held ?? (latest && (needsRecovery(latest) || acknowledgePriorRun === false) ? latest : undefined);
        if (pending && !sameScope(pending, scope) && !acknowledgePriorRun) throw new ManualRunError("changed");
        marker = pending && !acknowledgePriorRun ? { ...pending, phase: "pending" } : {
          ...scope, routineId, key: randomUuid(), phase: "pending",
        };
        save(storage, marker, completed);
        completed.delete(routineId);
        uncertain.set(routineId, marker);
        return marker;
      });
      const body: unknown = await api(`/api/routines/${encodeURIComponent(routineId)}/run-protected`, {
        method: "POST", credentials: "same-origin", timeoutMs: 30_000,
        headers: { "Idempotency-Key": reserved.key, "X-Entropybot-Manual-Context": reserved.contextId },
      });
      const run = decodeManualRun(body, routineId);
      if (!run) throw new ManualRunError("unknown");
      await withManualRunLedger(() => {
        const persisted = load(storage).entries.find((m) => m.routineId === routineId);
        if (!sameMarker(reserved, persisted)) throw new ManualRunError("unknown");
        save(storage, { ...reserved, phase: "confirmed" }, completed);
        completed.set(routineId, { ...reserved, phase: "confirmed" });
        if (completed.size > 32) completed.delete(completed.keys().next().value!);
        uncertain.delete(routineId);
      });
      return { marker: reserved, run };
    } catch (error) {
      if (error instanceof ManualRunError) throw error;
      throw new ManualRunError(marker ? "unknown" : error instanceof ManualRunCoordinationError ? "coordination" : "blocked");
    }
  };
  return {
    run(routineId: string, settings: () => Promise<void>, acknowledgePriorRun?: boolean): Promise<RoutineRun> {
      let recovery: Marker | undefined;
      if (acknowledgePriorRun === false) {
        try {
          recovery = load(globalThis.localStorage).entries.find((m) => m.routineId === routineId);
          if (!recovery) throw new ManualRunError("blocked");
        } catch { return Promise.reject(new ManualRunError("blocked")); }
      }
      const pending = inFlight.get(routineId);
      const scope = authoritativeScope().catch(() => { throw new ManualRunError("blocked"); });
      if (pending) {
        return Promise.all([scope, pending.scope]).then(([current, captured]) => {
          if (!sameScope(captured, current)) throw new ManualRunError("changed");
          return pending.promise.then(({ marker, run }) => {
            if (recovery) {
              try {
                const latest = load(globalThis.localStorage).entries.find((m) => m.routineId === routineId);
                if (!sameMarker(recovery, marker) || !sameMarker(recovery, latest)) throw new ManualRunError("blocked");
              } catch { throw new ManualRunError("blocked"); }
            }
            return run;
          });
        });
      }
      const promise = scope.then((captured) => execute(routineId, captured, settings, acknowledgePriorRun, recovery));
      const entry = { scope, promise };
      inFlight.set(routineId, entry);
      void promise.finally(() => { if (inFlight.get(routineId) === entry) inFlight.delete(routineId); }).catch(() => {});
      return promise.then(({ run }) => run);
    },
  };
}
