import { createServer } from "node:http";
import { expect, it, onTestFinished, vi } from "vitest";
import { VisibleSet } from "./bot-visibility.ts";
import { json, readBody } from "./harness/http.ts";
import type { RequestAuth } from "./request-auth.ts";
import { createCollectionReportAccessRoutes } from "./routes/collection-report-access.ts";
import type { RoutineRun } from "./routines.ts";

it("denies retained runs whose bot or any snapshotted conversation disappeared, changed owner, or is hidden", async () => {
  let run = { id: "run", routineId: "routine", botId: "bot", threadId: "execution", resultsThreadId: "results", sourceThreadId: "source" } as RoutineRun;
  let botExists = true;
  let missing = false;
  let wrongOwner = "";
  let hidden = "";
  let receiptReads = 0;
  let auth: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
  const visible = new VisibleSet([], [], { kind: "all" });
  vi.spyOn(visible, "thread").mockImplementation(id => id !== hidden);
  vi.spyOn(visible, "hides").mockImplementation(id => id === hidden);
  const handler = createCollectionReportAccessRoutes({ dataDir: "unused-no-file-read",
    routines: () => ({ listRuns: () => missing ? [] : [run], collectionRequestId: () => { receiptReads++; return null; } }),
    botExists: () => botExists, visible: () => visible, threadBot: id => id === wrongOwner ? "other-bot" : "bot" });
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    void handler({ req, res, url, path: url.pathname, method: req.method!, auth, json, readBody }).catch(() => { res.writeHead(500); res.end(); });
  });
  onTestFinished(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/api/routines/routine/runs/run/collection-report`;
  const status = async () => (await fetch(url, { signal: AbortSignal.timeout(2000) })).status;
  expect(await status()).toBe(409);
  receiptReads = 0;
  for (const id of ["execution", "results", "source"]) {
    wrongOwner = id; expect(await status()).toBe(404); wrongOwner = "";
    hidden = id; expect(await status()).toBe(404); hidden = "";
  }
  botExists = false; expect(await status()).toBe(404); botExists = true;
  missing = true; expect(await status()).toBe(404); missing = false;
  run = { ...run, botId: "other-bot" }; expect(await status()).toBe(404);
  auth = { kind: "loopback", trust: "service", scopes: ["client"] }; expect(await status()).toBe(403);
  expect(receiptReads).toBe(0);
});
