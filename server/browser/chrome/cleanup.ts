import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ChromeCleanupState {
  status: "closed" | "unknown" | "cleanup-failed";
  userDataDir: string;
}

export class ChromeCleanupError extends Error {
  readonly cleanup: ChromeCleanupState;
  readonly retryCleanup?: () => Promise<void>;

  constructor(message: string, cleanup: ChromeCleanupState, options?: ErrorOptions, retryCleanup?: () => Promise<void>) {
    super(message, options);
    this.name = "ChromeCleanupError";
    this.cleanup = cleanup;
    this.retryCleanup = retryCleanup;
  }
}

export function chromeCleanupState(error: unknown, userDataDir: string): ChromeCleanupState {
  return error instanceof ChromeCleanupError ? error.cleanup : { status: "unknown", userDataDir };
}

export function removeClosedChromeDirectory(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch (error) { throw new ChromeCleanupError("Chrome closed but directory cleanup failed.", { status: "cleanup-failed", userDataDir: dir }, { cause: error }); }
}

export async function withChromeWorkDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "omb-browser-"));
  let closed = false;
  try {
    const result = await run(dir);
    closed = true;
    return result;
  } catch (error) {
    closed = chromeCleanupState(error, dir).status === "closed";
    throw error;
  } finally {
    if (closed) removeClosedChromeDirectory(dir);
  }
}
