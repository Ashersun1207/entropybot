import { rmSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { closeMessageDb, insertMessage, recallMessages } from "./message-db.ts";
import { buildRecall } from "./recall.ts";

beforeEach(() => { closeMessageDb(); rmSync(DATA_DIR, { recursive: true, force: true }); });
const query = "café résumé quarterly office budget";
const recall = (message: string) => buildRecall({ botId: "fixture-accent", message, threadIds: ["accent-owned"], label: () => "synthetic accent source", author: () => "Synthetic person", embedding: null });
const insert = (text: string) => insertMessage("accent-owned", { id: "accent-source", role: "user", kind: "text", at: 1793966400000, text });

it.each([
  { sourceForm: "NFC", queryForm: "NFC" },
  { sourceForm: "NFC", queryForm: "NFD" },
  { sourceForm: "NFD", queryForm: "NFC" },
  { sourceForm: "NFD", queryForm: "NFD" },
] as const)("preserves two real accented matches through helper and buildRecall: $sourceForm / $queryForm", async ({ sourceForm, queryForm }) => {
  insert("Café résumé appointment. R2_ACCENT_SOURCE".normalize(sourceForm));
  const request = query.normalize(queryForm);
  const hits = recallMessages(request, ["accent-owned"], 12, undefined, "any");
  expect(hits.map((hit) => hit.messageId)).toEqual(["accent-source"]);
  expect(recallMessages(request, ["accent-owned"], 12, undefined, "all")).toEqual([]);
  const result = await recall(request);
  expect(result?.conversations).toBe(1);
  expect(result?.text).toContain("R2_ACCENT_SOURCE");
});

it.each(["cafés résumés quarterly office budget", "café résum quarterly office budget"])("uses the same folding and prefix/stem rules as FTS for %s", async (request) => {
  insert("Café résumé appointment. R2_PREFIX_SOURCE");
  expect(recallMessages(request, ["accent-owned"], 12, undefined, "any")).toHaveLength(1);
  expect((await recall(request))?.text).toContain("R2_PREFIX_SOURCE");
});

it("leaves precomposed FTS token spelling to unicode61 instead of replacing it with an ASCII approximation", async () => {
  insert("ộtestword R2_UNICODE61_SPELLING");
  expect(recallMessages("ộtestword", ["accent-owned"], 12, undefined, "any")).toHaveLength(1);
  expect((await recall("ộtestword"))?.text).toContain("R2_UNICODE61_SPELLING");
});

it.each([query, query.normalize("NFD"), "café cafe quarterly office budget"])("rejects one actual match despite accent aliases and source brackets: %s", async (request) => {
  insert("Café appointment. [wrong] [unrelated] R2_ONE_MATCH");
  expect(recallMessages(request, ["accent-owned"], 12, undefined, "any")).toHaveLength(1);
  expect(await recall(request)).toBeNull();
});
