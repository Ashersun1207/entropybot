import { realpathSync } from "node:fs";
import { installVerificationProcessScope, validVerificationIdentity } from "../../server/verification-process-scope.ts";

if (!process.send || !process.connected) throw new Error("Verification preload requires its creator's IPC channel");

await new Promise<void>((resolve, reject) => {
  const disconnect = () => { cleanup(); reject(new Error("Verification INIT channel disconnected")); };
  const cleanup = () => { clearTimeout(timer); process.removeListener("message", init); process.removeListener("disconnect", disconnect); };
  const timer = setTimeout(() => { cleanup(); reject(new Error("Verification INIT deadline exceeded")); }, 3_000);
  const init = (message: unknown) => {
    const frame = message as { type?: string; identity?: unknown };
    if (frame?.type !== "verification:init") return;
    try {
      if (!validVerificationIdentity(frame.identity) || frame.identity.dataDir !== realpathSync(process.env.OMB_DATA_DIR ?? "")
        || frame.identity.dataDir !== realpathSync(process.env.HOME ?? "")) throw new Error("Verification INIT identity/directory mismatch");
      const identity = frame.identity;
      const scope = installVerificationProcessScope(identity, (value, budgetMs) => new Promise<boolean>(done => {
        const deadline = setTimeout(() => done(false), budgetMs);
        try {
          if (!process.send || !process.connected) { clearTimeout(deadline); done(false); return; }
          process.send(value, error => { clearTimeout(deadline); done(!error); });
        } catch { clearTimeout(deadline); done(false); }
      }));
      process.on("message", (request: unknown) => {
        if ((request as { type?: string })?.type !== "verification:external-stop") return;
        process.send!({ type: "verification:inventory", identity, serverPid: process.pid, ...scope.externalStopInventory() });
      });
      process.send!({ type: "verification:ready", identity, serverPid: process.pid }, error => {
        cleanup();
        if (error) reject(error); else resolve();
      });
    } catch (error) { cleanup(); reject(error); }
  };
  process.on("message", init);
  process.once("disconnect", disconnect);
  process.send!({ type: "verification:awaiting-init", serverPid: process.pid }, error => {
    if (error) { cleanup(); reject(error); }
  });
});

for (let index = process.execArgv.length - 1; index >= 0; index--) {
  if (process.execArgv[index]?.includes("verification-server-preload.ts")) {
    if (index > 0 && process.execArgv[index - 1] === "--import") process.execArgv.splice(index - 1, 2);
    else process.execArgv.splice(index, 1);
  }
}
