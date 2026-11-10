import { connectCdp, type Cdp } from "./browser-sites.ts";

export interface NavigationStop {
  stop(): Promise<boolean>;
  close(): void;
}

export class BrowserNavigationCancelled extends Error {}

/** targetId must come from the legacy engine's pinned active tab, never a page URL. */
export async function prepareNavigationStop(cdpUrl: string, targetId: string, current: () => boolean, connect: typeof connectCdp = connectCdp): Promise<NavigationStop | null> {
  let cdp: Cdp | undefined;
  try {
    if (!targetId) return null;
    cdp = await connect(cdpUrl, 1500);
    const result = await cdp.send("Target.getTargets");
    const targets = Array.isArray(result.targetInfos) ? result.targetInfos as Array<{ type?: string; targetId?: string }> : [];
    if (targets.length > 1024 || targets.filter(target => target.type === "page" && target.targetId === targetId).length !== 1) { cdp.close();return null; }
    const attached = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    if (typeof attached.sessionId !== "string") { cdp.close();return null; }
    const sessionId = attached.sessionId;
    const connection = cdp;
    let stopped: Promise<boolean> | undefined;
    let closed = false;
    const stop = async () => {
      if (closed || !current()) return false;
      try {
        await connection.send("Page.stopLoading", {}, sessionId);
        // The original RPC, budget or takeover may have invalidated this operation during the acknowledgement.
        if (closed || !current()) return false;
        const answer = await connection.send("Page.navigate", { url: "about:blank" }, sessionId);
        return typeof answer.errorText !== "string" && typeof answer.frameId === "string" && !answer.isDownload;
      } catch { return false; }
    };
    return {
      stop: () => stopped ??= stop(),
      close: () => { closed = true;connection.close(); },
    };
  } catch { cdp?.close();return null; }
}

async function answeredWithin(work: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work.then(() => true, () => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

export async function withNavigationCancellation<T>(signal: AbortSignal | undefined, prepare: ((current: () => boolean) => Promise<NavigationStop | null>) | undefined, work: () => Promise<T>, uncertain: () => void, permitted: () => boolean = () => true): Promise<T> {
  signal?.throwIfAborted();
  if (!signal || !prepare) return work();
  let active = true, dispatched = false, settled = false;
  const target = await prepare(() => active && dispatched && !settled && permitted());
  let stopping: Promise<boolean> | undefined;
  let rejectCancellation!: (reason: unknown) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const abort = () => {
    if (dispatched) stopping = target ? Promise.resolve().then(() => target.stop()).catch(() => false) : Promise.resolve(false);
    rejectCancellation(new BrowserNavigationCancelled("Browser navigation was interrupted; an already dispatched request may have reached the site."));
  };
  signal.addEventListener("abort", abort, { once: true });
  let running: Promise<T> | undefined;
  try {
    signal.throwIfAborted();
    dispatched = true;
    running = work().finally(() => { settled = true; });
    const result = await Promise.race([running, cancelled]);
    signal.throwIfAborted();
    return result;
  } catch (error) {
    if (signal.aborted && dispatched) {
      const stopAnswered = stopping ? await answeredWithin(stopping, 1500) : false;
      const stopped = stopAnswered && stopping ? await stopping : false;
      const answered = stopped && running ? await answeredWithin(running, 1000) : false;
      if (!stopped || !answered) {
        uncertain();
        throw new BrowserNavigationCancelled("Browser navigation cancellation could not be confirmed; inspect the interrupted browser before another action.");
      }
      throw new BrowserNavigationCancelled("Browser navigation was interrupted; an already dispatched request may have reached the site.");
    }
    throw error;
  } finally {
    active = false;
    signal.removeEventListener("abort", abort);
    target?.close();
  }
}
