import type { CollectionOptions } from "./web-collection.ts";

export const readInlineCollectionPage: CollectionOptions["read"] = async (source, signal, pageBytes) => {
  signal.throwIfAborted();
  if (!Number.isSafeInteger(pageBytes) || pageBytes <= 0 || pageBytes > 1_000_000) throw new Error("Invalid finite reader byte limit");
  if (typeof source.html !== "string") throw new Error("Synthetic collection requires inline HTML");
  if (source.html.length > pageBytes || Buffer.byteLength(source.html) > pageBytes) throw new Error("Collection reader byte limit exceeded");
  signal.throwIfAborted();
  return source.html;
};
