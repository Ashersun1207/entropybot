export const WINDOW_TIMEOUT_MS = 90000;

export const TEXT_REGION_SCRIPT = `(async () => {
  const deadline = Date.now() + 20000;
  while (!document.querySelector('[data-sidebar-bot-row], [data-sidebar-hero]')) {
    if (Date.now() >= deadline) throw new Error('application sidebar never mounted');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await Promise.all([...document.images].map(image => image.complete ? null : new Promise(resolve => { image.onload = image.onerror = resolve; })));
  if (!window.ogb?.getCapabilities) throw new Error('desktop preload missing');
  const capabilities = await window.ogb.getCapabilities();
  const walker = document.createTreeWalker(document.getElementById('root'), NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    if (node.textContent.trim().length < 4 || node.parentElement.closest('script,style')) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const r = range.getBoundingClientRect(); const style = getComputedStyle(node.parentElement);
    if (r.x < 0 || r.y < 0 || r.right > innerWidth || r.bottom > innerHeight || r.width < 24 || r.width > 300 || r.height < 8 || r.height > 60 || style.visibility !== 'visible' || Number(style.opacity) === 0) continue;
    return { location: location.href, bridge: typeof window.ogb.getCapabilities, platform: capabilities.host?.platform,
      region: { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) } };
  }
  throw new Error('no bounded visible app text region');
})()`;

export function observeApplicationWindow(app, { onWindow, timeoutMs = WINDOW_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    let selected = false, settled = false;
    const timer = setTimeout(() => finish(new Error("application window never became ready")), timeoutMs);
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      app.removeListener("browser-window-created", created);
      if (error) reject(error); else resolve(value);
    }
    function created(_event, win) {
      if (selected || !win.webContents.getLastWebPreferences().preload?.endsWith("/electron/preload.cjs")) return;
      selected = true;
      let ready = false, loaded = false, checking = false;
      const check = () => {
        if (settled || !ready || !loaded || checking) return;
        checking = true;
        Promise.resolve().then(() => onWindow(win)).then(value => finish(null, { readyToShow: ready, didFinishLoad: loaded, ...value }), error => finish(error));
      };
      win.once("ready-to-show", () => { ready = true; check(); });
      win.webContents.once("did-finish-load", () => { loaded = true; check(); });
      win.webContents.once("render-process-gone", () => finish(new Error("application renderer exited")));
      win.webContents.on("did-fail-load", (_event, code, _description, _url, main) => {
        if (main && code !== -3) finish(new Error("application main frame failed to load"));
      });
    }
    app.on("browser-window-created", created);
  });
}
