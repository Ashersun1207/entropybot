import { useEffect, useRef, useState } from "react";
import {
  ArrowUp, BookOpen, Check, ChevronDown, CircleHelp, Command, Hash, MemoryStick,
  MoreHorizontal, Paperclip, Plus, Search, Settings2, Sparkles, Users,
} from "lucide-react";

type View = "chat" | "memory" | "settings";
type Role = "user" | "bot";
type Message = { id: string; role: Role; text: string; at: string; tool?: string };
type Bot = {
  id: string; name: string; role: string; color: "green" | "blue" | "purple" | "orange";
  preview: string; messages: Message[];
};

function Avatar({ color, label, size = 30 }: { color: Bot["color"]; label: string; size?: number }) {
  return <span className={`demo-avatar demo-avatar-${color}`} style={{ width: size, height: size }} title={label} aria-label={label} role="img">{label.slice(0, 1)}</span>;
}

const BOTS: Bot[] = [
  {
    id: "cocoa", name: "Cocoa", role: "chief of staff", color: "blue",
    preview: "把发布前的检查收个尾。",
    messages: [
      { id: "c1", role: "user", text: "帮我看看 0.2.6 还差什么。", at: "09:12" },
      { id: "c2", role: "bot", text: "还差三件事：安装事务的 B 部分复审、CI 把离线检查接上、以及正式签名。\n\n我先从 B 的两个缺口开始，不碰你正在用的应用。", at: "09:12" },
      { id: "c3", role: "bot", text: "已检查安装脚本：71 项合成测试通过，但 NaN timeout 和 3 个 journal 标记还需要补。", at: "09:13", tool: "检查安装脚本 · 2 个缺口" },
      { id: "c4", role: "user", text: "先不要安装，等复审。", at: "09:14" },
      { id: "c5", role: "bot", text: "明白。真实 preflight/apply 保持禁止，当前应用和数据不动。", at: "09:14" },
    ],
  },
  {
    id: "ziggy", name: "Ziggy", role: "builder", color: "purple",
    preview: "网页演示可以复用真实组件。",
    messages: [
      { id: "z1", role: "user", text: "网站能不能做得像应用一样能点？", at: "09:21" },
      { id: "z2", role: "bot", text: "可以。首页继续轻量静态，另做一个 /demo：复用主题、头像和交互样式，用合成数据，不接模型。", at: "09:21" },
      { id: "z3", role: "bot", text: "先做聊天、侧栏、记忆三个界面；跑通后再看体积和移动端。", at: "09:22" },
    ],
  },
  {
    id: "echo", name: "Echo", role: "researcher", color: "orange",
    preview: "上游更新先固定版本，再小批采纳。",
    messages: [
      { id: "e1", role: "user", text: "上游更新怎么跟？", at: "09:30" },
      { id: "e2", role: "bot", text: "固定 SHA，分类安全/可靠性/功能，小批适配，行为等价后再删本地重复补丁。编译通过不算验收。", at: "09:30" },
    ],
  },
];

const REPLIES: Record<string, string> = {
  cocoa: "收到。我会先给结论，再列需要你确认的边界；不会自动安装、推送或发布。",
  ziggy: "可以，先做一个最小可点版本。我会记录构建体积和首屏时间，再决定要不要扩展。",
  echo: "这个判断需要固定版本和实际证据。没有同条件对比，我不会给性能或可靠性排名。",
};

const MEMORY = [
  { when: "今天 09:14", title: "安装前必须复审", body: "真实 preflight/apply 在 B 两项缺口关闭并独立复审前禁止。", source: "对话 · Cocoa" },
  { when: "今天 09:22", title: "网站演示边界", body: "公开 demo 只使用合成数据，不接真实模型、账号或记忆。", source: "对话 · Ziggy" },
  { when: "周二", title: "发布签名", body: "当前 macOS 候选是 ad-hoc，未公证；没有证书不冒充正式发布。", source: "发布记录" },
];

const clock = () => new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

export function Demo() {
  const [view, setView] = useState<View>(() => {
    const requested = new URLSearchParams(location.search).get("view");
    return requested === "memory" || requested === "settings" ? requested : "chat";
  });
  const [activeId, setActiveId] = useState("cocoa");
  const [theme, setTheme] = useState<"midnight" | "daylight">(() => {
    try { return localStorage.getItem("entropybot-demo-theme") === "daylight" ? "daylight" : "midnight"; } catch { return "midnight"; }
  });
  const [bots, setBots] = useState(BOTS);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [notice, setNotice] = useState<string | null>("演示模式：所有对话、记忆和数字都是合成数据，不会连接模型或你的账号。");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const active = bots.find((bot) => bot.id === activeId) ?? bots[0]!;

  useEffect(() => {
    document.documentElement.dataset.skin = theme;
    try { localStorage.setItem("entropybot-demo-theme", theme); } catch {}
  }, [theme]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); }, [active.messages.length, typing, view]);

  const choose = (id: string) => { setActiveId(id); setView("chat"); setDraft(""); };
  const send = () => {
    const text = draft.trim();
    if (!text || typing) return;
    setDraft("");
    setBots((rows) => rows.map((bot) => bot.id === active.id ? {
      ...bot,
      preview: text,
      messages: [...bot.messages, { id: `u-${Date.now()}`, role: "user", text, at: clock() }],
    } : bot));
    setTyping(true);
    timer.current = setTimeout(() => {
      setBots((rows) => rows.map((bot) => bot.id === active.id ? {
        ...bot,
        messages: [...bot.messages, { id: `b-${Date.now()}`, role: "bot", text: REPLIES[bot.id] ?? "这是演示回复。", at: clock() }],
      } : bot));
      setTyping(false);
    }, 700);
  };

  return (
    <div className="demo-app" data-skin={theme}>
      <aside className="demo-rail" aria-label="演示侧栏">
        <div className="demo-brand">
          <img src="./app-icon.png" alt="" width="28" height="28" />
          <span>Entropybot</span>
          <span className="demo-pill">DEMO</span>
        </div>
        <div className="demo-search"><Search size={14} /><span>搜索对话</span><kbd>⌘K</kbd></div>
        <nav className="demo-nav" aria-label="演示页面">
          <button className={view === "chat" ? "is-on" : ""} onClick={() => setView("chat")}><Hash size={15} />对话</button>
          <button className={view === "memory" ? "is-on" : ""} onClick={() => setView("memory")}><MemoryStick size={15} />记忆</button>
          <button className={view === "settings" ? "is-on" : ""} onClick={() => setView("settings")}><Settings2 size={15} />设置</button>
        </nav>
        <div className="demo-section"><span>你的机器人</span><button aria-label="新建机器人"><Plus size={14} /></button></div>
        <div className="demo-bots">
          {bots.map((bot) => (
            <button key={bot.id} className={bot.id === activeId && view === "chat" ? "demo-bot is-on" : "demo-bot"} onClick={() => choose(bot.id)}>
              <Avatar color={bot.color} label={bot.name} />
              <span className="demo-bot-copy"><strong>{bot.name}</strong><small>{bot.preview}</small></span>
              <time>{bot.id === "cocoa" ? "09:14" : bot.id === "ziggy" ? "09:22" : "09:30"}</time>
            </button>
          ))}
        </div>
        <div className="demo-side-foot">
          <span><Users size={13} />合成数据</span>
          <span className="demo-status"><i />本地演示</span>
        </div>
      </aside>

      <main className="demo-panel">
        {notice && (
          <div className="demo-notice" role="status">
            <Sparkles size={15} /><span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="关闭演示说明">×</button>
          </div>
        )}
        {view === "chat" && (
          <section className="demo-chat" aria-label={`与 ${active.name} 的演示对话`}>
            <header className="demo-head">
              <Avatar color={active.color} label={active.name} size={34} />
              <div><h1>{active.name}</h1><p>{active.role} · <span className="demo-dot" />在线</p></div>
              <button className="demo-model">Claude Sonnet <ChevronDown size={12} /></button>
              <button className="demo-icon" aria-label="更多"><MoreHorizontal size={17} /></button>
            </header>
            <div className="demo-thread" ref={scroll} aria-live="polite">
              <div className="demo-day">今天</div>
              {active.messages.map((message) => (
                <div key={message.id} className={message.role === "user" ? "demo-row is-user" : "demo-row"}>
                  {message.role === "bot" && <Avatar color={active.color} label={active.name} size={28} />}
                  <div className="demo-message">
                    {message.tool && <div className="demo-tool"><Search size={13} />{message.tool}<Check size={13} /></div>}
                    <p>{message.text}</p>
                    <time>{message.at}</time>
                  </div>
                </div>
              ))}
              {typing && <div className="demo-row"><Avatar color={active.color} label={active.name} size={28} /><div className="demo-message demo-typing"><span className="demo-dots" aria-label="正在输入"><i /><i /><i /></span></div></div>}
            </div>
            <div className="demo-composer">
              <button className="demo-icon" aria-label="添加附件"><Paperclip size={17} /></button>
              <textarea
                id="demo-composer"
                name="demo-message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }}
                placeholder={`给 ${active.name} 发消息`}
                rows={1}
                aria-label={`给 ${active.name} 发消息`}
              />
              <button className="demo-send" onClick={send} disabled={!draft.trim() || typing} aria-label="发送"><ArrowUp size={17} /></button>
              <div className="demo-composer-foot"><span><Command size={11} /> Enter 发送</span><span>演示不会调用模型</span></div>
            </div>
          </section>
        )}

        {view === "memory" && (
          <section className="demo-page" aria-label="记忆演示">
            <header className="demo-page-head"><div><p>设置 · 记忆</p><h1>记忆</h1></div><button className="demo-model"><BookOpen size={14} />查看原文</button></header>
            <p className="demo-lede">这里展示机器人记住的事实、来源和有效时间。演示数据不会写入真实记忆。</p>
            <div className="demo-memory">
              {MEMORY.map((item) => (
                <article key={item.title} className="demo-memory-card">
                  <div><span className="demo-tag">{item.when}</span><span className="demo-tag">{item.source}</span></div>
                  <h2>{item.title}</h2><p>{item.body}</p>
                </article>
              ))}
            </div>
            <div className="demo-empty"><CircleHelp size={18} /><span>真实应用里，记忆可以在每次对话后自动整理，也可以手动纠正或删除。</span></div>
          </section>
        )}

        {view === "settings" && (
          <section className="demo-page" aria-label="设置演示">
            <header className="demo-page-head"><div><p>设置</p><h1>外观与演示</h1></div></header>
            <div className="demo-settings">
              <div className="demo-setting"><div><strong>界面主题</strong><span>和应用一样，演示也支持深色与浅色。</span></div>
                <div className="demo-segment"><button className={theme === "midnight" ? "is-on" : ""} onClick={() => setTheme("midnight")}>深色</button><button className={theme === "daylight" ? "is-on" : ""} onClick={() => setTheme("daylight")}>浅色</button></div>
              </div>
              <div className="demo-setting"><div><strong>模型</strong><span>演示只显示模型选择，不会发送请求。</span></div><span className="demo-value">Claude Sonnet</span></div>
              <div className="demo-setting"><div><strong>数据</strong><span>所有内容均为合成数据，不读取你的聊天、记忆或凭证。</span></div><span className="demo-value">仅演示</span></div>
              <div className="demo-setting"><div><strong>安装与发布</strong><span>0.2.6 本地候选尚未公开发布；本机安装仍需单独验收。</span></div><span className="demo-value">未发布</span></div>
            </div>
            <div className="demo-empty"><Check size={18} /><span>这个页面用于体验交互与视觉，不是完整应用，也不替代真实安装。</span></div>
          </section>
        )}
      </main>
    </div>
  );
}
