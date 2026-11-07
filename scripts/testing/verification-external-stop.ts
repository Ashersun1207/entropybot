import type { ChildProcess } from "node:child_process";
import { sameVerificationIdentity, type VerificationIdentity } from "../../server/verification-process-scope.ts";

export async function captureVerificationGroups(child: ChildProcess, identity: VerificationIdentity, timeoutMs: number): Promise<number[]> {
  if (!["darwin", "linux", "freebsd", "openbsd", "netbsd"].includes(process.platform)) throw new Error("External verification stop unsupported on this platform");
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, groups?: number[]) => {
      clearTimeout(timer);
      child.off("message", message);
      if (error) reject(error); else resolve(groups!);
    };
    const message = (value: unknown) => {
      const frame = value as { type?: string; identity?: VerificationIdentity; serverPid?: number; groups?: unknown; reason?: string };
      if (frame?.type !== "verification:inventory") return;
      if (!sameVerificationIdentity(frame.identity, identity) || frame.serverPid !== child.pid || frame.reason || !Array.isArray(frame.groups)
        || frame.groups.some(pid => !Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid || pid === child.pid)) {
        finish(new Error(frame.reason ?? "External verification inventory invalid"));
        return;
      }
      finish(undefined, [...new Set(frame.groups)] as number[]);
    };
    const timer = setTimeout(() => finish(new Error("External verification inventory deadline exceeded")), timeoutMs);
    child.on("message", message);
    try { child.send({ type: "verification:external-stop" }, error => { if (error) finish(error); }); }
    catch (error) { finish(error as Error); }
  });
}

export function verificationGroupsGone(groups: readonly number[]): boolean {
  return groups.every(pid => {
    try { process.kill(-pid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
  });
}

export function signalVerificationGroups(groups: readonly number[], signal: NodeJS.Signals): void {
  for (const pid of groups) {
    try { process.kill(-pid, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
}
