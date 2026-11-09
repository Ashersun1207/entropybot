(() => {
  const root = document.documentElement;
  const copy = new Map([
    ['Entropybot — 你的 AI 助手团队', 'Entropybot — Your team of AI assistants'],
    ['Entropybot，本机优先的 AI 助手工作区。在桌面上整理资料、管理记忆、推进任务，按你的选择连接模型。适用于 macOS Apple silicon。', 'Entropybot, a local-first AI workspace. Organize information, manage memories and move tasks forward on your desktop, with models you choose. For macOS on Apple silicon.'],
    ['你的资料、记忆与下一步，在同一个桌面工作区。', 'Your information, memories and next steps, together in one desktop workspace.'],
    ['跳到主要内容', 'Skip to main content'],
    ['主导航', 'Main navigation'],
    ['页面语言', 'Page language'],
    ['暂停演示', 'Pause demo'],
    ['循环播放', 'Play on repeat'],
    ['当前无法开始循环：请先停止回复，或在新标签页重新体验。减少动画设置下不自动播放。', 'Cannot start the loop now. Stop the current reply or try a new tab. Autoplay is off when reduced motion is enabled.'],
    ['Entropybot 首页', 'Entropybot home'],
    ['展开菜单', 'Open menu'],
    ['收起菜单', 'Close menu'],
    ['菜单', 'Menu'],
    ['产品', 'Product'],
    ['工作方式', 'How it works'],
    ['下载', 'Download'],
    ['Entropybot 已上线', 'Entropybot is available'],
    ['查看发布说明', 'Read release notes'],
    ['认识', 'Meet'],
    ['可以交付真实工作的 AI 助手。', 'AI assistants that get real work done.'],
    ['整理你的资料，记住你的偏好，推进任务，做完再回来找你。', 'Organize your information, remember your preferences and move tasks forward. Come back with the work done.'],
    ['下载 macOS 版', 'Download for macOS'],
    ['了解工作方式', 'See how it works'],
    ['Apple silicon · 公开版 0.2.3 · ad-hoc 签名，未经公证', 'Apple silicon · Public release 0.2.3 · Ad-hoc signed, not notarized'],
    ['你的桌面，你的工作区。', 'Your desktop. Your workspace.'],
    ['Entropybot 可交互工作区，使用合成数据与示例回复', 'Interactive Entropybot workspace with synthetic data and example replies'],
    ['正在准备你的工作区', 'Preparing your workspace'],
    ['正在加载助手和示例对话，稍后即可输入。', 'Loading assistants and example conversations. You can start typing shortly.'],
    ['重新连接', 'Reconnect'],
    ['正在连接可交互工作区…', 'Connecting to the interactive workspace…'],
    ['查看产品截图 ↗', 'View product screenshot ↗'],
    ['试试“核对日期”或“准备清单”。合成数据与示例回复，不连接真实模型或执行外部任务。', 'Try “check the dates” or “make a checklist.” Synthetic data and example replies; no live model connection or external tasks.'],
    ['像同事一样，一起做事', 'Work together, like colleagues'],
    ['让多个助手，', 'Bring your assistants together.'],
    ['一起把事情做完。', 'Get the work done.'],
    ['一个核对资料，一个安排下一步。用你的工具，沿着确认过的方法，带着必要背景继续协作。', 'One checks the information; another plans what comes next. Collaborate with your tools, proven steps and the context that matters.'],
    ['正在准备四项功能的动态展示…', 'Preparing four interactive feature examples…'],
    ['重新加载功能展示', 'Reload feature examples'],
    ['工具使用、步骤复用、偏好记忆与助手协作：真实产品组件的合成动态展示', 'Tool use, reusable steps, preference memory and teamwork: synthetic examples using real product components'],
    ['各有分工，一起向前', 'Different roles, shared progress'],
    ['给每个助手，', 'Give each assistant'],
    ['一件专注的事。', 'a clear focus.'],
    ['一个整理资料，一个梳理计划，一个记住你的偏好。用你熟悉的对话，组织自己的工作区。', 'One organizes information, another builds a plan, and another remembers your preferences. Shape your workspace through familiar conversations.'],
    ['助手职责', 'Assistant roles'],
    ['资料助手', 'Research assistant'],
    ['项目助手', 'Project assistant'],
    ['个人助理', 'Personal assistant'],
    ['选择一个职责，就能切换上方工作区里的助手。', 'Choose a role to switch assistants in the workspace above.'],
    ['从资料里，', 'Find the next lead'],
    ['找到下一条线索。', 'in your information.'],
    ['对照活动说明与场地备注，把差异和待确认事项列清楚。先确认日期，再安排下一步。', 'Compare the event brief with the venue notes. List discrepancies and open questions. Confirm the date, then plan the next step.'],
    ['你可以这样开始', 'Start with this'],
    ['两份读书会资料的日期不一致，帮我核对一下。', 'These two book club documents have different dates. Help me check them.'],
    ['把结论、依据和待确认事项放在一起。', 'Keep findings, sources and open questions together.'],
    ['与资料助手对话 ↑', 'Chat with the research assistant ↑'],
    ['从一个目标，', 'Turn a goal'],
    ['拆到眼前这一步。', 'into the next step.'],
    ['把时间和边界说明白，先安排准备工作，再决定什么时候行动。', 'Set the timeline and boundaries. Plan the preparation, then decide when to act.'],
    ['周五办读书会，帮我整理准备清单。邀请先留作草稿。', 'Help me prepare a checklist for our book club on Friday. Keep the invitations as drafts.'],
    ['需要你确认的决定，先留在计划里。', 'Keep decisions that need your approval in the plan.'],
    ['与项目助手对话 ↑', 'Chat with the project assistant ↑'],
    ['新的偏好，', 'Carry new preferences'],
    ['接上下一次对话。', 'into the next conversation.'],
    ['把阅读习惯告诉助手：先看摘要，需要时再展开。偏好变了，就修订当前记忆。', 'Tell your assistant how you like to read: a summary first, details when needed. Update the current memory as your preferences change.'],
    ['以后整理读书会资料，先给一页摘要，需要时再展开。', 'When organizing book club documents, give me a one-page summary first, with details when needed.'],
    ['管理当前记忆，给变化留一个位置。', 'Manage current memories and leave room for change.'],
    ['与个人助理对话 ↑', 'Chat with the personal assistant ↑'],
    ['保留你的选择', 'Keep your choices'],
    ['在你的桌面。', 'On your desktop.'],
    ['按你的方式。', 'On your terms.'],
    ['本地工作区', 'A local workspace'],
    ['记忆与索引保存在本机。个人聊天、真实记忆和凭证不包含在公开仓库中。', 'Memories and indexes stay on your device. Personal chats, real memories and credentials are excluded from the public repository.'],
    ['模型由你连接', 'Connect models you choose'],
    ['选择适合任务的模型服务。使用远程模型或云端向量服务时，相关内容会发送到所选服务，并可能产生费用。', 'Choose the model service that fits the task. Remote models and cloud embedding services receive the relevant content and may charge fees.'],
    ['手动决定更新', 'Update when you decide'],
    ['当前应用只检查新版本，由你查看发布说明并手动下载、安装。', 'The app currently only checks for new versions. You review the release notes, then download and install updates manually.'],
    ['把下一件事，', 'Put your next task'],
    ['交给助手。', 'in capable hands.'],
    ['从你的 Mac 开始，建立自己的 AI 工作区。', 'Build your own AI workspace, starting on your Mac.'],
    ['公开版 0.2.3 · macOS Apple silicon', 'Public release 0.2.3 · macOS Apple silicon'],
    ['ad-hoc 签名，未经 Apple 公证 · 0.2.6 候选尚未公开发布', 'Ad-hoc signed, not notarized by Apple · The 0.2.6 candidate is not publicly released'],
    ['安装、备份与更新说明', 'Installation, backups and updates'],
    ['还有几个问题。', 'A few more questions.'],
    ['开始使用前，需要准备什么？', 'What do I need to get started?'],
    ['当前公开下载适用于 macOS Apple silicon。安装后需连接你选择的模型或执行引擎，具体服务可能收费。本地使用无需注册网站账号；更新前请退出应用并备份工作区与桌面配置。', 'The current public download supports macOS on Apple silicon. After installation, connect a model or execution engine of your choice; service fees may apply. Local use requires no website account. Before updating, quit the app and back up your workspace and desktop configuration.'],
    ['本地优先，意味着完全离线吗？', 'Does local-first mean fully offline?'],
    ['不意味着完全离线。记忆与索引保存在本机，但远程模型和云端 embedding 请求仍会发送到你配置的服务。数据处理范围和费用以所选服务为准。', 'Local-first does not mean fully offline. Memories and indexes stay on your device, but remote model and cloud embedding requests still go to the services you configure. Data processing and fees depend on those services.'],
    ['纠正一条记忆，会删除所有旧记录吗？', 'Does correcting a memory delete every old record?'],
    ['不会。修订当前记忆不等于删除聊天、摘要或备份里的全部副本。请按你要管理的数据范围分别查看与处理。', 'No. Updating a current memory does not delete every copy in chats, summaries or backups. Review and manage each type of data separately.'],
    ['截图里的界面，就是下载到的版本吗？', 'Will my download look exactly like the screenshots?'],
    ['页面使用真实应用界面与合成示例内容。界面和能力可能来自未发布候选；下载内容、可用平台和功能以公开 Releases 为准。目前公开版是 0.2.3，0.2.6 尚未公开发布。', 'This page uses the real app interface with synthetic examples. Some UI and capabilities may come from unreleased candidates. Public Releases define the available downloads, platforms and features. The current public version is 0.2.3; 0.2.6 is not publicly released.'],
    ['为什么 macOS 可能提示需要批准？', 'Why might macOS ask for approval?'],
    ['当前公开安装包采用 ad-hoc 签名，未经 Apple 公证。macOS可能要求在隐私与安全设置中批准，应用身份变化也可能触发权限提示。安装前请阅读发布说明；正式 Developer ID 签名与公证尚未完成。', 'The current public package is ad-hoc signed and not notarized by Apple. macOS may require approval in Privacy & Security, and app identity changes can trigger permission prompts. Read the release notes before installing. Developer ID signing and notarization are not yet complete.'],
    ['Entropybot 应用界面', 'Entropybot app interface'],
    ['真实应用截图 · 合成内容', 'Real app screenshot · Synthetic content'],
    ['放大细节', 'Zoom in'],
    ['适合窗口', 'Fit to window'],
    ['关闭', 'Close'],
    ['应用截图，放大后可滚动查看', 'App screenshot; scroll to explore after zooming in'],
    ['Entropybot 完整应用界面，使用合成内容', 'Full Entropybot app interface with synthetic content'],
    ['功能以公开版本为准。按 Escape 或点击画面外侧关闭。', 'Features depend on the public release. Press Escape or click outside the image to close.'],
    ['页面主题', 'Page theme'],
    ['浅色', 'Light'],
    ['深色', 'Dark'],
    ['跟随系统', 'System'],
    ['项目链接', 'Project links'],
    ['版本记录 ↗', 'Release history ↗'],
    ['Google 登录 Cloud ↗', 'Sign in to Cloud with Google ↗'],
    ['Entropybot 是基于 OpenMausBot 的独立开发分支，保留原作者归属与许可。enterprise/ 适用单独许可。', 'Entropybot is an independently developed fork of OpenMausBot, retaining the original attribution and license. A separate license applies to enterprise/.'],
    ['工作区暂时未连接', 'Workspace temporarily disconnected'],
    ['连接没有完成，请重试。示例对话准备好后就能继续操作。', 'The connection did not complete. Please retry; you can continue once the examples are ready.'],
    ['工作区连接未完成，可以重试。', 'The workspace connection did not complete. You can retry.'],
    ['工作区暂时未连接，重新连接后可以继续切换助手。', 'The workspace is temporarily disconnected. Reconnect to switch assistants.'],
    ['正在准备示例草稿，请稍候…', 'Preparing an example draft. Please wait…'],
    ['工作区准备好后，将把示例放入输入框。', 'The example will appear in the input field when the workspace is ready.'],
    ['工作区已就绪，可以输入文字或切换助手。', 'The workspace is ready. Type a message or switch assistants.'],
    ['示例已放入输入框，可修改后按 Enter 发送。', 'The example is in the input field. Edit it, then press Enter to send.'],
    ['当前草稿已保留。发送或清空后，再开始这个示例。', 'Your current draft is preserved. Send or clear it before starting this example.'],
    ['功能展示暂时未连接，请重新加载。', 'Feature examples are temporarily disconnected. Please reload.'],
  ]);
  const roles = ['资料助手', '项目助手', '个人助理'];
  for (const role of roles) {
    const name = copy.get(role);
    copy.set(`正在切换到${role}…`, `Switching to the ${name.toLowerCase()}…`);
    copy.set(`工作区准备好后将打开${role}。`, `The ${name.toLowerCase()} will open when the workspace is ready.`);
    copy.set(`当前助手：${role}。可以在工作区继续对话。`, `Current assistant: ${name.toLowerCase()}. Continue chatting in the workspace.`);
    copy.set(`已切换到${role}，点击下方对话按钮即可开始。`, `Switched to the ${name.toLowerCase()}. Use the chat button below to begin.`);
  }
  const originals = new Map([...copy].map(([zh, en]) => [en, zh]));
  const attributes = ['aria-label', 'alt', 'title', 'placeholder'];
  let language = 'zh';
  try { language = localStorage.getItem('entropybot-language') === 'en' ? 'en' : 'zh'; } catch {}
  const requested = new URLSearchParams(location.search).get('lang');
  if (requested === 'en' || requested === 'zh' || requested === 'zh-CN') language = requested === 'en' ? 'en' : 'zh';
  try { localStorage.setItem('entropybot-language', language); } catch {}
  const translate = value => {
    const trimmed = value.trim();
    const source = originals.get(trimmed) || trimmed;
    const translated = language === 'en' ? copy.get(source) : source;
    return translated ? value.replace(trimmed, translated) : value;
  };
  const translateText = node => {
    if (node.parentElement?.closest('script, style, svg, [data-language-choice]')) return;
    const value = translate(node.data);
    if (value !== node.data) node.data = value;
  };
  const translateElement = element => {
    for (const attribute of attributes) {
      if (!element.hasAttribute(attribute)) continue;
      const value = element.getAttribute(attribute);
      const translated = translate(value);
      if (value !== translated) element.setAttribute(attribute, translated);
    }
    if (element.matches('meta[name="description"], meta[property="og:title"], meta[property="og:description"]')) {
      const value = element.getAttribute('content');
      const translated = translate(value);
      if (value !== translated) element.setAttribute('content', translated);
    }
  };
  const refresh = (scope = document) => {
    if (scope.nodeType === Node.TEXT_NODE) { translateText(scope); return; }
    if (scope.nodeType === Node.ELEMENT_NODE) translateElement(scope);
    scope.querySelectorAll?.('*').forEach(translateElement);
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) translateText(walker.currentNode);
  };
  const apply = () => {
    root.lang = language === 'en' ? 'en' : 'zh-CN';
    root.dataset.language = language;
    document.querySelectorAll('[data-language-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.languageChoice === language));
    });
    refresh();
  };
  const setLanguage = value => {
    if (value !== 'en' && value !== 'zh') return;
    const changed = value !== language;
    language = value;
    try { localStorage.setItem('entropybot-language', language); } catch {}
    const url = new URL(location.href);
    url.searchParams.set('lang', language);
    try { history.replaceState(null, '', url); } catch {}
    apply();
    if (changed) window.dispatchEvent(new CustomEvent('entropybot-language-change', { detail: { language } }));
  };
  window.siteLanguage = {
    get language() { return language; },
    refresh: apply,
    setLanguage,
    url(value) {
      const url = new URL(value, location.href);
      if (url.origin === location.origin && /^\/(product|features)\//.test(url.pathname)) url.searchParams.set('lang', language);
      return `${url.pathname}${url.search}${url.hash}`;
    },
  };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(refresh);
      else if (record.type === 'characterData') translateText(record.target);
      else translateElement(record.target);
    }
  });
  observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...attributes, 'content'] });
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-language-choice]');
    if (button) setLanguage(button.dataset.languageChoice);
  });
  window.addEventListener('storage', event => {
    if (event.key === 'entropybot-language' || event.key === null) setLanguage(event.newValue === 'en' ? 'en' : 'zh');
  });
  apply();
})();
