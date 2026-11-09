(() => {
  const frame = document.querySelector('.feature-experience');
  const container = document.querySelector('.features-container');
  const status = document.querySelector('.features-status');
  const retry = document.querySelector('.features-retry');
  let origin = null;
  let session = '';
  let ready = false;
  let timeout;
  let attempt = 0;
  let started = false;
  const theme = () => {
    if (!origin || !ready) return;
    frame.contentWindow?.postMessage({ channel: 'entropybot.site.v1', session, type: 'theme', skin: document.documentElement.dataset.theme === 'light' ? 'daylight' : 'midnight' }, origin);
  };
  const fail = () => {
    ready = false;
    container.setAttribute('aria-busy', 'false');
    status.hidden = false;
    status.textContent = '功能展示暂时未连接，请重新加载。';
    retry.hidden = false;
  };
  async function connect() {
    const current = ++attempt;
    session = crypto.randomUUID();
    ready = false;
    origin = null;
    retry.hidden = true;
    status.hidden = false;
    status.textContent = '正在准备四项功能的动态展示…';
    container.setAttribute('aria-busy', 'true');
    clearTimeout(timeout);
    try {
      const response = await fetch('/product/connection', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Unavailable');
      const config = await response.json();
      if (current !== attempt) return;
      const connectionOrigin = config.origin === 'self' ? location.origin : config.origin;
      const url = new URL(connectionOrigin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== connectionOrigin) throw new Error('Invalid origin');
      origin = url.origin;
      frame.loading = 'eager';
      frame.src = `/features/?skin=${document.documentElement.dataset.theme === 'light' ? 'daylight' : 'midnight'}&session=${session}&lang=${document.documentElement.lang === 'en' ? 'en' : 'zh-CN'}`;
    } catch {
      if (current === attempt) fail();
    }
  }
  window.addEventListener('message', event => {
    if (!origin || event.origin !== origin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.channel !== 'entropybot.site.v1' || data.session !== session) return;
    if (data.type === 'features-ready') {
      ready = true;
      clearTimeout(timeout);
      container.setAttribute('aria-busy', 'false');
      status.hidden = true;
      retry.hidden = true;
      theme();
    }
    if (data.type === 'feature-chat' && ['computer', 'teach', 'memory', 'team'].includes(data.feature)) {
      window.siteExperience.startExample(data.feature, data.choice);
    }
    if (data.type === 'features-size' && data.width === frame.clientWidth && Number.isFinite(data.height) && data.height >= 300 && data.height <= 6000) {
      frame.style.height = `${Math.ceil(data.height)}px`;
      container.dataset.layoutWidth = String(data.width);
    }
  });
  frame.addEventListener('load', () => {
    if (!ready && origin) timeout = setTimeout(fail, 15000);
  });
  retry.addEventListener('click', connect);
  const changeLanguage = () => { if (started) void connect(); };
  window.addEventListener('entropybot-language-change', changeLanguage);
  const themes = new MutationObserver(theme);
  themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const visibility = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    start();
  }, { rootMargin: '400px' });
  function start() {
    if (started) return;
    started = true;
    visibility.disconnect();
    void connect();
  }
  const hash = () => { if (location.hash === '#workflow') start(); };
  visibility.observe(container);
  window.addEventListener('hashchange', hash);
  hash();
  window.addEventListener('pagehide', () => { clearTimeout(timeout); themes.disconnect(); visibility.disconnect(); window.removeEventListener('hashchange', hash); window.removeEventListener('entropybot-language-change', changeLanguage); });
})();
