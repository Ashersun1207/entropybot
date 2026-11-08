import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import { BoundedJsonError } from "../lib/bounded-json";
import { fetchCollectionReport, COLLECTION_REPORT_RESPONSE_BYTES } from "../components/routines/collection-report-fetch";
const refused = vi.hoisted(() => vi.fn());
vi.mock('../lib/session-ended', () => ({noteRefusedRequest: refused}));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); refused.mockClear(); });

describe('bounded parsing through the existing API transport', () => {
  it('preserves request identity, credentials, desktop/auth headers and options without forwarding parser settings', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetcher);
    await expect(api('/api/synthetic', {responseByteLimit:32, headers:{authorization:'Bearer synthetic', 'x-entropybot-manual-context':'synthetic-context', 'x-desktop-trust':'synthetic'}, credentials:'include', cache:'no-store', signal:controller.signal})).resolves.toEqual({ok:true});
    const [path, init] = fetcher.mock.calls[0]; expect(path).toBe('/api/synthetic');
    expect(init).toMatchObject({credentials:'include',cache:'no-store',signal:controller.signal});
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer synthetic');
    expect(new Headers(init!.headers).get('x-entropybot-manual-context')).toBe('synthetic-context');
    expect(new Headers(init!.headers).get('x-desktop-trust')).toBe('synthetic');
    expect(init).not.toHaveProperty('responseByteLimit');
  });
  it('retains the ordinary JSON parser and malformed-body fallback for unrelated calls', async () => {
    const first=new Response('{"ordinary":true}'), second=new Response('not JSON');
    const parse=vi.spyOn(first,'json'); vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second));
    expect(await api('/api/ordinary')).toEqual({ordinary:true}); expect(parse).toHaveBeenCalledOnce();
    expect(await api('/api/ordinary')).toEqual({});
  });
  it.each([401,403,404,409])('keeps HTTP %s status and fixed error codes after bounded parsing',async status=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({code:'collection_report_unavailable',error:'Synthetic refused'}),{status})));
    await expect(api('/api/synthetic',{responseByteLimit:128})).rejects.toMatchObject({status,body:{code:'collection_report_unavailable'}});
    expect(refused).toHaveBeenCalledTimes(status===401||status===403?1:0);
  });
  it('retains refusal handling even when the refused response body is oversized',async()=>{
    const response=new Response('oversized synthetic body',{status:403}); const parse=vi.spyOn(response,'json');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
    await expect(api('/api/synthetic',{responseByteLimit:4})).rejects.toBeInstanceOf(ApiError);
    expect(refused).toHaveBeenCalledOnce(); expect(parse).not.toHaveBeenCalled();
  });
  it('propagates a successful-response size rejection without invoking the generic JSON parser',async()=>{
    const response=new Response('oversized synthetic body'); const parse=vi.spyOn(response,'json');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
    await expect(api('/api/synthetic',{responseByteLimit:4})).rejects.toBeInstanceOf(BoundedJsonError);
    expect(parse).not.toHaveBeenCalled();
  });
  it('applies the report timeout to body reading as well as fetch and cancels pending reads',async()=>{
    const timeout=new AbortController(), caller=new AbortController();
    const timer=vi.spyOn(AbortSignal,'timeout').mockReturnValue(timeout.signal);
    const cancel=vi.fn(); const stream=new ReadableStream<Uint8Array>({pull(){return new Promise<void>(()=>{});},cancel});
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)); vi.stubGlobal('fetch',fetcher);
    const result=fetchCollectionReport('routine/fixture','run/fixture',caller.signal);
    await Promise.resolve();
    timeout.abort(new DOMException('Synthetic timeout','TimeoutError'));
    await expect(result).rejects.toMatchObject({name:'TimeoutError'});
    expect(fetcher.mock.calls[0][0]).toBe('/api/routines/routine%2Ffixture/runs/run%2Ffixture/collection-report');
    expect(timer).toHaveBeenCalledWith(15_000); expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false);
    expect(caller.signal.aborted).toBe(false);
  });
  it('never shares a hidden-page unbounded response with a bounded caller',async()=>{
    const listeners=new Set<()=>void>();
    const page={visibilityState:'hidden',addEventListener:(_type:string,listener:()=>void)=>listeners.add(listener),removeEventListener:(_type:string,listener:()=>void)=>listeners.delete(listener)};
    vi.stubGlobal('document',page);
    const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(new Response('{"value":true}'))); vi.stubGlobal('fetch',fetcher);
    const ordinary=api('/api/synthetic',{background:true});
    const bounded=api('/api/synthetic',{background:true,responseByteLimit:4});
    expect(fetcher).not.toHaveBeenCalled();
    const results=Promise.allSettled([ordinary,bounded]);
    page.visibilityState='visible'; for(const listener of listeners) listener();
    const [first,second]=await results;
    expect(first).toEqual({status:'fulfilled',value:{value:true}});
    expect(second.status).toBe('rejected'); expect(fetcher).toHaveBeenCalledTimes(2); expect(listeners.size).toBe(0);
  });
  it('uses a fixed supported report ceiling and refuses the declared excess before parsing',async()=>{
    expect(COLLECTION_REPORT_RESPONSE_BYTES).toBe(62_000_000);
    const response=new Response('{}',{headers:{'content-length':String(COLLECTION_REPORT_RESPONSE_BYTES+1)}});
    const parse=vi.spyOn(JSON,'parse'); vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
    await expect(fetchCollectionReport('r','run',new AbortController().signal)).rejects.toBeInstanceOf(BoundedJsonError);
    expect(parse).not.toHaveBeenCalled();
  });
});
