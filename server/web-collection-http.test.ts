import { EventEmitter } from "node:events";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList } from "node:net";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCollectionHttpReader, type CollectionHttpDependencies, type CollectionHttpResponse } from "./web-collection-http.ts";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(() => { throw new Error("Real DNS forbidden"); }) }));
vi.mock("node:http", () => ({ request: vi.fn(() => { throw new Error("Real HTTP forbidden"); }) }));
vi.mock("node:https", () => ({ request: vi.fn(() => { throw new Error("Real HTTPS forbidden"); }) }));

const publicAddress = { address: "93.184.216.34", family: 4 };
const signal = () => new AbortController().signal;
function response(statusCode = 200, chunks: Uint8Array[] = [Buffer.from("<p>literal</p>")], headers = {}) {
  return Object.assign(Readable.from(chunks), { statusCode, headers });
}
function fixture(extra: CollectionHttpDependencies = {}) {
  const resolve = vi.fn(async () => [publicAddress]);
  const request = vi.fn(async () => response());
  const read = createCollectionHttpReader({ resolve, request, own: () => new BlockList(), ...extra });
  return { resolve, request, read };
}
afterEach(() => { vi.useRealTimers(); });

describe("guarded HTTP collection reader", () => {
  it.each(["http", "https"])("pins the default %s transport without a socket", async protocol => {
    const transport = protocol === "http" ? httpRequest : httpsRequest;
    const body = response();
    const end = vi.fn();
    vi.mocked(transport).mockImplementationOnce(((url: URL, options: RequestOptions, callback: (body: CollectionHttpResponse) => void) => {
      expect(url.hostname).toBe("public.test");
      expect(options.agent).toBe(false);
      expect(options.family).toBe(4);
      expect(options.headers).toEqual({ "accept-encoding": "identity" });
      const callbackLookup = vi.fn();
      (options.lookup as (host: string, options: object, callback: typeof callbackLookup) => void)("public.test", {}, callbackLookup);
      expect(callbackLookup).toHaveBeenCalledWith(null, publicAddress.address, 4);
      callback(body);
      return Object.assign(new EventEmitter(), { end });
    }) as unknown as typeof httpRequest);
    const read = createCollectionHttpReader({ resolve: async () => [publicAddress], own: () => new BlockList() });
    await expect(read({ url: `${protocol}://public.test` }, signal(), 100)).resolves.toBe("<p>literal</p>");
    expect(end).toHaveBeenCalledOnce();
  });
  it.each(["file:///etc/passwd", "ftp://example.test", "https://user:pass@example.test", "http://user@example.test"])("refuses URL %s before DNS or transport", async url => {
    const f = fixture();
    await expect(f.read({ url }, signal(), 100)).rejects.toThrow();
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled();
  });

  // These are reader admission checks; the shared egress suite owns the address range taxonomy.
  it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "169.254.1.1", "0.0.0.0", "[::1]", "[fc00::1]", "[fe80::1]"])("refuses literal %s without DNS or body access", async host => {
    const f = fixture();
    await expect(f.read({ url: `http://${host}/` }, signal(), 100)).rejects.toThrow("target refused");
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each(["127.0.0.1", "192.168.1.1", "169.254.169.254", "169.254.2.2", "198.18.0.1", "not-an-address"])("refuses a mixed DNS set containing %s", async address => {
    const f = fixture({ resolve: async () => [publicAddress, { address, family: 4 }] });
    await expect(f.read({ url: "https://public.test" }, signal(), 100)).rejects.toThrow("target refused");
    expect(f.request).not.toHaveBeenCalled();
  });

  it("refuses this computer's otherwise public address", async () => {
    const own = new BlockList();
    own.addAddress(publicAddress.address);
    const f = fixture({ own: () => own });
    await expect(f.read({ url: "https://public.test" }, signal(), 100)).rejects.toThrow("this-machine");
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each([["127.0.0.1", "rebinding"], ["10.0.0.1", "private"]])("re-resolves the same name and refuses later DNS answer %s without reading redirect bodies", async (address, refusal) => {
    const body = response(302, [], { location: "/next" });
    const iterator = vi.spyOn(body, Symbol.asyncIterator);
    const resolve = vi.fn().mockResolvedValueOnce([publicAddress]).mockResolvedValueOnce([{ address, family: 4 }]);
    const request = vi.fn(async () => body);
    const f = fixture({ resolve, request });
    await expect(f.read({ url: "https://public.test" }, signal(), 100)).rejects.toThrow(refusal);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
    expect(iterator).not.toHaveBeenCalled();
    expect((body as Readable).destroyed).toBe(true);
  });

  it("refuses a redirect to a private literal before another request", async () => {
    const request = vi.fn(async () => response(302, [], { location: "http://10.0.0.1/" }));
    const f = fixture({ request });
    await expect(f.read({ url: "http://public.test" }, signal(), 100)).rejects.toThrow("target refused");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["file:///x", "https://user:pass@other.test/"])("refuses redirect URL %s", async location => {
    const request = vi.fn(async () => response(302, [], { location }));
    const f = fixture({ request });
    await expect(f.read({ url: "https://public.test" }, signal(), 100)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("caps redirects and does not read their bodies", async () => {
    const request = vi.fn(async () => response(302, [], { location: "/again" }));
    const f = fixture({ request });
    await expect(f.read({ url: "https://public.test" }, signal(), 100)).rejects.toThrow("redirect limit");
    expect(request).toHaveBeenCalledTimes(6);
    expect(f.resolve).toHaveBeenCalledTimes(6);
  });

  it.each(["http", "https"])("returns inert text from a canonical %s URL and passes a pinned address", async protocol => {
    const f = fixture();
    await expect(f.read({ url: `${protocol}://PUBLIC.test:80/a#fragment` }, signal(), 100)).resolves.toBe("<p>literal</p>");
    const [url, address, scope] = f.request.mock.calls[0]! as unknown as [URL, typeof publicAddress, AbortSignal];
    expect(url.href).toBe(`${protocol}://public.test${protocol === "http" ? "" : ":80"}/a`);
    expect(address).toEqual(publicAddress);
    expect(scope.aborted).toBe(true);
  });

  it("accepts a public IP literal without resolving it", async () => {
    const f = fixture();
    await expect(f.read({ url: "https://93.184.216.34" }, signal(), 100)).resolves.toBe("<p>literal</p>");
    expect(f.resolve).not.toHaveBeenCalled();
  });

  it("hard caps streamed bytes even when content-length understates them", async () => {
    let pulls = 0;
    const destroy = vi.fn();
    const body = { statusCode: 200, headers: { "content-length": "1" }, destroy,
      async *[Symbol.asyncIterator]() {
        pulls++; yield Buffer.from("1234");
        pulls++; yield Buffer.from("56");
        pulls++; yield Buffer.from("must not read");
      },
    };
    const f = fixture({ request: async () => body });
    await expect(f.read({ url: "http://public.test" }, signal(), 5)).rejects.toThrow("byte limit");
    expect(pulls).toBe(2);
    expect(destroy).toHaveBeenCalled();
  });

  it("counts UTF-8 bytes and permits an exact boundary", async () => {
    const f = fixture({ request: async () => response(200, [Buffer.from("é"), Buffer.from("好")]) });
    await expect(f.read({ url: "http://public.test" }, signal(), 5)).resolves.toBe("é好");
    await expect(f.read({ url: "http://public.test" }, signal(), 4)).rejects.toThrow("byte limit");
  });

  it("refuses UTF-8 replacement expansion beyond the output limit", async () => {
    const f = fixture({ request: async () => response(200, [Buffer.from([255])]) });
    await expect(f.read({ url: "http://public.test" }, signal(), 1)).rejects.toThrow("decoded page byte limit");
  });

  it.each([201, 204, 404, 500])("refuses status %s without reading body", async status => {
    const body = response(status);
    const iterator = vi.spyOn(body, Symbol.asyncIterator);
    const f = fixture({ request: async () => body });
    await expect(f.read({ url: "http://public.test" }, signal(), 100)).rejects.toThrow("status 200");
    expect(iterator).not.toHaveBeenCalled();
  });

  it("refuses compressed responses without reading their body", async () => {
    const body = response(200, [], { "content-encoding": "gzip" });
    const iterator = vi.spyOn(body, Symbol.asyncIterator);
    const f = fixture({ request: async () => body });
    await expect(f.read({ url: "http://public.test" }, signal(), 100)).rejects.toThrow("encoded body");
    expect(iterator).not.toHaveBeenCalled();
  });

  it.each(["dns", "request", "body"])("bounds a stalled %s phase with the scope timeout", async phase => {
    vi.useFakeTimers();
    const pending = () => new Promise<never>(() => {});
    const body = { statusCode: 200, headers: {}, destroy: vi.fn(), [Symbol.asyncIterator]: () => ({ next: pending }) };
    const f = fixture({ timeoutMs: 10, ...(phase === "dns" ? { resolve: pending } : phase === "request" ? { request: pending } : { request: async () => body }) });
    const result = expect(f.read({ url: "http://public.test" }, signal(), 100)).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(10);
    await result;
    if (phase === "body") expect(body.destroy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors caller cancellation and destroys a late transport response", async () => {
    let finish!: (body: CollectionHttpResponse) => void;
    const request = vi.fn(() => new Promise<CollectionHttpResponse>(resolve => { finish = resolve; }));
    const f = fixture({ request });
    const controller = new AbortController();
    const result = expect(f.read({ url: "http://public.test" }, controller.signal, 100)).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    controller.abort(new Error("cancelled"));
    await result;
    const late = response();
    finish(late);
    await vi.waitFor(() => expect((late as Readable).destroyed).toBe(true));
  });

  it("propagates a transport/body failure instead of returning an empty page", async () => {
    const body = { statusCode: 200, headers: {}, destroy: vi.fn(), async *[Symbol.asyncIterator]() {
      yield Buffer.from("partial");
      throw new Error("connection lost");
    } };
    const f = fixture({ request: async () => body });
    await expect(f.read({ url: "http://public.test" }, signal(), 100)).rejects.toThrow("connection lost");
    expect(body.destroy).toHaveBeenCalled();
  });
});
