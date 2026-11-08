import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { personKey } from "./person-key.ts";
import type { RequestAuth } from "./request-auth.ts";
import type { Routine, RoutineManager, RoutineRun } from "./routines.ts";

const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

export function manualRoutineFingerprint(routine: Routine, authority: string): string {
  const keys = ["id", "createdAt", "name", "prompt", "target", "botId", "groupId", "runOn", "enabled", "schedule",
    "durationMinutes", "timeoutMinutes", "attachments", "continuity", "overlap", "runOnStartup", "checks", "access", "deliver",
    "sourceThreadId", "resultsThreadId"] as const;
  return hash({ version: 1, authority, definition: Object.fromEntries(keys.map((key) => [key, routine[key]])) });
}

function idempotencyKey(req: IncomingMessage): string | undefined {
  const count = req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === "idempotency-key").length;
  const key = req.headers["idempotency-key"];
  if (count === 0 && key === undefined) return undefined;
  if (count !== 1 || typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)) {
    throw Object.assign(new Error("Idempotency-Key must be one ASCII token of 1–128 letters, digits, dots, underscores, colons or hyphens, starting with a letter or digit"), { status: 400 });
  }
  return key;
}

function manualAuthority(auth: RequestAuth, ownerStarted: boolean) {
  return {
    caller: auth.kind === "session" ? ["session", personKey(auth.session)] : ["owner", auth.companionDevice ?? "local"],
    authority: hash({ scopes: [...auth.scopes].sort(), ownerStarted }),
  };
}

export function manualRoutineContext(auth: RequestAuth, environmentId: string, ownerStarted: boolean): { version: 1; contextId: string } | undefined {
  if ((auth.kind === "loopback" && auth.trust === "service") || !auth.scopes.includes("client")) return undefined;
  return { version: 1, contextId: `mr1_${hash({ version: 1, environmentId, ...manualAuthority(auth, ownerStarted) })}` };
}

function expectedContext(req: IncomingMessage, key: string | undefined): string | undefined {
  const count = req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === "x-entropybot-manual-context").length;
  const context = req.headers["x-entropybot-manual-context"];
  if (count === 0 && context === undefined) return undefined;
  if (key === undefined || count !== 1 || typeof context !== "string" || !/^mr1_[a-f0-9]{64}$/.test(context)) {
    throw Object.assign(new Error("Manual context requires one valid context header and Idempotency-Key"), { status: 400, code: "manual_context_invalid" });
  }
  return context;
}

export function runManualRoutine(req: IncomingMessage, auth: RequestAuth, manager: RoutineManager, id: string, ownerStarted: boolean, environmentId?: string, protectedRequest = false): RoutineRun | null {
  const key = idempotencyKey(req);
  const expected = expectedContext(req, key);
  if (protectedRequest && (key === undefined || expected === undefined)) {
    throw Object.assign(new Error("Protected manual requests require Idempotency-Key and manual context"), { status: 400, code: "manual_context_invalid" });
  }
  if (key !== undefined && auth.kind === "loopback" && auth.trust === "service") {
    throw Object.assign(new Error("This caller cannot start a manual routine"), { status: 403 });
  }
  if (key === undefined) return manager.runNow(id);
  const routine = manager.listRoutines().find((candidate) => candidate.id === id);
  if (!routine) return null;
  if (expected !== undefined && (!environmentId || manualRoutineContext(auth, environmentId, ownerStarted)?.contextId !== expected)) {
    throw Object.assign(new Error("Manual request context changed; reconcile the original intent before trying again"), { status: 409, code: "manual_context_mismatch" });
  }
  const { caller, authority } = manualAuthority(auth, ownerStarted);
  return manager.runNow(id, undefined, {
    origin: "http", requestId: `http:${hash([caller, id, key])}`, routineId: id,
    fingerprintVersion: 1, fingerprint: manualRoutineFingerprint(routine, authority), authority,
  });
}
