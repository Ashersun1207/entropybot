import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { closeMessageDb, recallMessages } from "./message-db.ts";
import { buildRecall } from "./recall.ts";
import { CHINESE_RECALL_TABLE } from "./message-recall-index.ts";
import { chineseRecallSql } from "./message-recall-chinese.ts";
import { legacyRecallDatabase, putSyntheticMessage } from "./testing/chinese-history-fixture.ts";

const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted.at(-1) };
};
const bytes = (file: string) => [file, `${file}-wal`, `${file}-shm`].map((path) => { try { return { path, bytes: statSync(path).size }; } catch { return { path, bytes: 0 }; } });

it("measures complete synthetic history builds and indexed queries at 2k and 20k rows", async () => {
  const results: unknown[] = [];
  const threads = Array.from({ length: 8 }, (_, i) => `scope-allowed-${i}`);
  for (const count of [2_000, 20_000]) {
    closeMessageDb();
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true });
    const file = join(DATA_DIR, "messages.db");
    const legacy = legacyRecallDatabase(file);
    const seededAt = performance.now();
    const lengths: number[] = [];
    let chineseRows = 0;
    legacy.exec("BEGIN");
    for (let i = 0; i < count; i++) {
      const prefix = i === 0 ? "通过远程桌面管理自己的服务器，使用 Magpie 网关。R2_OLDEST_FACT。"
        : i >= count - 48 ? "远程桌面方案远程桌面方案自己的服务器 PRIVATE_DECOY。"
          : i % 2 === 0 ? "这是远程桌边设备的合成背景记录，不是查询中的连续短语。" : "Magpie operations background, synthetic audit and routine scheduling notes. ";
      const filler = i % 2 === 0 || i >= count - 48 ? "其他合成背景、时间安排、设备清单。" : "Other synthetic context, scheduling details, device inventory. ";
      const text = `${prefix}${filler.repeat(8)}`.slice(0, 100 + i % 61);
      lengths.push(text.length);
      if (/\p{Script=Han}/u.test(text)) chineseRows++;
      const thread = i >= count - 48 ? `scope-private-${i % 8}` : i % 16 < 8 ? threads[i % 8]! : `scope-private-${i % 8}`;
      putSyntheticMessage(legacy, thread, { id: `row-${i}`, text, role: "user", kind: "text", at: 1793966400000 + i });
    }
    legacy.exec("COMMIT; PRAGMA wal_checkpoint(TRUNCATE)");
    const seedMs = performance.now() - seededAt;
    const before = bytes(file);
    legacy.close();
    const coldAt = performance.now();
    expect(recallMessages("远程桌面", threads, 12, undefined, "any")[0]?.messageId).toBe("row-0");
    const firstOpenAndQueryMs = performance.now() - coldAt;
    closeMessageDb();
    const inspect = new DatabaseSync(file);
    inspect.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const after = bytes(file);
    const indexBytes = inspect.prepare("SELECT sum(pgsize) AS bytes FROM dbstat WHERE name LIKE 'messages_cjk_fts%'").get();
    const sqlite = inspect.prepare("SELECT sqlite_version() AS version").get();
    const reopenAt = performance.now();
    expect(recallMessages("远程桌面", threads, 12, undefined, "any")[0]?.messageId).toBe("row-0");
    const reopenAndQueryMs = performance.now() - reopenAt;
    const queries: unknown[] = [];
    for (const query of ["远程桌面", "Magpie 网关", "不存在的合成关键词"]) {
      const spec = chineseRecallSql(query, threads, 12, undefined, "any")!;
      const plan = inspect.prepare(`EXPLAIN QUERY PLAN ${spec.sql}`).all(...spec.params);
      expect(JSON.stringify(plan)).toContain("VIRTUAL TABLE INDEX");
      expect(JSON.stringify(plan)).not.toMatch(/SCAN m(?:\s|"|$)/);
      const match = spec.params.find((value) => typeof value === "string" && value.startsWith("text :"))!;
      const indexedMatches = inspect.prepare(`SELECT count(*) AS n FROM ${CHINESE_RECALL_TABLE} WHERE ${CHINESE_RECALL_TABLE} MATCH ?`).get(match);
      const helper: number[] = [], assembled: number[] = [];
      let lastHits = 0;
      for (let repeat = -5; repeat < 30; repeat++) {
        let at = performance.now();
        const hits = recallMessages(query, threads, 12, undefined, "any");
        const helperMs = performance.now() - at;
        expect(hits.length).toBeLessThanOrEqual(12);
        expect(hits.every((hit) => threads.includes(hit.threadId))).toBe(true);
        if (query === "远程桌面") expect(hits[0]?.messageId).toBe("row-0");
        if (query === "不存在的合成关键词") expect(hits).toEqual([]);
        lastHits = hits.length;
        at = performance.now();
        const recall = await buildRecall({ botId: "fixture-performance", message: query, threadIds: threads, label: (id) => id, author: () => "Synthetic person", embedding: null });
        const assembledMs = performance.now() - at;
        expect(recall?.conversations ?? 0).toBeLessThanOrEqual(4);
        if (repeat >= 0) { helper.push(helperMs); assembled.push(assembledMs); }
      }
      queries.push({ query, indexedMatches, returnedCandidates: lastHits, chineseCandidateCap: 12, helperMs: summary(helper), buildRecallMs: summary(assembled), plan });
    }
    inspect.close();
    closeMessageDb();
    results.push({ count, authorizedThreads: 8, privateThreads: 8, finalPrivateDecoys: 48, targetAtOldestRow: true, chineseRows, chineseFraction: chineseRows / count, textChars: { min: Math.min(...lengths), max: Math.max(...lengths) }, seedMs, firstOpenAndQueryMs, reopenAndQueryMs, before, after, indexBytes, node: process.version, sqlite, cpu: cpus()[0]?.model, queries });
  }
  console.info(JSON.stringify({ chineseHistoryPerformance: results }));
  if (process.env.OMB_RECALL_PERFORMANCE_OUTPUT) writeFileSync(process.env.OMB_RECALL_PERFORMANCE_OUTPUT, JSON.stringify(results, null, 2));
}, 120_000);
