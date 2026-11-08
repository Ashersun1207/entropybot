import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, type Stats } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { CollectionReportResponse } from "../shared/collection-report.ts";
import { commandReceipt } from "./commands.ts";
import { cleanCollectionPlan } from "./routine-collection-plan.ts";
import type { RoutineRun } from "./routines.ts";
import { collectionUrl } from "./web-collection.ts";

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const completionSchema = z.object({ path: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.number().int(), unique: z.number().int() }).strict();
const artifactSchema = z.object({ version: z.literal(1), binding: z.string(), pages: z.number().int(),
  sources: z.array(z.object({ url: z.string().max(8192), text: z.string().max(1_000_000) }).strict()).max(100) }).strict();

export class CollectionReportError extends Error {
  readonly code: "collection_report_unavailable" | "collection_report_invalid";
  constructor(code: "collection_report_unavailable" | "collection_report_invalid") {
    super(code === "collection_report_unavailable" ? "Collection report is not available." : "Collection report could not be verified.");
    this.code = code;
  }
}

function same(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.nlink === b.nlink &&
    a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

/** Read only the completed artifact bound to the retained run and its original request receipt. */
export function readCollectionReport(dataDir: string, run: RoutineRun, requestId: string): CollectionReportResponse {
  try {
    const saved = cleanCollectionPlan(run.collection);
    if (!saved || !run.manual || run.triggerSource !== "manual" || run.target !== "bot" || run.runOn !== "maus") {
      throw new CollectionReportError("collection_report_unavailable");
    }
    const plan = { ...saved, version: "web-collection/1" };
    const root = resolve(dataDir, "collection-reports");
    const key = digest(JSON.stringify([run.routineId, run.id]));
    const completed = commandReceipt("web-collection.v1", `${key}:completed`);
    if (!completed) throw new CollectionReportError("collection_report_unavailable");
    const receipt = completionSchema.parse(completed.result);
    const file = join(root, `${key}.json`);
    const binding = digest(JSON.stringify({ identity: JSON.stringify([run.routineId, run.id, requestId]), plan, root }));
    const initial = commandReceipt<{ binding: string }>("web-collection.v1", `${key}:plan`);
    if (initial?.result.binding !== binding || receipt.path !== file || receipt.pages !== plan.sources.length) throw new Error("binding");
    const rootBefore = lstatSync(root);
    if (realpathSync(root) !== root || !rootBefore.isDirectory() || rootBefore.isSymbolicLink() || (rootBefore.mode & 0o077)) throw new Error("root");
    const parentBefore = lstatSync(resolve(dataDir));
    const before = lstatSync(file);
    const maxBytes = Math.min(61_000_000, plan.sources.length * (plan.limits.pageBytes * 6 + 50_000) + 1024);
    if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes) throw new Error("file");
    if (!constants.O_NOFOLLOW || !constants.O_NONBLOCK) throw new Error("flags");
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || !same(before, opened)) throw new Error("changed");
      const buffer = Buffer.alloc(opened.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const count = readSync(fd, buffer, length, buffer.length - length, null);
        if (!count) break;
        length += count;
      }
      if (length !== opened.size || !same(opened, fstatSync(fd)) || !same(opened, lstatSync(file)) ||
        !same(rootBefore, lstatSync(root)) || !same(parentBefore, lstatSync(resolve(dataDir))) || realpathSync(root) !== root) throw new Error("changed");
      bytes = buffer.subarray(0, length);
    } finally { closeSync(fd); }
    if (digest(bytes) !== receipt.hash) throw new Error("hash");
    const artifact = artifactSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    const urls = [...new Set(plan.sources.map(source => collectionUrl(source.url)))];
    if (artifact.binding !== binding || artifact.pages !== receipt.pages || receipt.unique !== urls.length || artifact.sources.length !== urls.length ||
      artifact.sources.some((row, i) => row.url !== urls[i] || Buffer.byteLength(row.text) > plan.limits.pageBytes)) throw new Error("schema");
    return { version: 1, hash: receipt.hash, pages: artifact.pages, unique: artifact.sources.length, sources: artifact.sources };
  } catch (error) {
    if (error instanceof CollectionReportError) throw error;
    throw new CollectionReportError("collection_report_invalid");
  }
}
