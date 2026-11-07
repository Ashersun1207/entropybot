import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("keeps an ACP partial reply in the transcript across graceful shutdown and restart", async () => {
  const fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, undefined, ["cline"]);
  const { dataDir, url } = fixture.info;
  const cli = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  try {
    await fixture.stop("SIGTERM");
    const configPath = join(dataDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.instances.cline.environment.FAKE_ACP_MODE = "stall-after-text";
    writeFileSync(configPath, JSON.stringify(config));
    await fixture.restart(undefined, { signal: "SIGTERM" });

    const { bot } = await cli("new-bot", "--name", "Shutdown probe");
    await cli("set-model", "--bot", bot.id, "--instance", "cline", "--model", "cline-default");
    await cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "hello");
    await expect.poll(() => {
      try {
        return readFileSync(join(dataDir, "events", `${bot.activeTaskId}.ndjson`), "utf8")
          .includes('"delta":"half an answer, then silence"');
      } catch { return false; }
    }, { timeout: 15_000 }).toBe(true);

    await fixture.stop("SIGTERM");
    expect(fixture.child.exitCode).toBe(0);
    const db = new DatabaseSync(join(dataDir, "messages.db"), { readOnly: true });
    try {
      expect(db.prepare("SELECT text FROM messages WHERE thread_id = ? AND role = 'bot' AND kind = 'text' AND text = ?")
        .all(bot.activeTaskId, "half an answer, then silence")).toEqual([{ text: "half an answer, then silence" }]);
    } finally { db.close(); }

    await fixture.restart(undefined, { signal: "SIGTERM" });
    const transcript = await cli("messages", "--bot", bot.id, "--task", bot.activeTaskId, "--limit", "20");
    expect(JSON.stringify(transcript)).toContain("half an answer, then silence");
  } finally {
    await fixture.close();
  }
}, 90_000);
