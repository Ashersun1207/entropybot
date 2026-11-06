import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { requiredScope, resolveRequestAuth } from "./request-auth.ts";
import { SessionRegistry } from "./sessions.ts";

describe("embedding connection management authorization", () => {
  it("requires admin scope and the desktop capability on the exact new route", () => {
    const path = "/api/memory/embedding/test";
    expect(requiredScope("POST", path)).toBe("admin");
    const options = { sessions: new SessionRegistry({ file: join(DATA_DIR, "fixture-sessions.json") }), cookieName: "fixture_session", streamPath: "/api/events", url: new URL(path, "http://127.0.0.1:8799"), loopbackMutationToken: "fixture-owner" };
    const request = (headers: Record<string, string>) => ({ method: "POST", headers: { host: "127.0.0.1:8799", ...headers } }) as IncomingMessage;
    expect(resolveRequestAuth(request({}), options)).toMatchObject({ auth: null, status: 403 });
    expect(resolveRequestAuth(request({ "x-entropybot-desktop-owner": "fixture-wrong" }), options)).toMatchObject({ auth: null, status: 403 });
    expect(resolveRequestAuth(request({ "x-entropybot-desktop-owner": "fixture-owner" }), options).auth?.kind).toBe("loopback");
    expect(resolveRequestAuth(request({ "x-entropybot-desktop-owner": "fixture-owner", origin: "https://hostile.example" }), options)).toMatchObject({ auth: null, status: 403 });
  });
});
