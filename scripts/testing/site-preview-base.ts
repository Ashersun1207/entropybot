export function configureSitePreviewBase(): void {
  const base = new URLSearchParams(location.search).get("siteBase");
  if (!base || !/^\/preview\/[a-zA-Z0-9-]{24,80}\/$/.test(base)) return;
  const rewrite = (input: string | URL) => {
    const url = new URL(input, location.href);
    if (url.origin === location.origin && (/^\/api(?:\/|$)/.test(url.pathname) || url.pathname === "/.well-known/entropybot/environment")) {
      url.pathname = base + url.pathname.slice(1);
    }
    return url.href;
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => originalFetch(input instanceof Request ? new Request(rewrite(input.url), input) : rewrite(input), init);
  const OriginalEventSource = window.EventSource;
  window.EventSource = class extends OriginalEventSource {
    constructor(url: string | URL, init?: EventSourceInit) { super(rewrite(url), init); }
  };
}
