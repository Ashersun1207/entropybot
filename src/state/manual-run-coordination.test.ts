// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { MANUAL_RUN_LOCK_TIMEOUT_MS, ManualRunCoordinationError, withManualRunLedger } from "./manual-run-coordination";
import { testManualRunLocks } from "../testing/manual-run-locks";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(["null", "missing", "getter", "method", "rejection"])("fails closed for %s native capability", async (failure) => {
  const getter = vi.spyOn(navigator, "locks", "get");
  if (failure === "getter") getter.mockImplementation(() => { throw Error("denied"); });
  else getter.mockReturnValue((failure === "null" ? null : failure === "missing" ? {} : {
    request: () => { if (failure === "method") throw Error("denied"); return Promise.reject(Error("denied")); },
  }) as unknown as LockManager);
  const transaction = vi.fn();
  await expect(withManualRunLedger(transaction)).rejects.toBeInstanceOf(ManualRunCoordinationError);
  expect(transaction).not.toHaveBeenCalled();
});

it("aborts acquisition at five seconds and rejects a native callback granted after expiry", async () => {
  vi.useFakeTimers();
  let callback!: LockGrantedCallback<unknown>, signal!: AbortSignal;
  const request = vi.fn((_name, options, action) => { callback = action; signal = options.signal; return new Promise(() => {}); });
  vi.spyOn(navigator, "locks", "get").mockReturnValue({ request } as unknown as LockManager);
  const transaction = vi.fn(); const pending = withManualRunLedger(transaction);
  const rejected = expect(pending).rejects.toBeInstanceOf(ManualRunCoordinationError);
  await vi.advanceTimersByTimeAsync(MANUAL_RUN_LOCK_TIMEOUT_MS);
  await rejected; expect(signal.aborted).toBe(true);
  expect(() => callback({} as Lock)).toThrow(ManualRunCoordinationError);
  expect(transaction).not.toHaveBeenCalled();
});

it("checks the monotonic deadline even before a delayed timeout task runs", async () => {
  const now = vi.spyOn(performance, "now").mockReturnValue(0);
  const manager = testManualRunLocks();
  vi.spyOn(navigator, "locks", "get").mockReturnValue({ request: ((name, options, callback) => {
    now.mockReturnValue(MANUAL_RUN_LOCK_TIMEOUT_MS);
    return manager.request(name, options, callback);
  }) as LockManager["request"] } as LockManager);
  const transaction = vi.fn();
  await expect(withManualRunLedger(transaction)).rejects.toBeInstanceOf(ManualRunCoordinationError);
  expect(transaction).not.toHaveBeenCalled();
});

it("preserves transaction failures and releases coordination for the next transaction", async () => {
  vi.spyOn(navigator, "locks", "get").mockReturnValue(testManualRunLocks());
  const error = Error("storage failed");
  await expect(withManualRunLedger(() => { throw error; })).rejects.toBe(error);
  await expect(withManualRunLedger(() => 7)).resolves.toBe(7);
});

it("does not treat a request resolution without a granted lock as a transaction", async () => {
  vi.spyOn(navigator, "locks", "get").mockReturnValue({ request: () => Promise.resolve(7) } as unknown as LockManager);
  const transaction = vi.fn();
  await expect(withManualRunLedger(transaction)).rejects.toBeInstanceOf(ManualRunCoordinationError);
  expect(transaction).not.toHaveBeenCalled();
});
