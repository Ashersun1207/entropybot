import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import type { ProviderInstance } from "../contracts.ts";
import { recordEvents } from "../testing/events.ts";
import { redactSecretsInText } from "../../shared/redact.ts";
import { OpenAICompatDriver } from "./openai-compat.ts";
import { redactProviderDiagnostic, providerErrorClassification, redactProviderException } from "./openai-chat-refusals.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function fixture(status: number, body: string, key: string, contentType = "application/json", tools = false) {
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") { res.setHeader("content-type", "application/json"); res.end('{"data":[]}'); return; }
    for await (const _part of req) { /* drain the synthetic request */ }
    requests.push(req.headers.authorization ?? "");
    res.writeHead(status, { "content-type": contentType }); res.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture not bound");
  const instance = await OpenAICompatDriver.create({
    instanceId: `fixture-${address.port}`, displayName: "Fixture", enabled: true,
    config: OpenAICompatDriver.decodeConfig({ url: `http://127.0.0.1:${address.port}/v1`, apiKeyEnv: "SYNTHETIC_KEY", model: "fixture-model", tools }),
    environment: { SYNTHETIC_KEY: key },
  });
  cleanups.push(() => instance.dispose());
  return { instance, requests };
}

async function turn(instance: ProviderInstance) {
  const recorder = recordEvents(instance.adapter);
  try {
    await instance.adapter.sendTurn({ threadId: "synthetic", text: "hi" });
    await vi.waitFor(() => expect(recorder.events.some(event => event.type === "turn.completed")).toBe(true));
    expect(recorder.events).toContainEqual(expect.objectContaining({ type: "turn.completed", ok: false }));
    return recorder.events.find(event => event.type === "runtime.error");
  } finally { recorder.stop(); }
}

it.each([
  [401, JSON.stringify({ error: { message: "invalid api key sk-LEAK" } })],
  [403, "permission denied sk-LEAK"],
  [401, '{"error": broken sk-LEAK'],
  [401, ""],
])("replaces HTTP %s authentication bodies before helper errors and runtime events", async (status, body) => {
  const { instance, requests } = await fixture(status, body, "fixture-only");
  await expect(instance.generateText!("hi")).rejects.toThrow(`upstream HTTP ${status}: Authentication required or permission denied. Check the provider credentials and access.`);
  expect(await turn(instance)).toMatchObject({ message: `upstream HTTP ${status}: Authentication required or permission denied. Check the provider credentials and access.` });
  expect(requests).toEqual(["Bearer fixture-only", "Bearer fixture-only"]);
});

it.each(["q7!", "x", "sk-test-abcdefghijklmnopqrstuvwxyz"])("masks the known credential %s before truncation in ordinary errors", async key => {
  const body = JSON.stringify({ error: { message: `Retry later ${key}; ${"a".repeat(520)} ${key}`, code: "rate_limit_exceeded" } });
  const { instance } = await fixture(429, body, key);
  await expect(instance.generateText!("hi")).rejects.toThrow(/upstream HTTP 429: Retry later \[redacted\]/);
  try { await instance.generateText!("hi"); } catch (error) { expect(String(error)).not.toContain(key); }
  const event = await turn(instance);
  expect(JSON.stringify(event)).not.toContain(key);
  expect(event).toMatchObject({ message: expect.stringContaining("rate_limit_exceeded".split(key).join("[redacted]")) });
});

it.each(["application/json", "text/event-stream"])("sanitizes HTTP 200 %s completion authentication errors", async type => {
  const json = JSON.stringify({ error: { code: "invalid_api_key", message: "invalid api key sk-LEAK and q7!" } });
  const { instance } = await fixture(200, type === "application/json" ? json : `data: ${json}\n\n`, "q7!", type);
  if (type === "application/json") await expect(instance.generateText!("hi")).rejects.toThrow(/Authentication required or permission denied/);
  expect(await turn(instance)).toMatchObject({ message: expect.stringContaining("Authentication required or permission denied") });
  expect(JSON.stringify(await turn(instance))).not.toContain("sk-LEAK");
});

it("does not expose a partial long credential through the JSON parser's source preview", async () => {
  const key = "sk-test-abcdefghijklmnopqrstuvwxyz";
  const { instance } = await fixture(200, key, key);
  await expect(instance.generateText!("hi")).rejects.toThrow("provider returned invalid completion JSON");
  expect(await turn(instance)).toMatchObject({ message: "provider returned invalid completion JSON" });
});

it("keeps independent concurrent credentials local to their owner and registers no held scrubber", async () => {
  const a = await fixture(500, 'upstream q7! and r8? retry later', "q7!", "text/plain");
  const b = await fixture(500, 'upstream q7! and r8? retry later', "r8?", "text/plain");
  const errors = await Promise.allSettled([a.instance.generateText!("hi"), b.instance.generateText!("hi")]);
  expect(errors).toMatchObject([
    { status: "rejected", reason: { message: "upstream HTTP 500: upstream [redacted] and r8? retry later" } },
    { status: "rejected", reason: { message: "upstream HTTP 500: upstream q7! and [redacted] retry later" } },
  ]);
  const events = await Promise.all([turn(a.instance), turn(b.instance)]);
  expect(events).toMatchObject([
    { message: "upstream HTTP 500: upstream [redacted] and r8? retry later" },
    { message: "upstream HTTP 500: upstream q7! and [redacted] retry later" },
  ]);
  expect(redactSecretsInText("q7! r8? sk-LEAK and normal code/prose")).toBe("q7! r8? sk-LEAK and normal code/prose");
  await a.instance.dispose(); await b.instance.dispose();
  expect(redactSecretsInText("q7! r8?")).toBe("q7! r8?");
});

it.each([
  [500, "temporary failure q7!; retry later", "text/plain"],
  [500, '{"error": malformed q7!; retry later', "application/json"],
  [200, 'data: {"error":{"message":"temporary failure q7!; retry later"}}\n\n', "text/event-stream"],
])("masks known values in status %s body %s", async (status, body, type) => {
  const { instance } = await fixture(status, body, "q7!", type);
  if (status !== 200) await expect(instance.generateText!("hi")).rejects.toThrow(/\[redacted\]; retry later/);
  const error = await turn(instance);
  expect(JSON.stringify(error)).not.toContain("q7!");
  expect(error).toMatchObject({ message: expect.stringContaining("[redacted]; retry later") });
});

it("preserves credits and rate-limit diagnostics", async () => {
  for (const [status, message, code] of [[402, "Insufficient credits", "trial_credit_used_up"], [429, "Rate limit reached; retry in 10 seconds", "rate_limit_exceeded"]] as const) {
    const { instance } = await fixture(status, JSON.stringify({ error: { message, code } }), "q7!");
    await expect(instance.generateText!("hi")).rejects.toThrow(`upstream HTTP ${status}: ${message} (${code})`);
  }
});

it.each(["http", "json", "sse"])("keeps auth refusal payloads safe through %s fallback", async transport => {
  const json = JSON.stringify({ error: { code: "tool_use_failed", type: "authentication_error", message: "invalid api key sk-LEAK and q7!" } });
  const { instance, requests } = await fixture(transport === "http" ? 400 : 200, transport === "sse" ? `data: ${json}\n\n` : json, "q7!", transport === "sse" ? "text/event-stream" : "application/json");
  const event = await turn(instance);
  expect(requests).toHaveLength(1);
  expect(event).toMatchObject({ message: expect.stringContaining("Authentication required or permission denied") });
  expect(JSON.stringify(event)).not.toContain("sk-LEAK");
  expect(JSON.stringify(event)).not.toContain("q7!");
});

it.each(["http", "json", "sse"])("scrubs a full known refusal credential before %s fallback truncation", async transport => {
  const key = "fixtureCredentialABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const json = JSON.stringify({ error: { code: "tool_use_failed", message: "a".repeat(195) + key } });
  const { instance, requests } = await fixture(transport === "http" ? 400 : 200, transport === "sse" ? `data: ${json}\n\n` : json, key, transport === "sse" ? "text/event-stream" : "application/json");
  const event = await turn(instance);
  expect(event).toMatchObject({ message: expect.stringContaining("Provider:") });
  expect(JSON.stringify(event)).not.toContain("fixtu");
  expect(requests).toHaveLength(3);
});

it.each(["q7!", "a"])("never downgrades optional tools after auth failure with configured key %s", async key => {
  const { instance, requests } = await fixture(400, JSON.stringify({ error: { message: "Invalid API key; tools are not supported." } }), key, "application/json", true);
  const event = await turn(instance);
  expect(requests).toHaveLength(1);
  expect(event).toMatchObject({ message: "upstream HTTP 400: Authentication required or permission denied. Check the provider credentials and access." });
});

it("keeps masks stable and preserves generated metadata when the key occurs in the template", async () => {
  const { instance } = await fixture(429, JSON.stringify({ error: { message: "retry a later", code: "rate_limit" } }), "a");
  const expected = "upstream HTTP 429: retry [redacted] l[redacted]ter (r[redacted]te_limit)";
  await expect(instance.generateText!("hi")).rejects.toThrow(expected);
  expect(await turn(instance)).toMatchObject({ message: expected });
});

it("sanitizes refusal metadata and tool-name extraction before retaining or shortening it", async () => {
  const key = "fixtureCredentialABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const refusal = { code: "tool_use_failed", type: "invalid_request_error", message: `attempted to call tool '${key}' which was not in request`, failed_generation: JSON.stringify({ name: key }), nested: { [key]: [key] } };
  const { instance, requests } = await fixture(400, JSON.stringify({ error: refusal }), key);
  try {
    await instance.generateText!("hi");
    expect.fail("expected refusal");
  } catch (error) {
    expect(error).toHaveProperty("refusal", { code: "tool_use_failed", type: "invalid_request_error", message: "attempted to call tool '[redacted]' which was not in request", failed_generation: '{"name":"[redacted]"}', nested: { "[redacted]": ["[redacted]"] } });
    expect(JSON.stringify(error)).not.toContain("fixtureCredential");
    expect(providerErrorClassification(error as Error)).toEqual({ transient: false, reason: "invalid_request" });
  }
  expect(await turn(instance)).toMatchObject({ message: expect.stringContaining('not given ("[redacted]")') });
  expect(requests).toHaveLength(4);
});

it("masks a credential crossing the HTTP limit and the entire machine-code suffix", async () => {
  const key = "fixture_credential_abcdefghijklmnopqrstuvwxyz";
  const { instance } = await fixture(500, JSON.stringify({ error: { message: "z".repeat(495) + key, code: key } }), key);
  const expected = `upstream HTTP 500: ${"z".repeat(495)}[reda ([redacted])`;
  await expect(instance.generateText!("hi")).rejects.toThrow(expected);
  expect(await turn(instance)).toMatchObject({ message: expected });
});

it.each(["a", "red", "a+b", "429"])("preserves status and a stable mask across repeated passes for %s", async key => {
  const unknownLongKey = "sk-zzzzzzzzzzzzzzzzzzzzzzzz";
  const once = redactProviderDiagnostic(`${key} ${unknownLongKey}`, key);
  expect(once).toBe(`[redacted] «redacted ${unknownLongKey.length} chars»`);
  expect(redactProviderDiagnostic(once, key)).toBe(once);
  const { instance } = await fixture(429, JSON.stringify({ error: { message: `retry ${key} later` } }), key);
  const expected = `upstream HTTP 429: ${redactProviderDiagnostic(`retry ${key} later`, key)}`;
  await expect(instance.generateText!("hi")).rejects.toThrow(expected);
  expect(await turn(instance)).toMatchObject({ message: expected });
});

it("sanitizes nested exception causes while retaining classification and ownership", () => {
  const cause = new Error("socket q7! failed", { cause: { code: "ECONNRESET", nested: { "q7!": "q7!" } } });
  const error = new Error("fetch failed q7!", { cause });
  const safe = redactProviderException(error, "q7!");
  expect(safe).toBe(error);
  expect(error.message).toBe("fetch failed [redacted]");
  expect(error.cause).toBe(cause);
  expect(cause.message).toBe("socket [redacted] failed");
  expect(cause.cause).toEqual({ code: "ECONNRESET", nested: { "[redacted]": "[redacted]" } });
  expect(providerErrorClassification(error)).toEqual({ transient: true, reason: "connection_reset" });
  expect(redactProviderException(error, "q7!")).toBe(error);
});

it("rejects empty credentials locally without contacting the provider", async () => {
  const { instance, requests } = await fixture(401, "sk-LEAK", "");
  await expect(instance.generateText!("hi")).rejects.toThrow(/no API key/);
  await expect(instance.adapter.sendTurn({ threadId: "empty", text: "hi" })).rejects.toThrow(/no API key/);
  expect(requests).toEqual([]);
});
