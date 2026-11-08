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

export interface RoutineManualRequest {
  origin: "http";
  authority: string;
  requestId: string;
  routineId: string;
  fingerprintVersion: 1;
  fingerprint: string;
}

export interface RoutineManualReceipt extends RoutineManualRequest {
  resultId: string;
  appliedAt: number;
}

export type StoredRoutineRequestReceipt = RoutineRequestReceipt | RoutineManualReceipt;
const MAX_MANUAL_RECEIPTS = 1000;

export class RoutineReceiptCorruptionError extends Error {
  readonly status = 503;
  readonly code = "routine_receipts_corrupt";

  constructor() {
    super("Saved HTTP routine receipts are inconsistent; repair routines.json before starting routines.");
    this.name = "RoutineReceiptCorruptionError";
  }
}

export class RoutineRequestReceipts {
  private entries: StoredRoutineRequestReceipt[];

  constructor(entries: StoredRoutineRequestReceipt[] = []) {
    this.entries = entries.map((receipt) => ({ ...receipt }));
  }

  snapshot(): StoredRoutineRequestReceipt[] {
    return this.entries.map((receipt) => ({ ...receipt }));
  }

  receipt(requestId: string): RoutineRequestReceipt | null {
    const receipt = this.cards().find((candidate) => candidate.requestId === requestId);
    return receipt ? { ...receipt } : null;
  }

  owners(): RoutineRequestOwner[] {
    return this.cards().map(({ requestId, messageId, botId, threadId }) => ({ requestId, messageId, botId, threadId }));
  }

  matching(request: RoutineRequestCommit): RoutineRequestReceipt | null {
    const receipt = this.cards().find((candidate) => candidate.requestId === request.requestId);
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

  withoutThread(threadId: string): StoredRoutineRequestReceipt[] {
    return this.entries.filter((receipt) => isManualReceipt(receipt) || receipt.threadId !== threadId);
  }

  reachable(owners: readonly RoutineRequestOwner[]): StoredRoutineRequestReceipt[] {
    const keys = new Set(owners.map(ownerKey));
    return this.entries.filter((receipt) => isManualReceipt(receipt) || keys.has(ownerKey(receipt)));
  }

  matchingManual(request: RoutineManualRequest): RoutineManualReceipt | null {
    const receipt = this.entries.find((candidate): candidate is RoutineManualReceipt =>
      isManualReceipt(candidate) && candidate.requestId === request.requestId);
    if (receipt && (receipt.routineId !== request.routineId || receipt.authority !== request.authority ||
      receipt.fingerprintVersion !== request.fingerprintVersion || receipt.fingerprint !== request.fingerprint)) {
      throw Object.assign(new Error("Idempotency key conflicts with the current routine definition"), { status: 409 });
    }
    return receipt ?? null;
  }

  assertManualCapacity(): void {
    if (this.entries.filter(isManualReceipt).length >= MAX_MANUAL_RECEIPTS) {
      throw Object.assign(new Error("Manual retry history is full"), { status: 429 });
    }
  }

  rememberManual(request: RoutineManualRequest, resultId: string, appliedAt: number): void {
    this.assertManualCapacity();
    this.entries.unshift({ ...request, resultId, appliedAt });
  }

  manualForRun(runId: string, routineId: string): RoutineManualReceipt | null {
    const matches = this.entries.filter((receipt): receipt is RoutineManualReceipt =>
      isManualReceipt(receipt) && receipt.resultId === runId);
    if (matches.length !== 1 || matches[0].routineId !== routineId) return null;
    return { ...matches[0] };
  }

  protectsRun(runId: string): boolean {
    return this.entries.some((receipt) => isManualReceipt(receipt) && receipt.resultId === runId);
  }

  private cards(): RoutineRequestReceipt[] {
    return this.entries.filter((receipt): receipt is RoutineRequestReceipt => !isManualReceipt(receipt));
  }

  get size(): number { return this.entries.length; }
}

export function isManualReceipt(receipt: StoredRoutineRequestReceipt): receipt is RoutineManualReceipt {
  return "origin" in receipt && receipt.origin === "http";
}
