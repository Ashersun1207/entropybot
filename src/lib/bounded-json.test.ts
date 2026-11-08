import { afterEach, describe, expect, it, vi } from "vitest";
import { BoundedJsonError, readBoundedJson } from "./bounded-json";

const encode = (text: string) => new TextEncoder().encode(text);
afterEach(() => vi.restoreAllMocks());

function chunks(values: Uint8Array[], headers?: HeadersInit) {
  const cancel = vi.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { if (index < values.length) controller.enqueue(values[index++]); else controller.close(); }, cancel,
  });
  const response = new Response(body, { headers });
  const json = vi.spyOn(response, "json"), text = vi.spyOn(response, "text");
  return { body, response, cancel, json, text };
}

describe("bounded JSON before parsing", () => {
  it.each([undefined, "exact", "compressed"] as const)("keeps complete UTF-8 and all rows with %s length metadata", async kind => {
    const value = { sources: [{ text: "中🙂é" }, { text: "second source" }] };
    const bytes = encode(JSON.stringify(value));
    const headers: HeadersInit | undefined = kind === "exact" ? { "content-length": String(bytes.length) }
      : kind === "compressed" ? { "content-length": "1", "content-encoding": "gzip" } : undefined;
    const f = chunks([new Uint8Array(), ...Array.from(bytes, byte => new Uint8Array([byte]))], headers);
    expect(await readBoundedJson(f.response, bytes.length)).toEqual(value);
    expect(f.json).not.toHaveBeenCalled(); expect(f.text).not.toHaveBeenCalled(); expect(f.body.locked).toBe(false);
  });
  it.each([undefined, "1", "16"])("stops an oversized chunked body (%s declared bytes) before parsing and cancels", async declared => {
    const f = chunks([encode('{"text":"'), encode('01234567890123456789'), encode('"}')], declared ? { "content-length": declared } : undefined);
    const parse = vi.spyOn(JSON, "parse");
    await expect(readBoundedJson(f.response, 16)).rejects.toBeInstanceOf(BoundedJsonError);
    expect(parse).not.toHaveBeenCalled(); expect(f.json).not.toHaveBeenCalled(); expect(f.text).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledOnce(); expect(f.body.locked).toBe(false);
  });
  it.each(["17", "9007199254740992", "NaN", "-1", "1.5", ""])("refuses invalid or oversized declared length %s without parsing", async declared => {
    const f = chunks([encode('{}')], { "content-length": declared }); const parse = vi.spyOn(JSON, "parse");
    await expect(readBoundedJson(f.response, 16)).rejects.toBeInstanceOf(BoundedJsonError);
    expect(parse).not.toHaveBeenCalled(); expect(f.cancel).toHaveBeenCalledOnce(); expect(f.body.locked).toBe(false);
  });
  it.each(["1", "9"])("rejects a misleading length %s even when the stream fits the budget", async declared => {
    const f = chunks([encode('{}')], { "content-length": declared }); const parse = vi.spyOn(JSON, "parse");
    await expect(readBoundedJson(f.response, 16)).rejects.toBeInstanceOf(BoundedJsonError);
    expect(parse).not.toHaveBeenCalled(); expect(f.body.locked).toBe(false);
  });
  it("does not decode or parse a single chunk that exceeds the limit", async () => {
    const f = chunks([encode('"0123456789"')]);
    const decode = vi.spyOn(TextDecoder.prototype, "decode"), parse = vi.spyOn(JSON, "parse");
    await expect(readBoundedJson(f.response, 8)).rejects.toBeInstanceOf(BoundedJsonError);
    expect(decode).not.toHaveBeenCalled(); expect(parse).not.toHaveBeenCalled(); expect(f.cancel).toHaveBeenCalledOnce();
  });
  it("grows the byte buffer without truncating the accepted response", async () => {
    const value = { text: 'x'.repeat(150_000) }; const bytes = encode(JSON.stringify(value));
    const f = chunks([bytes.subarray(0, 60_000), bytes.subarray(60_000, 100_000), bytes.subarray(100_000)]);
    expect(await readBoundedJson(f.response, bytes.length)).toEqual(value); expect(f.body.locked).toBe(false);
  });
  it.each([new Uint8Array([34, 0xe2, 0x82]), new Uint8Array([34, 0xc0, 0xaf, 34])])("refuses incomplete or invalid UTF-8 before parsing", async bytes => {
    const f = chunks([bytes.subarray(0, 2), bytes.subarray(2)]); const parse = vi.spyOn(JSON, "parse");
    await expect(readBoundedJson(f.response, 16)).rejects.toBeInstanceOf(BoundedJsonError);
    expect(parse).not.toHaveBeenCalled(); expect(f.body.locked).toBe(false);
  });
  it("returns only a fixed error for malformed bounded JSON", async () => {
    const f = chunks([encode('/private/secret')]);
    await expect(readBoundedJson(f.response, 16)).rejects.toMatchObject({ message: 'JSON response is invalid or exceeds its byte limit' });
    expect(f.body.locked).toBe(false);
  });
  it("refuses a missing body", async () => {
    const parse = vi.spyOn(JSON, 'parse');
    await expect(readBoundedJson(new Response(null), 16)).rejects.toBeInstanceOf(BoundedJsonError); expect(parse).not.toHaveBeenCalled();
  });
  it("cancels a response whose caller already aborted", async () => {
    const f = chunks([encode('{}')]); const controller = new AbortController(); controller.abort();
    const parse = vi.spyOn(JSON, 'parse');
    await expect(readBoundedJson(f.response, 16, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(parse).not.toHaveBeenCalled(); expect(f.cancel).toHaveBeenCalledOnce(); expect(f.body.locked).toBe(false);
  });
  it("aborts an in-flight read and releases the reader even if producer cancellation never settles", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    let started=false;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { if (!started) { started=true; controller.enqueue(encode('{"x":"')); return; } return new Promise<void>(() => {}); }, cancel });
    const controller = new AbortController(); const parse = vi.spyOn(JSON, 'parse');
    const result = readBoundedJson(new Response(body), 16, controller.signal);
    await Promise.resolve(); await Promise.resolve(); controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce(); expect(parse).not.toHaveBeenCalled(); expect(body.locked).toBe(false);
  });
  it("releases an errored stream without parsing or exposing a partial result", async () => {
    const failure = new Error('synthetic transport failed');
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(failure); } });
    const parse = vi.spyOn(JSON, 'parse');
    await expect(readBoundedJson(new Response(body), 16)).rejects.toBe(failure);
    expect(parse).not.toHaveBeenCalled(); expect(body.locked).toBe(false);
  });
});
