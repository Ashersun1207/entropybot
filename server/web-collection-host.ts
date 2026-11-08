import { createHash } from "node:crypto";

import { commandReceipt, runCommand } from "./commands.ts";
import type { RoutineRun } from "./routines.ts";
import { collectWeb, type CollectionOptions, type CollectionReport } from "./web-collection.ts";

export interface CollectionPublication {
  key: string;
  text: string;
  signal: AbortSignal;
}

export interface CollectionHostOptions extends Omit<CollectionOptions, "run" | "fault"> {
  run: RoutineRun;
  /** Resolve only after publication is confirmed. A failure leaves an unknown outcome and cannot be automatically resent. */
  publish: (publication: CollectionPublication) => Promise<void>;
  /** Local publishers may reconcile a reservation using a durable, idempotent message command. Never resend an external effect. */
  reconcile?: (publication: CollectionPublication) => Promise<void>;
}

export async function hostWebCollection(options: CollectionHostOptions): Promise<CollectionReport> {
  const report = await collectWeb(options);
  const text = `Web collection report\nPages: ${report.pages}\nUnique: ${report.unique}\nPath: ${JSON.stringify(report.path)}\nSHA-256: ${report.hash}`;
  if (Buffer.byteLength(text) > 4096) throw new Error("Collection summary byte limit exceeded");
  const key = createHash("sha256").update(JSON.stringify([options.run.routineId, options.run.id])).digest("hex");
  const binding = createHash("sha256").update(JSON.stringify([options.requestId, report, text])).digest("hex");
  const kind = "web-collection.publish.v1";
  const completed = commandReceipt<{ binding: string }>(kind, `${key}:completed`);
  if (completed) {
    if (completed.result.binding !== binding) throw new Error("Collection publication binding mismatch");
    return report;
  }
  options.signal.throwIfAborted();
  let admitted = false;
  const reservation = runCommand({ kind, key: `${key}:reserved` }, () => {
    admitted = true;
    return { binding };
  }, options.now);
  if (reservation.binding !== binding) throw new Error("Collection publication binding mismatch");
  if (!admitted && !options.reconcile) throw new Error("Collection publication outcome unknown; reconciliation required, no resend");
  await (admitted ? options.publish : options.reconcile!)({ key, text, signal: options.signal });
  runCommand({ kind, key: `${key}:completed` }, () => ({ binding }), options.now);
  return report;
}
