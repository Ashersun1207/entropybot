// How a chat-completions provider says no to a request, and what that means for the turn.
import { redactSecretsInText } from "../../shared/redact.ts";
import { rejectsKey } from "../key-rejections.ts";
import { ChatProtocolError, object } from "./openai-chat-protocol.ts";
import { classifyError, type ErrorClassification } from "./retry.ts";
import { ModelRouteRefused, routeRefusal, type ModelRoute } from "./openai-responses.ts";
import { refusesRequestSize, RequestTooLargeError } from "./chat-size-limit.ts";

export interface ProviderBody {
  error?: unknown;
  base_resp?: { status_code?: unknown; status_msg?: unknown };
}

/** MiniMax reports auth, balance and parameter failures as `base_resp` with HTTP 200. */
function providerError(json: ProviderBody): string | null {
  if (typeof json.error === "string") return json.error;
  const error = object(json.error);
  if (error) return typeof error.message === "string" ? error.message : "unknown error";
  const code = json.base_resp?.status_code;
  if (typeof code === "number" && code !== 0) {
    const msg = typeof json.base_resp?.status_msg === "string" ? json.base_resp.status_msg : "";
    return `upstream error ${code}${msg ? `: ${msg}` : ""}`;
  }
  return null;
}

const MACHINE_CODE = /^[a-z][a-z0-9_]*$/;

/** A failed response's own error message, then its machine code (trial-credit.ts parses it), else the raw body. */
export function httpErrorDetail(body: string, limit = 500, scrub: (text: string) => string = text => text): string {
  let json: ProviderBody | undefined;
  try { json = object(JSON.parse(body)); } catch { json = undefined; }
  const message = json ? providerError(json) : null;
  if (!message || message === "unknown error") return scrub(body).slice(0, limit);
  const code = object(json?.error)?.code;
  const suffix = typeof code === "string" && MACHINE_CODE.test(code) ? ` (${code})` : "";
  return scrub(message).slice(0, limit) + scrub(suffix);
}

/** Known credentials have no minimum length or shape; masking belongs to the request's owner, never global state. */
export function redactProviderDiagnostic(text: string, credentials: string | readonly string[]): string {
  const values = (typeof credentials === "string" ? [credentials] : credentials).filter(Boolean);
  const pattern = values.sort((a, b) => b.length - a.length).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const safe = pattern ? text.split(/(\[redacted\]|«redacted \d+ chars»)/).map((part, index) => index % 2
    ? part : part.replace(new RegExp(pattern, "g"), "[redacted]")).join("") : text;
  return redactSecretsInText(safe);
}

function redactProviderValue(value: unknown, credentials: string | readonly string[], seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactProviderDiagnostic(value, credentials);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  const safe = Array.isArray(value) ? value.map(part => redactProviderValue(part, credentials, seen))
    : Object.fromEntries(Object.entries(value).map(([key, part]) => [redactProviderDiagnostic(key, credentials), redactProviderValue(part, credentials, seen)]));
  seen.delete(value);
  return safe;
}

const SAFE_DIAGNOSTIC = Symbol("safe provider diagnostic");
type SafeError = Error & { [SAFE_DIAGNOSTIC]?: ErrorClassification };

/** Only sanitized diagnostics may carry this provenance; no raw body or credential is retained. */
export function trustProviderError<T extends Error>(error: T, classification = classifyError(error)): T {
  Object.defineProperty(error, SAFE_DIAGNOSTIC, { value: Object.freeze({ ...classification }), configurable: true });
  return error;
}

export function providerErrorClassification(error: Error): ErrorClassification {
  return (error as SafeError)[SAFE_DIAGNOSTIC] ?? classifyError(error);
}

export function providerErrorMessage(error: Error, credentials: readonly string[]): string {
  return (error as SafeError)[SAFE_DIAGNOSTIC] ? error.message : redactProviderDiagnostic(error.message, credentials);
}

export function redactProviderException(error: unknown, credentials: string | readonly string[]): unknown {
  if (error instanceof Error && !(error as SafeError)[SAFE_DIAGNOSTIC]) {
    const classification = classifyError(error);
    const message = redactProviderDiagnostic(error.message, credentials);
    if (message !== error.message) Object.defineProperty(error, "message", { value: message, configurable: true, writable: true });
    if (error.stack) error.stack = redactProviderDiagnostic(error.stack, credentials);
    trustProviderError(error, classification);
    if (error.cause !== undefined) Object.defineProperty(error, "cause", { value: redactProviderException(error.cause, credentials), configurable: true });
    return error;
  }
  return error instanceof Error ? error : redactProviderValue(error, credentials);
}

export function providerAuthError(body: string, status?: number): boolean {
  return status === 401 || status === 403 || rejectsKey(400, body)
    || /\b(?:authentication_error|permission_denied|insufficient_permissions)\b/.test(body);
}

export function classifyProviderBody(body: string, status?: number): ErrorClassification {
  return providerAuthError(body, status) ? { transient: false, reason: "auth" }
    : classifyError(new Error(`${status ? `HTTP ${status}: ` : ""}${httpErrorDetail(body)}`));
}

function safeErrorDetail(body: string, detail: string, credentials: string | readonly string[], status?: number): string {
  if (providerAuthError(body, status)) {
    return "Authentication required or permission denied. Check the provider credentials and access.";
  }
  return redactProviderDiagnostic(detail, credentials);
}

/** Authentication bodies are untrusted credential echoes; other errors keep their safe reason and machine code. */
export function safeHttpErrorDetail(body: string, status: number, credentials: string | readonly string[]): string {
  return safeErrorDetail(body, "", credentials, status)
    || httpErrorDetail(body, 500, text => redactProviderDiagnostic(text, credentials));
}

export function providerHttpFailure(status: number, body: string, input: {
  label: string; credentials: readonly string[]; route: ModelRoute; tools: boolean; bytes: number; reasoningReplay: boolean;
}): Error {
  const detail = safeHttpErrorDetail(body, status, input.credentials);
  const message = `${input.label} HTTP ${status}${detail ? `: ${detail}` : ""}`;
  const fail = <T extends Error>(error: T) => trustProviderError(error, classifyProviderBody(body, status));
  const refused = input.tools ? routeRefusal(input.route, status, body) : null;
  if (refused) return fail(new ModelRouteRefused(refused, message));
  if (providerAuthError(body, status)) return fail(new Error(message));
  if (refusesRequestSize(status, body)) return fail(new RequestTooLargeError(message, input.bytes));
  if (rejectsToolsParameter(status, body)) return fail(new UnsupportedChatToolsError(message));
  const refusal = refusedToolCall(status, body);
  if (refusal) return fail(new RejectedToolCallError(message, refusal, input.credentials));
  if (input.reasoningReplay && rejectsReasoningReplay(status, body)) return fail(new UnsupportedReasoningReplayError(message));
  return fail(new Error(message));
}

export class UnsupportedChatToolsError extends Error {}

export function rejectsToolsParameter(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  let envelope: Record<string, unknown> | undefined;
  try { envelope = object(JSON.parse(body)); } catch { return false; }
  const error = object(envelope?.error);
  if (error?.param === "tools" && error.code === "unsupported_parameter") return true;
  const message = error?.message ?? envelope?.error;
  return typeof message === "string" && (
    /\bdoes not support (?:tools|tool calling|function calling)(?:[.!]?$|[.!]?\s)/i.test(message) ||
    /\b(?:tools|tool calling|function calling) (?:is|are) not supported\b/i.test(message) ||
    /^(?:unsupported|unknown|unrecognized) (?:parameter|field):?\s*['"]?tools['"]?[.!]?$/i.test(message.trim())
  );
}

export class UnsupportedReasoningReplayError extends Error {}

/** DeepSeek-style providers need `reasoning_content` echoed on a tool-call message; Groq rejects it. */
export function rejectsReasoningReplay(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  let envelope: Record<string, unknown> | undefined;
  try { envelope = object(JSON.parse(body)); } catch { return false; }
  const message = object(envelope?.error)?.message ?? envelope?.error;
  return typeof message === "string" && /\breasoning_content\b/.test(message) &&
    /\b(?:unsupported|not supported|unknown|unrecognized|unexpected|not permitted|not allowed)\b/i.test(message);
}

/** Groq fails a completion with `tool_use_failed` when a generated tool call is invalid: usually a
 *  tool it was not offered (gpt-oss inventing a "json" tool), sometimes arguments missing the schema. */
export class RejectedToolCallError extends ChatProtocolError {
  readonly refusal: Readonly<Record<string, unknown> & { code: "tool_use_failed"; message: string }>;
  constructor(message: string, refusal: Record<string, unknown>, credentials: string | readonly string[]) {
    super(message);
    const body = JSON.stringify(refusal);
    const words = typeof refusal.message === "string" ? refusal.message : "unknown error";
    const metadata = providerAuthError(body) ? {} : object(redactProviderValue(refusal, credentials));
    this.refusal = Object.freeze({ ...metadata, code: "tool_use_failed", message: safeErrorDetail(body, words, credentials) });
  }
}

export const toolCallRefusal = (error: unknown) => {
  const body = object(error);
  return body?.code === "tool_use_failed" ? body : undefined;
};

export function refusedToolCall(status: number, body: string) {
  if (status !== 400) return undefined;
  try { return toolCallRefusal(object(JSON.parse(body))?.error); } catch { return undefined; }
}

export function refusedToolCallFailure(error: RejectedToolCallError, earlierSteps: boolean): ChatProtocolError {
  const words = error.refusal.message;
  const tool = /attempted to call tool '([^']+)'/.exec(words)?.[1];
  const what = tool ? `tried to use a tool it was not given ("${tool}")` : "made a tool call the provider rejected";
  const next = earlierSteps
    ? "The steps before it already ran, so ask only for what's left."
    : "Nothing ran. Retry; if it keeps happening, rephrase the request or choose another model.";
  return trustProviderError(new ChatProtocolError(`The model ${what}. ${next} Provider: ${words.slice(0, 200)}`), providerErrorClassification(error));
}

export function completionError(json: ProviderBody, label: string, credentials: string | readonly string[] = ""): ChatProtocolError | null {
  const message = providerError(json);
  if (!message) return null;
  const body = JSON.stringify(json);
  const detail = safeErrorDetail(body, message, credentials).slice(0, 200);
  const text = `provider returned a ${label}: ${detail}`;
  const refusal = providerAuthError(body) ? undefined : toolCallRefusal(json.error);
  return trustProviderError(refusal ? new RejectedToolCallError(text, refusal, credentials) : new ChatProtocolError(text), classifyProviderBody(body));
}
