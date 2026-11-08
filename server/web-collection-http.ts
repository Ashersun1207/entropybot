import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type BlockList } from "node:net";

import { addressClass, namesThisMachine, ownAddresses } from "./browser/egress/policy.ts";
import { collectionUrl, type CollectionOptions } from "./web-collection.ts";

interface Address { address: string; family: number }
export interface CollectionHttpResponse extends AsyncIterable<Uint8Array> {
  statusCode?: number;
  headers: { location?: string; "content-encoding"?: string; "content-length"?: string };
  destroy(): unknown;
}

export interface CollectionHttpDependencies {
  resolve?: (host: string, signal: AbortSignal) => Promise<readonly Address[]>;
  /** Must connect only to the supplied address, preserve URL Host/TLS identity, and never follow redirects. */
  request?: (url: URL, address: Address, signal: AbortSignal) => Promise<CollectionHttpResponse>;
  own?: () => BlockList;
  timeoutMs?: number;
  redirects?: number;
}

function requestPage(url: URL, address: Address, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET", signal, agent: false, family: address.family, maxHeaderSize: 16_384,
      headers: { "accept-encoding": "identity" },
      // Keep the original authority for Host and certificate validation; DNS cannot change after validation.
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
    }, resolve);
    request.on("error", reject);
    request.end();
  });
}

/** A bounded HTTP/S reader. Refusals and transport failures propagate to collectWeb's unknown-outcome receipt. */
export function createCollectionHttpReader(dependencies: CollectionHttpDependencies = {}): CollectionOptions["read"] {
  const resolve = dependencies.resolve ?? (host => lookup(host, { all: true, verbatim: true }));
  const request = dependencies.request ?? requestPage;
  const timeoutMs = dependencies.timeoutMs ?? 15_000;
  const redirects = dependencies.redirects ?? 5;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000
    || !Number.isSafeInteger(redirects) || redirects < 0 || redirects > 5) throw new Error("Invalid HTTP reader limits");
  return async (source, signal, pageBytes) => {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(pageBytes) || pageBytes < 1 || pageBytes > 1_000_000) throw new Error("Invalid page byte limit");
    let url = new URL(collectionUrl(source.url));
    const scope = new AbortController();
    const boundedSignal = AbortSignal.any([signal, scope.signal]);
    const timer = setTimeout(() => scope.abort(new Error("HTTP collection timeout")), timeoutMs);
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(boundedSignal.reason);
      boundedSignal.addEventListener("abort", onAbort, { once: true });
      if (boundedSignal.aborted) onAbort();
    });
    const work = async () => {
      for (let hop = 0; ; hop++) {
        boundedSignal.throwIfAborted();
        const host = url.hostname.replace(/^\[|\]$/g, "");
        const answers = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host, boundedSignal);
        boundedSignal.throwIfAborted();
        if (!answers.length) throw new Error("HTTP collection DNS returned no addresses");
        const own = (dependencies.own ?? ownAddresses)();
        for (const answer of answers) {
          const kind = addressClass(answer.address, own);
          if (kind !== "public") {
            const refusal = kind === "loopback" && !namesThisMachine(host) ? "rebinding" : kind;
            throw new Error(`HTTP collection target refused: ${refusal}`);
          }
          if (isIP(answer.address) !== answer.family) throw new Error("HTTP collection invalid DNS family");
        }
        boundedSignal.throwIfAborted();
        const response = await request(url, answers[0]!, boundedSignal);
        const cancel = () => { response.destroy(); };
        boundedSignal.addEventListener("abort", cancel, { once: true });
        try {
          boundedSignal.throwIfAborted();
          if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
            if (hop >= redirects) throw new Error("HTTP collection redirect limit exceeded");
            if (!response.headers.location) throw new Error("HTTP collection redirect location missing");
            url = new URL(collectionUrl(new URL(response.headers.location, url).href));
            continue;
          }
          if (response.statusCode !== 200) throw new Error("HTTP collection requires status 200");
          if (response.headers["content-encoding"] && response.headers["content-encoding"].toLowerCase() !== "identity") {
            throw new Error("HTTP collection encoded body refused");
          }
          const length = response.headers["content-length"];
          if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > pageBytes)) throw new Error("HTTP collection page byte limit exceeded");
          const buffer = Buffer.allocUnsafe(pageBytes);
          let bytes = 0;
          for await (const chunk of response) {
            boundedSignal.throwIfAborted();
            if (!(chunk instanceof Uint8Array) || chunk.byteLength > pageBytes - bytes) throw new Error("HTTP collection page byte limit exceeded");
            buffer.set(chunk, bytes);
            bytes += chunk.byteLength;
          }
          boundedSignal.throwIfAborted();
          const text = buffer.toString("utf8", 0, bytes);
          if (Buffer.byteLength(text) > pageBytes) throw new Error("HTTP collection decoded page byte limit exceeded");
          return text;
        } finally {
          boundedSignal.removeEventListener("abort", cancel);
          response.destroy();
        }
      }
    };
    try { return await Promise.race([work(), aborted]); }
    finally {
      clearTimeout(timer);
      if (onAbort) boundedSignal.removeEventListener("abort", onAbort);
      scope.abort(new Error("HTTP collection scope closed"));
    }
  };
}
