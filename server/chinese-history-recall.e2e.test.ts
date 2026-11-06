import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { RECALL_CLOSE, RECALL_OPEN } from "./recall.ts";
import { putSyntheticMessage } from "./testing/chinese-history-fixture.ts";

it("injects only authorized Chinese history into fresh current-turn prompts and invalidates edited/deleted sources", async ({ onTestFinished }) => {
  const scratch = mkdtempSync(join(tmpdir(), "omb-chinese-recall-"));
  onTestFinished(() => rmSync(scratch, { recursive: true, force: true }));
  const prompts = join(scratch, "prompts.jsonl");
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_PROMPTS: prompts });
  const control = (...args: string[]) => runControlOmb([...args, "--url", fixture.info.url]);
  const api = async (path: string, method = "GET", body?: unknown, expected = 200): Promise<Record<string, any>> => {
    const response = await fetch(`${fixture.info.url}${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    expect(response.status, `${method} ${path}`).toBe(expected);
    return await response.json() as Record<string, any>;
  };
  const promptRows = (): Array<{ type?: string; message?: { content?: string | Array<{ text?: string }> } }> => {
    try { return readFileSync(prompts, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; }
  };
  const evidence: unknown[] = [];
  try {
    await expect(control("doctor")).resolves.toMatchObject({ ok: true });
    await api("/api/config", "PATCH", { memoryEmbedding: { enabled: false } });
    const owner = (await api("/api/bots", "POST", { name: "Synthetic Recall A" }, 201)).bot as { id: string; threadId: string };
    const other = (await api("/api/bots", "POST", { name: "Synthetic Recall B" }, 201)).bot as { id: string; threadId: string };
    for (const bot of [owner, other]) await api(`/api/bots/${bot.id}`, "PATCH", { memoryUpkeep: false });
    const task = async (title: string) => (await api(`/api/bots/${owner.id}/tasks`, "POST", { title }, 201)).task.threadId as string;
    const turn = async (threadId: string, text: string) => {
      await control("send", "--bot", owner.id, "--task", threadId, "--text", text);
      const wait = await control("wait", "--bot", owner.id, "--task", threadId, "--timeout", "30");
      expect(wait).toMatchObject({ status: "settled" });
      return { wait, messages: await control("messages", "--bot", owner.id, "--task", threadId, "--limit", "10") };
    };
    const source = await task("Synthetic authorized source");
    await turn(source, "合成记录：我们决定通过远程桌面管理自己的服务器。R2_UNIQUE_AUTHORIZED_FACT");
    const database = new DatabaseSync(join(fixture.info.dataDir, "messages.db"));
    try {
      for (let i = 0; i < 48; i++) putSyntheticMessage(database, other.threadId, { id: `private-${i}`, at: 1793966400000 + i, role: "user", kind: "text", text: `远程桌面方案远程桌面方案自己的服务器 R2_PRIVATE_CANARY_${i}` });
      const query = "上次远程桌面方案是什么";
      const askFresh = async (name: string, marker?: string) => {
        const threadId = await task(name);
        const before = promptRows().length;
        const result = await turn(threadId, query);
        const rows = promptRows().slice(before);
        const userTexts = rows.flatMap((row) => {
          if (row.type !== "user") return [];
          const content = row.message?.content;
          return typeof content === "string" ? [content] : Array.isArray(content) ? [content.map((part) => part.text ?? "").join("\n")] : [];
        }).filter((text) => text.includes(query));
        expect(userTexts).toHaveLength(1);
        const text = userTexts[0]!;
        const start = text.indexOf(RECALL_OPEN);
        const end = text.indexOf(RECALL_CLOSE, Math.max(0, start));
        const block = start >= 0 && end >= start ? text.slice(start, end + RECALL_CLOSE.length) : "";
        expect(JSON.stringify(rows)).not.toContain("R2_PRIVATE_CANARY");
        if (marker) {
          expect(query).not.toContain(marker);
          expect(block).toContain(marker);
          expect(block).toContain("Synthetic authorized source");
        } else {
          expect(text).not.toContain("R2_UNIQUE_AUTHORIZED_FACT");
          expect(text).not.toContain("R2_RESTORED_FOR_DELETE");
          expect(block).toBe("");
        }
        evidence.push({ name, threadId, userText: text, recalledBlock: block, ...result });
        await api(`/api/bots/${owner.id}/tasks/${threadId}`, "DELETE");
      };
      await askFresh("Fresh positive", "R2_UNIQUE_AUTHORIZED_FACT");
      const sourceRow = database.prepare("SELECT id, json FROM messages WHERE thread_id = ? AND kind = 'text' AND role = 'user' AND instr(text, 'R2_UNIQUE_AUTHORIZED_FACT') > 0").get(source) as { id: string; json: string };
      expect(sourceRow).toBeDefined();
      const replaceSource = (text: string) => {
        const value = { ...JSON.parse(sourceRow.json), text };
        database.prepare("UPDATE messages SET text = ?, json = ? WHERE thread_id = ? AND id = ?").run(text, JSON.stringify(value), source, sourceRow.id);
      };
      replaceSource("合成记录：改用本地终端处理。R2_EDITED");
      await askFresh("Fresh after edit");
      replaceSource("合成记录：通过远程桌面管理自己的服务器。R2_RESTORED_FOR_DELETE");
      await askFresh("Fresh restored positive", "R2_RESTORED_FOR_DELETE");
      await api(`/api/bots/${owner.id}/tasks/${source}`, "DELETE");
      await askFresh("Fresh after deletion");
    } finally { database.close(); }
    console.info(JSON.stringify({ fixture: fixture.info, currentTurnEvidence: evidence }));
    if (process.env.OMB_RECALL_PROMPT_OUTPUT) writeFileSync(process.env.OMB_RECALL_PROMPT_OUTPUT, JSON.stringify({ fixture: fixture.info, evidence }, null, 2));
  } finally {
    await fixture.close();
  }
}, 120_000);
