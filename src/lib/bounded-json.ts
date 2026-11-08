export class BoundedJsonError extends Error {
  constructor() { super("JSON response is invalid or exceeds its byte limit"); this.name = "BoundedJsonError"; }
}

/** Bounds decoded response bytes before UTF-8 decoding or JSON parsing; Content-Length never grants extra capacity. */
export async function readBoundedJson(response: Response, maxBytes: number, signal?: AbortSignal | null): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new BoundedJsonError();
  let completed = false, cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    void reader.cancel(signal?.reason).catch(() => {});
  };
  const abort = () => cancel();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new BoundedJsonError();
    const declared = response.headers.get("content-length");
    let expected: number | null = null;
    if (declared !== null) {
      if (!/^\d+$/.test(declared)) throw new BoundedJsonError();
      expected = Number(declared);
      if (!Number.isSafeInteger(expected) || expected > maxBytes) throw new BoundedJsonError();
    }
    let bytes = new Uint8Array(Math.min(maxBytes, 65_536));
    let length = 0;
    for (;;) {
      const next = await reader.read();
      signal?.throwIfAborted();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || next.value.byteLength > maxBytes - length) throw new BoundedJsonError();
      const needed = length + next.value.byteLength;
      if (needed > bytes.byteLength) {
        const grown = new Uint8Array(Math.min(maxBytes, Math.max(needed, bytes.byteLength * 2)));
        grown.set(bytes.subarray(0, length));
        bytes = grown;
      }
      bytes.set(next.value, length);
      length = needed;
    }
    const encoding = response.headers.get("content-encoding");
    if (expected !== null && (!encoding || encoding === "identity") && expected !== length) throw new BoundedJsonError();
    signal?.throwIfAborted();
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))); }
    catch { throw new BoundedJsonError(); }
    completed = true;
    return value;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!completed) cancel();
    reader.releaseLock();
  }
}
