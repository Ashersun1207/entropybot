export const MANUAL_RUN_LEDGER_LOCK = "entropybot.manual-routine-intents.v1";
export const MANUAL_RUN_LOCK_TIMEOUT_MS = 5_000;

export class ManualRunCoordinationError extends Error {}

/** Runs one synchronous ledger transaction under the origin's native Web Lock. */
export function withManualRunLedger<T>(transaction: () => T & (T extends PromiseLike<unknown> ? never : unknown)): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const deadline = performance.now() + MANUAL_RUN_LOCK_TIMEOUT_MS;
    let settled = false;
    let executed = false;
    const finish = (result: { value: T } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if ("error" in result) reject(result.error); else resolve(result.value);
    };
    const timer = setTimeout(() => {
      finish({ error: new ManualRunCoordinationError() });
      controller.abort();
    }, MANUAL_RUN_LOCK_TIMEOUT_MS);
    try {
      const locks = globalThis.navigator?.locks;
      if (!locks || typeof locks.request !== "function") throw new ManualRunCoordinationError();
      const requested = locks.request(MANUAL_RUN_LEDGER_LOCK, { mode: "exclusive", signal: controller.signal }, (lock) => {
        if (settled || controller.signal.aborted || performance.now() >= deadline || !lock) throw new ManualRunCoordinationError();
        executed = true;
        return transaction();
      });
      void Promise.resolve(requested).then(
        (value) => finish(executed ? { value } : { error: new ManualRunCoordinationError() }),
        (error: unknown) => finish({ error: executed ? error : new ManualRunCoordinationError() }),
      );
    } catch (error) {
      finish({ error: executed ? error : new ManualRunCoordinationError() });
    }
  });
}
