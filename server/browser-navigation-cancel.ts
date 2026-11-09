import { connectCdp, type Cdp } from "./browser-sites.ts";

export interface NavigationStop {
  stop(): Promise<boolean>;
  close(): void;
}

export class BrowserNavigationCancelled extends Error {}

export async function prepareNavigationStop(cdpUrl: string, pageUrl: string, connect: typeof connectCdp = connectCdp): Promise<NavigationStop | null> {
  let cdp: Cdp | undefined;
  try {
    cdp = await connect(cdpUrl, 1500);
    const result = await cdp.send("Target.getTargets");
    const rawTargets = Array.isArray(result.targetInfos) ? result.targetInfos as Array<{ type?: string; url?: string; targetId?: string }> : [];
    if (rawTargets.length > MAX_PAGES) { cdp.close();return null; }
    const targets = rawTargets;
    const matching = targets.filter(target => target.type === "page" && target.url === pageUrl && typeof target.targetId === "string");
    if (matching.length !== 1) { cdp.close();return null; }
    const attached = await cdp.send("Target.attachToTarget", { targetId: matching[0]!.targetId, flatten: true });
    if (typeof attached.sessionId !== "string") { cdp.close();return null; }
    const sessionId = attached.sessionId;
    const connection = cdp;
    let stopped: Promise<boolean> | undefined;
    return { stop: () => stopped ??= connection.send("Page.stopLoading", {}, sessionId).then(() => true, () => false), close: () => connection.close() };
  } catch { cdp?.close();return null; }
}

const MAX_PAGES = 1024;

async function answeredWithin(work: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work.then(() => true, () => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

export async function withNavigationCancellation<T>(signal: AbortSignal, prepare: () => Promise<NavigationStop | null>, work: () => Promise<T>, uncertain: () => void): Promise<T> {
  signal.throwIfAborted();
  const target = await prepare();
  let dispatched = false;
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
    running = work();
    const result = await Promise.race([running, cancelled]);
    signal.throwIfAborted();
    return result;
  } catch (error) {
    if (signal.aborted && dispatched) {
      const stopped = stopping ? await stopping : false;
      const answered = stopped && running ? await answeredWithin(running, 1000) : false;
      if (!stopped || !answered) {
        uncertain();
        throw new BrowserNavigationCancelled("Browser navigation cancellation could not be confirmed; inspect the interrupted browser before another action.");
      }
      throw new BrowserNavigationCancelled("Browser navigation was interrupted; an already dispatched request may have reached the site.");
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    target?.close();
  }
}
