import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("starts despite attachment cleanup failure and initializes quota after the directory is repaired", async () => {
  const session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, (dataDir) => writeFileSync(join(dataDir, "attachments"), "fixture obstruction"));
  try {
    await expect(runControlOmb(["doctor", "--url", session.info.url])).resolves.toMatchObject({ ok: true });
    await expect.poll(() => readFileSync(session.info.logPath, "utf8"), { timeout: 5_000 }).toContain("attachments: startup partial cleanup failed:");
    const upload = () => fetch(`${session.info.url}/api/files?name=fixture.txt`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });
    const blocked = await upload();
    expect(blocked.status).toBe(500);
    await blocked.text();

    unlinkSync(join(session.info.dataDir, "attachments"));
    const recovered = await upload();
    expect(recovered.status).toBe(201);
    const saved = await recovered.json() as { path: string; bytes: number };
    expect(saved.path.startsWith(join(session.info.dataDir, "attachments"))).toBe(true);
    expect(saved.bytes).toBe(5);
    expect(readFileSync(saved.path, "utf8")).toBe("hello");
  } finally {
    await session.close();
  }
  expect(existsSync(session.info.dataDir)).toBe(false);
}, 30_000);
