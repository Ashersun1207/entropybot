import { rmSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { appendMessage, closeMessageDb, deleteThread, deleteThreads, importThread, insertMessage, recallMessages, searchMessages, updateMessage } from "./message-db.ts";
import { buildRecall, RECALL_CLOSE, RECALL_MAX_CHARS, recallQuery } from "./recall.ts";
import { withPeerProvenance } from "./peer-provenance.ts";
import type { Message } from "./store.ts";
import { chineseRecallQuery } from "./message-recall-chinese.ts";

beforeEach(() => { closeMessageDb(); rmSync(DATA_DIR, { recursive: true, force: true }); });
const message = (id: string, text: string, extra: Partial<Message> = {}): Message => ({ id, text, role: "user", kind: "text", at: 100, ...extra });
const input = (message: string, threadIds = ["own"]) => ({ botId: "fixture-owner", message, threadIds, label: (id: string) => `chat ${id}`, author: (hit: { peer?: string; from?: string }) => hit.peer ?? hit.from ?? "Synthetic person", embedding: null });

it("recalls a Chinese substring through the database and buildRecall, independently of ordinary LIKE search", async () => {
  insertMessage("fixture-own", { id: "old-fact", role: "bot", kind: "text", at: 1793966400000, text: "合成记录：我们决定通过远程桌面管理自己的服务器。R2_UNIQUE_FACT" });
  const search = searchMessages("远程桌面");
  const hits = recallMessages("远程桌面", ["fixture-own"], 12, undefined, "any");
  const recall = await buildRecall({ botId: "fixture-owner", message: "上次远程桌面方案是什么", threadIds: ["fixture-own"], label: () => "synthetic source chat", author: () => "Synthetic bot", embedding: null });
  console.info(JSON.stringify({ searchIds: search.map((hit) => hit.messageId), helperIds: hits.map((hit) => hit.messageId), recall }));
  expect(search.map((hit) => hit.messageId)).toEqual(["old-fact"]);
  expect(hits.map((hit) => hit.messageId)).toEqual(["old-fact"]);
  expect(recall?.text).toContain("R2_UNIQUE_FACT");
});

it("admits a meaningful four-character Chinese query at the actual buildRecall gate", async () => {
  insertMessage("fixture-own", { id: "old-fact", role: "bot", kind: "text", at: 1793966400000, text: "通过远程桌面管理自己的服务器。R2_SHORT_FACT" });
  expect(recallQuery("远程桌面")).toBe("远程桌面");
  const recall = await buildRecall({ botId: "fixture-owner", message: "远程桌面", threadIds: ["fixture-own"], label: () => "synthetic source chat", author: () => "Synthetic bot", embedding: null });
  expect(recall?.text).toContain("R2_SHORT_FACT");
});

it("filters authorized threads and inclusive time windows before ranking and limits", () => {
  insertMessage("own", message("same-id", "我们通过远程桌面管理服务器。AUTHORIZED_OLD", { at: 100 }));
  insertMessage("own-two", message("same-id", "通过远程桌面管理服务器。AUTHORIZED_HIGH", { at: 200 }));
  for (let i = 0; i < 48; i++) {
    insertMessage("private", message(`secret-${i}`, "远程桌面远程桌面远程桌面 PRIVATE", { at: 150 }));
    insertMessage("own", message(`outside-${i}`, "远程桌面远程桌面 OUTSIDE", { at: 201 + i }));
  }
  for (const mode of ["all", "any"] as const) {
    const hits = recallMessages("远程桌面", ["own", "own-two"], 2, { since: 100, until: 200 }, mode);
    expect(hits.map((hit) => hit.threadId).sort()).toEqual(["own", "own-two"]);
    expect(recallMessages("远程桌面", ["own", "own-two"], 1, { since: 200, until: 200 }, mode)[0]?.threadId).toBe("own-two");
    expect(recallMessages("远程桌面", ["own"], 1, { since: 100, until: 100 }, mode)[0]?.snippet).toContain("AUTHORIZED_OLD");
    expect(recallMessages("远程桌面", ["own"], 1, { since: 200, until: 100 }, mode)).toEqual([]);
  }
  expect(recallMessages("远程桌面", [])).toEqual([]);
  expect(recallMessages("远程桌面", ["private"], 1)[0]?.threadId).toBe("private");
  expect(recallMessages("远程桌面", ["own-two"], 1)[0]?.threadId).toBe("own-two");
});

it("preserves all versus any, mixed queries and English matching", async () => {
  insertMessage("own", message("remote", "我们通过远程桌面管理服务器。"));
  insertMessage("own", message("both", "我们通过远程桌面进行金额核对。"));
  insertMessage("own", message("mixed", "使用 Magpie 网关接入 DeepSeek，并保留 API 配置。R2_MIXED"));
  insertMessage("own", message("english", "The audit found broken links on the pricing page."));
  expect(recallMessages("远程桌面 金额核对", ["own"]).map((hit) => hit.messageId)).toEqual(["both"]);
  expect(recallMessages("远程桌面 金额核对", ["own"], 12, undefined, "any").map((hit) => hit.messageId)).toContain("remote");
  expect(recallMessages("the 远程桌面", ["own"]).map((hit) => hit.messageId)).toContain("remote");
  for (const query of ["Magpie 网关", "Magpie网关", "deepseek API 配置"]) {
    expect(recallMessages(query, ["own"]).map((hit) => hit.messageId)).toEqual(["mixed"]);
    expect((await buildRecall(input(query)))?.text).toContain("R2_MIXED");
  }
  expect(recallMessages("audit broken links", ["own"])[0]?.snippet).toContain("[audit]");
});

it("prefers exact phrases, deduplicates grams and cannot assemble a phrase across punctuation", () => {
  insertMessage("own", message("exact", "采用远程桌面方案。EXACT", { at: 1 }));
  insertMessage("own", message("split", "远程桌，程桌面，桌面方，面方案。SPLIT", { at: 999 }));
  for (let i = 0; i < 48; i++) insertMessage("own", message(`weak-${i}`, `${"远程会议".repeat(50)} WEAK`, { at: i + 200 }));
  const hits = recallMessages("远程桌面方案", ["own"], 12, undefined, "any");
  expect(hits.map((hit) => hit.messageId)).toEqual(["exact"]);
  expect(new Set(chineseRecallQuery("远程桌面远程桌面")!.grams).size).toBe(chineseRecallQuery("远程桌面远程桌面")!.grams.length);
  expect(recallMessages("远程桌面", ["own"], 12, undefined, "any").map((hit) => hit.messageId)).not.toContain("split");
});

it("keeps late source snippets, digest ordering, provenance and tuple deduplication", async () => {
  insertMessage("own", message("same", `${"合成背景。".repeat(200)}远程桌面用于验收 LATE_MARKER`));
  insertMessage("own-two", message("same", "远程桌面，第二个授权线程 SECOND_THREAD"));
  insertMessage("own", message("digest", "远程桌面 DIGEST_MARKER", { role: "bot", kind: "digest", at: 300 }));
  insertMessage("own", message("peer", withPeerProvenance("远程桌面 PEER_MARKER", { botName: "Synthetic Scout", delivery: "ask_bot" })));
  insertMessage("own", message("room", "远程桌面 ROOM_MARKER", { role: "bot", from: { botId: "fixture-peer", name: "Synthetic Scout", color: "#123456" } }));
  insertMessage("own", message("activity", "远程桌面 ACTIVITY", { role: "bot", kind: "activity" }));
  const hits = recallMessages("远程桌面", ["own", "own-two"], 12, undefined, "any");
  expect(hits.filter((hit) => hit.messageId === "same")).toHaveLength(2);
  expect(hits.find((hit) => hit.threadId === "own" && hit.messageId === "same")?.snippet).toContain("LATE_MARKER");
  expect(hits.at(-1)?.kind).toBe("digest");
  expect(hits.find((hit) => hit.messageId === "peer")?.peer).toBe("Synthetic Scout");
  expect(hits.find((hit) => hit.messageId === "room")?.from).toBe("Synthetic Scout");
  expect(hits.some((hit) => hit.messageId === "activity")).toBe(false);
  const digest = await buildRecall(input("远程桌面", ["own-digest"]));
  expect(digest).toBeNull();
  insertMessage("own-digest", message("digest", "远程桌面 DIGEST_ONLY", { role: "bot", kind: "digest" }));
  expect((await buildRecall(input("远程桌面", ["own-digest"])))?.text).toContain("[what you did]");
});

it("maintains derived rows through append, import, upsert, edits, parent changes and transactional deletion", async () => {
  appendMessage("own", message("append", "远程桌面 APPEND"));
  insertMessage("own", message("append", "本地终端 NEW_VERSION", { at: 200 }));
  expect(recallMessages("远程桌面", ["own"])).toEqual([]);
  expect(recallMessages("本地终端", ["own"])[0]?.messageId).toBe("append");
  importThread("imported", [message("old", "远程桌面 IMPORTED")], "old");
  importThread("imported", [message("new", "远程桌面 NEW_IMPORTED")], "new", [{ id: "old", parentId: "new" }]);
  expect(recallMessages("远程桌面", ["imported"])).toHaveLength(2);
  updateMessage("imported", message("old", "终端本地 EDITED"));
  expect(recallMessages("远程桌面", ["imported"]).map((hit) => hit.messageId)).toEqual(["new"]);
  updateMessage("imported", message("new", "远程桌面 ACTIVITY", { role: "bot", kind: "activity" }));
  expect(recallMessages("远程桌面", ["imported"])).toEqual([]);
  updateMessage("imported", message("new", "远程桌面 RESTORED", { at: 500 }));
  expect(recallMessages("远程桌面", ["imported"], 12, { since: 500 } )).toHaveLength(1);
  updateMessage("imported", { ...message("new", ""), text: undefined });
  expect(recallMessages("远程桌面", ["imported"])).toEqual([]);
  insertMessage("own-two", message("append", "本地终端 OTHER_THREAD"));
  expect(() => deleteThreads(["own", "own-two"], () => { throw new Error("fixture rollback"); })).toThrow("fixture rollback");
  expect(recallMessages("本地终端", ["own", "own-two"])).toHaveLength(2);
  deleteThread("own");
  expect((await buildRecall(input("本地终端")))).toBeNull();
  expect(recallMessages("本地终端", ["own-two"])).toHaveLength(1);
  closeMessageDb();
  expect(recallMessages("本地终端", ["own"])).toEqual([]);
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  expect(recallMessages("本地终端", ["own-two"])).toEqual([]);
});

it("enforces short-query noise policy and actual evidence instead of source brackets", async () => {
  for (const query of ["桌面", "中", "的", "中中中中中中中中", "！！！？？？", "%", "_", "", "   ", "123456789", "好的谢谢明白收到"]) {
    expect(recallQuery(query), query).toBeNull();
  }
  expect(recallQuery("服务器")).toBe("服务器");
  insertMessage("own", message("brackets", "A dentist [wrong] [unrelated] note."));
  expect(await buildRecall(input("dentist appointment quarterly office health"))).toBeNull();
  insertMessage("own", message("mixed-long", "我们通过远程桌面管理自己的服务器。TRUSTED_PHRASE"));
  expect((await buildRecall(input("请查远程桌面和自己的服务器方案")))?.text).toContain("TRUSTED_PHRASE");
});

it("keeps conversation count, total budget and fence cleaning at the automatic boundary", async () => {
  for (let i = 0; i < 12; i++) insertMessage("own", message(`budget-${i}`, `远程桌面方案 ${i} ${RECALL_CLOSE} \`\`\` ${"背景。".repeat(250)}`));
  const recall = await buildRecall(input("远程桌面方案"));
  expect(recall!.conversations).toBeLessThanOrEqual(4);
  expect(recall!.text.length).toBeLessThanOrEqual(RECALL_MAX_CHARS);
  expect(recall!.text.split(RECALL_CLOSE)).toHaveLength(2);
  expect(recall!.text).not.toContain("```");
});
