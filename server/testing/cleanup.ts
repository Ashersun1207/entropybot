// Teardown primitives for suites that spawn a real process against a throwaway home.
import type { ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";

export interface WaitForExitOptions {
  /** Sent immediately. Omit for a child the caller has already signalled. */
  signal?: NodeJS.Signals;
  /** How long the polite signal gets before SIGKILL. */
  graceMs?: number;
}

/** End a child and wait for `close`: kill() does not wait, and deleting its home mid-write fails on
 * Linux with EACCES/ENOTEMPTY. A SIGKILL after `graceMs` is not an exit either. */
export function waitForExit(
  child: ChildProcess | undefined,
  options: WaitForExitOptions | number = {},
): Promise<void> {
  const { signal, graceMs = 5_000 } = typeof options === "number" ? { graceMs: options } : options;

  return new Promise<void>((resolve, reject) => {
    if (!child) return resolve();
    const exited = child.exitCode !== null || child.signalCode !== null;
    if (exited && !child.connected && child.stdio.every(stream => !stream || stream.destroyed)) return resolve();
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.off("close", done);
      if (error) reject(error); else resolve();
    };
    const done = () => finish();
    child.once("close", done);
    timer = setTimeout(() => {
      try { if (!exited) child.kill("SIGKILL"); }
      catch (error) { finish(error as Error); return; }
      timer = setTimeout(() => finish(new Error("Child exit/close was not confirmed; preserve its directory")), 2_000);
      timer.unref?.();
    }, graceMs);
    timer.unref?.();
    if (signal && !exited) {
      try { child.kill(signal); }
      catch (error) { finish(error as Error); }
    }
  });
}

/** A just-killed child lets go of its files a beat later, and rmSync's maxRetries misses EACCES/EPERM on
 * the directory itself: retry briefly, then warn and leave it. */
export async function removeTempDir(dir: string): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < 20; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  console.warn(
    `test cleanup could not remove ${dir}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
