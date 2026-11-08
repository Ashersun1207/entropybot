import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readCollectionReport } from "./collection-report-access.ts";
import { runCommand } from "./commands.ts";
import { closeMessageDb } from "./message-db.ts";
import type { RoutineRun } from "./routines.ts";
import { collectWeb } from "./web-collection.ts";

let afterRead: (() => void) | undefined;
vi.mock("node:fs", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, readSync: (...args: Parameters<typeof fs.readSync>) => {
    const count = fs.readSync(...args);
    const callback = afterRead; afterRead = undefined; callback?.();
    return count;
  } };
});
const dirs: string[] = [];
afterEach(() => { afterRead = undefined; closeMessageDb(); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "report-access-")));
  dirs.push(dir);
  const root = join(dir, "collection-reports"); mkdirSync(root, { mode: 0o700 });
  const collection = { kind: "web-collection" as const, version: 1 as const, sources: [{ url: "https://synthetic.invalid/page" }],
    limits: { pages: 1, bytes: 100, pageBytes: 100, attempts: 1, durationMs: 1000 } };
  const run = { id: dir, routineId: "routine", manual: true, triggerSource: "manual", target: "bot", runOn: "maus", collection } as RoutineRun;
  const requestId = "synthetic-request";
  const plan = { ...collection, version: "web-collection/1" };
  const key = hash(JSON.stringify([run.routineId, run.id]));
  const binding = hash(JSON.stringify({ identity: JSON.stringify([run.routineId, run.id, requestId]), plan, root }));
  const file = join(root, `${key}.json`);
  return { dir, root, run, requestId, plan, key, binding, file,
    collect: () => collectWeb({ run, requestId, plan, outputRoot: root, signal: new AbortController().signal, read: async () => "<script>inert</script>" }),
    read: () => readCollectionReport(dir, run, requestId) };
}

it("requires the original request and completion receipts, preserving artifact bytes", async () => {
  const f = fixture();
  expect(f.read).toThrow("not available");
  await f.collect();
  const bytes = readFileSync(f.file);
  expect(f.read().sources[0]?.text).toBe("<script>inert</script>");
  expect(() => readCollectionReport(f.dir, f.run, "other-request")).toThrow("could not be verified");
  expect(readFileSync(f.file)).toEqual(bytes);
});

it.each(["file", "root", "rewrite"])("rejects %s substitution during the fd read even with matching report bytes", async target => {
  const f = fixture(); await f.collect();
  const bytes = readFileSync(f.file);
  afterRead = () => {
    if (target === "root") {
      renameSync(f.root, f.root + ".old"); mkdirSync(f.root, { mode: 0o700 }); writeFileSync(f.file, bytes);
    } else if (target === "file") {
      renameSync(f.file, f.file + ".old"); writeFileSync(f.file, bytes);
    } else { chmodSync(f.file, 0o644); }
  };
  expect(f.read).toThrow("could not be verified");
});

it.each(["binding", "version", "pages", "url", "text", "extra", "invalid-json", "path"])("rejects hash-matching malformed %s artifacts or receipts", field => {
  const f = fixture();
  const artifact: any = { version: 1, binding: f.binding, pages: 1, sources: [{ url: f.plan.sources[0].url, text: "safe" }] };
  if (field === "binding") artifact.binding = "wrong";
  if (field === "version") artifact.version = 2;
  if (field === "pages") artifact.pages = 2;
  if (field === "url") artifact.sources[0].url = "file:///private/secret";
  if (field === "text") artifact.sources[0].text = "x".repeat(101);
  if (field === "extra") artifact.html = "<iframe>";
  const text = field === "invalid-json" ? "{bad" : JSON.stringify(artifact);
  writeFileSync(f.file, text);
  runCommand({ kind: "web-collection.v1", key: `${f.key}:plan` }, () => ({ binding: f.binding, deadline: 1000 }));
  runCommand({ kind: "web-collection.v1", key: `${f.key}:completed` }, () => ({ path: field === "path" ? join(f.root, "..", "outside.json") : f.file,
    hash: hash(text), pages: 1, unique: 1 }));
  expect(f.read).toThrow("could not be verified");
});
