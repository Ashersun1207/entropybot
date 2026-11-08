import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { GateCommandError, GateCommandRunner } from "../patch-gate-process.ts";

const request = JSON.parse(readFileSync(0, "utf8")) as {
  argv: string[]; cwd: string; env: Record<string, string>; timeoutMs: number; result: string;
};
const runner = new GateCommandRunner({
  commandTimeoutMs: request.timeoutMs,
  overallTimeoutMs: request.timeoutMs + 5_000,
  graceMs: 250,
  killWaitMs: 1_000,
});
let result: Record<string, unknown>;
try {
  const executed = await runner.run(request.argv[0]!, request.argv.slice(1), {
    cwd: request.cwd, env: request.env, forwardOutput: true,
  }, "receipt check");
  result = { status: "passed", exitCode: 0, signal: null, ownedGroupStopped: true, evidence: executed.evidence };
} catch (error) {
  if (error instanceof GateCommandError) {
    const exit = /exit code (null|-?\d+), signal (\S+)/.exec(error.message);
    const status = error.kind === "timeout" ? "timed_out" : error.kind === "cancelled" ? "cancelled" : error.kind === "exit" ? "failed" : "error";
    result = {
      status, exitCode: exit && exit[1] !== "null" ? Number(exit[1]) : null,
      signal: exit?.[2] === "none" ? null : exit?.[2] ?? null,
      ownedGroupStopped: error.ownedGroupStopped, kind: error.kind, evidence: error.evidence,
    };
  } else {
    result = { status: "error", exitCode: null, signal: null, ownedGroupStopped: false };
  }
} finally {
  await runner.close();
}
writeFileSync(`${request.result}.tmp`, `${JSON.stringify(result)}\n`, { mode: 0o600 });
renameSync(`${request.result}.tmp`, request.result);
