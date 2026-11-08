import { createHash } from "node:crypto";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { manualRoutineContext, runManualRoutine } from "./routine-manual-request.ts";
import type { RequestAuth } from "./request-auth.ts";
import type { RoutineManager } from "./routines.ts";

const owner: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
const session = (id: string, email?: string): RequestAuth => ({ kind: "session", via: "cookie", scopes: ["client"], session: { id, email, label: "Synthetic", scopes: ["client"], createdAt: 1, lastSeenAt: 1, expiresAt: 9999999999999, tokenHash: "synthetic-credential-hash" } });
const context = (auth: RequestAuth, env = "workspace-one", started = false) => manualRoutineContext(auth, env, started);
function request(headers: Record<string, string | string[]>): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.headers = headers;
  req.rawHeaders = Object.entries(headers).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).flatMap(part => [key, part]));
  return req;
}

describe("manual routine context", () => {
  it("binds workspace, exact principal and effective authority", () => {
    const base = context(owner);
    expect(base).toEqual({ version: 1, contextId: expect.stringMatching(/^mr1_[a-f0-9]{64}$/) });
    expect(context({ ...owner, scopes: ["client", "admin"] })).toEqual(base);
    for (const other of [context(owner, "workspace-two"), context(owner, "workspace-one", true), context({ ...owner, scopes: ["client"] }), context({ ...owner, companionDevice: "device-one" }), context({ ...owner, companionDevice: "device-two" }), context(session("one")), context(session("two"))]) expect(other).not.toEqual(base);
    expect(context({ ...owner, companionDevice: "device-one" })).not.toEqual(context({ ...owner, companionDevice: "device-two" }));
    expect(context(session("one"))).not.toEqual(context(session("two")));
    expect(context(session("one", " Person@Fixture.test "))).toEqual(context(session("two", "person@fixture.test")));
    expect(context({ kind: "loopback", trust: "service", scopes: ["client"] })).toBeUndefined();
    expect(context({ ...owner, scopes: [] })).toBeUndefined();
  });

  it("ignores credential, transport and editable label fields", () => {
    const first = session("one", "person@fixture.test");
    if (first.kind !== "session") throw new Error("fixture");
    const changed: RequestAuth = { ...first, via: "bearer", session: { ...first.session, label: "Changed label", tokenHash: "another-synthetic-hash" } };
    expect(context(changed)).toEqual(context(first));
    const encoded = JSON.stringify(context(first));
    for (const secret of ["synthetic-credential-hash", "person@fixture.test", createHash("sha256").update("synthetic-credential-hash").digest("hex")]) expect(encoded).not.toContain(secret);
  });

  it("rejects changed workspace, companion or authority after read-only existence lookup and before mutation", () => {
    const manager = { runNow: vi.fn(), listRoutines: vi.fn(() => [{ id: "routine" }]) };
    const expected = context(owner)!.contextId;
    for (const [auth, env, started] of [[owner, "workspace-two", false], [{ ...owner, companionDevice: "device" }, "workspace-one", false], [owner, "workspace-one", true]] as const) {
      expect(() => runManualRoutine(request({ "idempotency-key": "intent", "x-entropybot-manual-context": expected }), auth, manager as unknown as RoutineManager, "routine", started, env)).toThrow(expect.objectContaining({ status: 409, code: "manual_context_mismatch" }));
    }
    expect(manager.runNow).not.toHaveBeenCalled(); expect(manager.listRoutines).toHaveBeenCalledTimes(3);
  });

  it("returns missing target before comparing a well-formed stale context", () => {
    const manager = { runNow: vi.fn(), listRoutines: vi.fn(() => []) };
    expect(runManualRoutine(request({ "idempotency-key": "intent", "x-entropybot-manual-context": context(owner, "old-workspace")!.contextId }), owner, manager as unknown as RoutineManager, "missing", false, "workspace-one")).toBeNull();
    expect(manager.runNow).not.toHaveBeenCalled();
  });

  it.each(["", "mr1_" + "A".repeat(64), "mr1_" + "a".repeat(63), "mr1_" + "a".repeat(65), "other_" + "a".repeat(64)])("rejects malformed context %j", value => {
    expect(() => runManualRoutine(request({ "idempotency-key": "intent", "x-entropybot-manual-context": value }), owner, {} as RoutineManager, "routine", false, "workspace-one")).toThrow(expect.objectContaining({ status: 400 }));
  });
});
