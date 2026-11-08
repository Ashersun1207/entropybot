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

export function runManualRoutine(req: IncomingMessage, auth: RequestAuth, manager: RoutineManager, id: string, ownerStarted: boolean): RoutineRun | null {
  const key = idempotencyKey(req);
  if (key === undefined) return manager.runNow(id);
  if (auth.kind === "loopback" && auth.trust === "service") {
    throw Object.assign(new Error("This caller cannot start a manual routine"), { status: 403 });
  }
  const routine = manager.listRoutines().find((candidate) => candidate.id === id);
  if (!routine) return null;
  const caller = auth.kind === "session" ? ["session", personKey(auth.session)] : ["owner", auth.companionDevice ?? "local"];
  const authority = hash({ scopes: [...auth.scopes].sort(), ownerStarted });
  return manager.runNow(id, undefined, {
    origin: "http", requestId: `http:${hash([caller, id, key])}`, routineId: id,
    fingerprintVersion: 1, fingerprint: manualRoutineFingerprint(routine, authority), authority,
  });
}
