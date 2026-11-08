import type { RoutineRequestOperation } from "../shared/routine-request.ts";

export interface RoutineRequestReceipt {
  requestId: string;
  messageId: string;
  botId: string;
  threadId: string;
  action: RoutineRequestOperation["action"];
  fingerprintVersion: 1;
  fingerprint: string;
  resultId: string;
  appliedAt: number;
}

export interface RoutineRequestCommit {
  requestId: string;
  messageId: string;
  botId: string;
  threadId: string;
  action: RoutineRequestOperation["action"];
  fingerprintVersion: 1;
  fingerprint: string;
}

export type RoutineRequestOwner = Pick<RoutineRequestReceipt, "requestId" | "messageId" | "botId" | "threadId">;

function ownerKey(owner: RoutineRequestOwner): string {
  return JSON.stringify([owner.requestId, owner.messageId, owner.botId, owner.threadId]);
}

export class RoutineRequestReceipts {
  private entries: RoutineRequestReceipt[];

  constructor(entries: RoutineRequestReceipt[] = []) {
    this.entries = entries.map((receipt) => ({ ...receipt }));
  }

  snapshot(): RoutineRequestReceipt[] {
    return this.entries.map((receipt) => ({ ...receipt }));
  }

  receipt(requestId: string): RoutineRequestReceipt | null {
    const receipt = this.entries.find((candidate) => candidate.requestId === requestId);
    return receipt ? { ...receipt } : null;
  }

  owners(): RoutineRequestOwner[] {
    return this.entries.map(({ requestId, messageId, botId, threadId }) => ({ requestId, messageId, botId, threadId }));
  }

  matching(request: RoutineRequestCommit): RoutineRequestReceipt | null {
    const receipt = this.entries.find((candidate) => candidate.requestId === request.requestId);
    if (!receipt) return null;
    if (receipt.action !== request.action || receipt.messageId !== request.messageId ||
      receipt.botId !== request.botId || receipt.threadId !== request.threadId ||
      receipt.fingerprintVersion !== request.fingerprintVersion || receipt.fingerprint !== request.fingerprint) {
      throw new Error("Routine request receipt does not match this confirmation card");
    }
    return receipt;
  }

  remember(request: RoutineRequestCommit, resultId: string, appliedAt: number): void {
    const existing = this.matching(request);
    if (existing) {
      if (existing.resultId !== resultId) throw new Error("Routine request receipt has another result");
      return;
    }
    this.entries.unshift({ ...request, resultId, appliedAt });
  }

  forget(request: RoutineRequestCommit): boolean {
    const receipt = this.matching(request);
    if (!receipt) return false;
    this.entries.splice(this.entries.indexOf(receipt), 1);
    return true;
  }

  withoutThread(threadId: string): RoutineRequestReceipt[] {
    return this.entries.filter((receipt) => receipt.threadId !== threadId);
  }

  reachable(owners: readonly RoutineRequestOwner[]): RoutineRequestReceipt[] {
    const keys = new Set(owners.map(ownerKey));
    return this.entries.filter((receipt) => keys.has(ownerKey(receipt)));
  }

  get size(): number { return this.entries.length; }
}
