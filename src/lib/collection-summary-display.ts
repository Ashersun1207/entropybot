import type { Message } from "@/state/store";

type SummaryMessage = Partial<Pick<Message, "role" | "kind" | "text" | "automation">>;

/** Display only: durable publication text and receipts must retain their original bytes. */
export function collectionSummaryDisplay(message: SummaryMessage): string | null {
  const line = message.automation;
  if (message.role !== "bot" || message.kind !== "text" || !line || line.trigger !== "manual"
    || !line.routineId || !line.runId || !line.executionThreadId || line.failed || line.needsYou || line.copyOf
    || !message.text || message.text.length > 16_384) return null;
  const match = /^Web collection report\nPages: ([1-9]\d*)\nUnique: ([1-9]\d*)\nPath: ("[^\n]+")\nSHA-256: ([a-f0-9]{64})$/.exec(message.text);
  if (!match || match[0] !== message.text) return null;
  const pages = Number(match[1]), unique = Number(match[2]);
  if (pages > 100 || unique > pages) return null;
  try {
    const path: unknown = JSON.parse(match[3]);
    if (typeof path !== "string" || !path) return null;
  } catch { return null; }
  return `Web collection report\nPages: ${pages}\nUnique: ${unique}`;
}
