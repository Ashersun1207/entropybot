(() => {
  const channel = 'entropybot.site.v1';
  const frame = document.querySelector('.product-experience');
  const surface = document.querySelector('.app-frame');
  const stateTitle = document.querySelector('.workspace-state-title');
  const stateText = document.querySelector('.workspace-state-text');
  const retry = document.querySelector('.workspace-retry');
  const health = document.querySelector('.workspace-health');
  const roleFeedback = document.querySelector('.role-feedback');
  const playback = document.querySelector('.workspace-playback');
  let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const setPlayback = value => {
    playing = value;
    playback.setAttribute('aria-pressed', String(playing));
    playback.textContent = playing ? '暂停演示' : '循环播放';
  };
  setPlayback(playing);
  const mobile = matchMedia('(max-width: 640px)');
  let composerFocused = false;
  const fitWorkspace = () => {
    if (!mobile.matches) { frame.style.removeProperty('height'); return; }
    const viewport = window.visualViewport;
    if (viewport && Math.abs(viewport.scale - 1) > 0.05) return;
    const top = document.querySelector('.site-header').getBoundingClientRect().height + 18;
    const previousHeight = frame.getBoundingClientRect().height;
    const height = Math.min(620, Math.max(180, (viewport?.height ?? innerHeight) - top - 16));
    frame.style.height = `${height}px`;
    if (composerFocused && height < previousHeight - 1) document.querySelector('#workspace').scrollIntoView({ block: 'start', behavior: 'instant' });
  };
  const tabs = [...document.querySelectorAll('[data-role]')];
  const roleNames = { research: '资料助手', project: '项目助手', personal: '个人助理' };
  const commands = new Map();
  let origin = null;
  let session = '';
  let attempt = 0;
  let ready = false;
  let loadingTimer;
  let wantedRole = null;
  let pendingExample = null;
  let focusComposer = false;
  let skin = document.documentElement.dataset.theme === 'light' ? 'daylight' : 'midnight';

  const setState = state => {
    surface.dataset.state = state;
    surface.setAttribute('aria-busy', String(state === 'loading'));
    frame.tabIndex = state === 'ready' ? 0 : -1;
    retry.hidden = state !== 'error';
    stateTitle.textContent = state === 'error' ? '工作区暂时未连接' : '正在准备你的工作区';
    stateText.textContent = state === 'error' ? '连接没有完成，请重试。示例对话准备好后就能继续操作。' : '正在加载助手和示例对话，稍后即可输入。';
  };
  const clearCommands = () => {
    for (const command of commands.values()) clearTimeout(command.timer);
    commands.clear();
  };
  const fail = () => {
    ready = false;
    clearTimeout(loadingTimer);
    clearCommands();
    setState('error');
    health.textContent = '工作区连接未完成，可以重试。';
    roleFeedback.textContent = '工作区暂时未连接，重新连接后可以继续切换助手。';
  };
  const post = data => {
    if (origin) frame.contentWindow?.postMessage({ channel, session, ...data }, origin);
  };
  const command = (type, values) => {
    if (!ready) return;
    clearTimeout(commands.get(type)?.timer);
    const id = crypto.randomUUID();
    commands.set(type, { id, timer: setTimeout(fail, 4000) });
    post({ type, id, ...values });
  };
  const showRole = role => {
    tabs.forEach(tab => {
      const selected = tab.dataset.role === role;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('.role-panel').forEach(panel => { panel.hidden = panel.id !== `panel-${role}`; });
  };
  const selectRole = (role, focus = false) => {
    if (!Object.hasOwn(roleNames, role)) return;
    pendingExample = null;
    clearTimeout(commands.get('example')?.timer);
    commands.delete('example');
    wantedRole = role;
    focusComposer = focus;
    showRole(role);
    health.textContent = ready ? `正在切换到${roleNames[role]}…` : `工作区准备好后将打开${roleNames[role]}。`;
    roleFeedback.textContent = health.textContent;
    command('select', { role, focus });
    if (focus) {
      document.querySelector('#workspace').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  };

  const startExample = (feature, choice) => {
    if (!['computer', 'teach', 'memory', 'team'].includes(feature)) return;
    if (choice !== undefined && !['按周五晚整理', '先保留待确认'].includes(choice)) return;
    pendingExample = { feature, ...(feature === 'computer' && choice ? { choice } : {}) };
    health.textContent = ready ? '正在准备示例草稿，请稍候…' : '工作区准备好后，将把示例放入输入框。';
    roleFeedback.textContent = health.textContent;
    command('example', pendingExample);
    document.querySelector('#workspace').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };

  async function connect() {
    const current = ++attempt;
    ready = false;
    origin = null;
    session = crypto.randomUUID();
    clearTimeout(loadingTimer);
    clearCommands();
    setState('loading');
    health.textContent = '正在连接可交互工作区…';
    try {
      const response = await fetch('/product/connection', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (current !== attempt) return;
      if (!response.ok) throw new Error('Connection unavailable');
      const config = await response.json();
      if (current !== attempt) return;
      const connectionOrigin = config.origin === 'self' ? location.origin : config.origin;
      const destination = new URL(connectionOrigin);
      if (!['http:', 'https:'].includes(destination.protocol) || destination.origin !== connectionOrigin) throw new Error('Invalid product origin');
      origin = destination.origin;
      loadingTimer = setTimeout(fail, 20000);
      frame.src = window.siteLanguage.url(`/product/?skin=${skin}&session=${session}`);
    } catch {
      if (current === attempt) fail();
    }
  }

  window.addEventListener('message', event => {
    if (!origin || event.origin !== origin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.channel !== channel || data.session !== session || surface.dataset.state === 'error') return;
    if (data.type === 'ready' && !ready) {
      ready = true;
      clearTimeout(loadingTimer);
      setState('ready');
      health.textContent = '工作区已就绪，可以输入文字或切换助手。';
      fitWorkspace();
      command('theme', { skin });
      if (pendingExample) command('example', pendingExample);
      else if (wantedRole) command('select', { role: wantedRole, focus: focusComposer });
    }
    if (data.type === 'applied') {
      const pending = commands.get(data.command);
      if (!pending || pending.id !== data.id) return;
      if (data.command === 'example' && !['draft-ready', 'draft-preserved'].includes(data.status)) return;
      if (data.command === 'playback' && typeof data.playing !== 'boolean') return;
      clearTimeout(pending.timer);
      commands.delete(data.command);
      if (data.command === 'playback') setPlayback(data.playing);
      if (data.command === 'example') {
        pendingExample = null;
        if (typeof data.role === 'string' && Object.hasOwn(roleNames, data.role)) { wantedRole = data.role; showRole(data.role); }
        health.textContent = data.status === 'draft-ready' ? '示例已放入输入框，可修改后按 Enter 发送。' : '当前草稿已保留。发送或清空后，再开始这个示例。';
        roleFeedback.textContent = health.textContent;
      }
      if (data.command === 'select' && data.role === wantedRole) {
        focusComposer = false;
        health.textContent = `当前助手：${roleNames[data.role]}。可以在工作区继续对话。`;
        roleFeedback.textContent = `已切换到${roleNames[data.role]}，点击下方对话按钮即可开始。`;
      }
    }
    if (data.type === 'rejected') {
      const pendingPlayback = commands.get('playback');
      if (pendingPlayback?.id === data.id) {
        clearTimeout(pendingPlayback.timer);
        commands.delete('playback');
        health.textContent = '当前无法开始循环：请先停止回复，或在新标签页重新体验。减少动画设置下不自动播放。';
      } else if ([...commands.values()].some(command => command.id === data.id)) fail();
    }
    if (data.type === 'selection' && !commands.has('select') && !commands.has('example') && typeof data.role === 'string' && Object.hasOwn(roleNames, data.role)) {
      wantedRole = data.role;
      showRole(data.role);
      health.textContent = `当前助手：${roleNames[data.role]}。可以在工作区继续对话。`;
      roleFeedback.textContent = `已切换到${roleNames[data.role]}，点击下方对话按钮即可开始。`;
    }
    if (data.type === 'playback-state' && typeof data.playing === 'boolean') setPlayback(data.playing);
    if (data.type === 'composer-focus' && typeof data.active === 'boolean') {
      composerFocused = data.active;
      fitWorkspace();
    }
  });
  frame.addEventListener('load', () => {
    if (ready) {
      ready = false;
      clearCommands();
      setState('loading');
      loadingTimer = setTimeout(fail, 20000);
    }
    post({ type: 'ping' });
  });
  retry.addEventListener('click', connect);
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectRole(tab.dataset.role));
    tab.addEventListener('keydown', event => {
      let next;
      if (['ArrowDown', 'ArrowRight'].includes(event.key)) next = tabs[(index + 1) % tabs.length];
      if (['ArrowUp', 'ArrowLeft'].includes(event.key)) next = tabs[(index + tabs.length - 1) % tabs.length];
      if (event.key === 'Home') next = tabs[0];
      if (event.key === 'End') next = tabs[tabs.length - 1];
      if (next) { event.preventDefault(); selectRole(next.dataset.role); next.focus(); }
    });
  });
  document.querySelectorAll('[data-chat-role]').forEach(button => {
    button.addEventListener('click', () => selectRole(button.dataset.chatRole, true));
  });
  playback.addEventListener('click', () => window.siteExperience.togglePlayback());
  const changeLanguage = () => { void connect(); };
  window.addEventListener('entropybot-language-change', changeLanguage);
  window.siteExperience = {
    startExample,
    togglePlayback() {
      if (!ready) return;
      const pending = commands.get('playback');
      const next = !(pending?.playing ?? playing);
      command('playback', { playing: next });
      commands.get('playback').playing = next;
    },
    setTheme(value) {
      if (value !== 'midnight' && value !== 'daylight') return;
      skin = value;
      command('theme', { skin });
    },
  };
  window.addEventListener('resize', fitWorkspace);
  window.visualViewport?.addEventListener('resize', fitWorkspace);
  fitWorkspace();
  window.addEventListener('pagehide', () => {
    clearTimeout(loadingTimer); clearCommands();
    window.removeEventListener('entropybot-language-change', changeLanguage);
    window.removeEventListener('resize', fitWorkspace);
    window.visualViewport?.removeEventListener('resize', fitWorkspace);
  });
  void connect();
})();
