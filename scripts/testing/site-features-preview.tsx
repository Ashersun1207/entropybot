import { featureText } from "./site-feature-translations";
import { siteLanguage } from "./site-locale";
import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Monitor, Pause, Play, RotateCcw } from "lucide-react";
import { AskCard, AskChoices, AskDetail, AskHeader } from "../../src/components/AskCard";
import { BotAvatar } from "../../src/components/Avatar";
import { ToolActivity } from "../../src/components/ToolActivity";
import { RoutineRunCard } from "../../src/components/RoutineRunCard";
import { HandoffChip } from "../../src/components/HandoffReply";
import { Card } from "../../src/components/SettingsPrimitives";
import { setAnalyticsEnabled } from "../../src/lib/analytics";
import { setAdvancedMode } from "../../src/lib/interface-mode";
import { setLanguageChoice, loadPageLanguage } from "../../src/lib/language-preference";
import { wearSkin } from "../../src/lib/skins";
import type { Message } from "../../src/state/store";
import "../../src/styles.css";
import "./site-features.css";
import { configureSitePreviewBase } from "./site-preview-base";

configureSitePreviewBase();
setAnalyticsEnabled(false);
setAdvancedMode(false);
setLanguageChoice(siteLanguage);
await loadPageLanguage();
const params = new URLSearchParams(location.search);
wearSkin(params.get("skin") === "daylight" ? "daylight" : "midnight");
const parentOrigin = document.documentElement.dataset.siteDemo === "browser" ? location.origin : document.documentElement.dataset.siteParentOrigin ?? params.get("siteParentOrigin");
const session = params.get("session");
let connected = false;
try { connected = window.parent !== window && new URL(document.referrer).origin === parentOrigin; } catch {}
const post = (type: string, extra: Record<string, unknown> = {}) => {
  if (connected) window.parent.postMessage({ channel: "entropybot.site.v1", session, type, ...extra }, parentOrigin!);
};
window.addEventListener("message", event => {
  if (!connected || event.source !== window.parent || event.origin !== parentOrigin) return;
  const data = event.data;
  if (data?.channel !== "entropybot.site.v1" || data.session !== session) return;
  if (data.type === "theme" && (data.skin === "daylight" || data.skin === "midnight")) wearSkin(data.skin);
});

const research = { name: featureText("资料助手"), color: "green" as const };
const project = { name: featureText("项目助手"), color: "purple" as const };
const personal = { name: featureText("个人助理"), color: "cyan" as const };
const at = Date.UTC(2026, 10, 9, 2);
const tool = (label: string, done: boolean, output: string): NonNullable<Message["tool"]> => ({ name: label, label, ...(done ? { ok: true } : {}), input: featureText("合成示例资料"), output });
const timelines = {
  computer: [featureText("收到核对任务"), featureText("发现日期差异"), featureText("确认后继续"), featureText("返回清单与草稿")],
  teach: [featureText("第一次：说明方法"), featureText("留下可复用步骤"), featureText("第二次：复用方法"), featureText("返回新的整理结果")],
  memory: [featureText("已有阅读偏好"), featureText("收到新的纠正"), featureText("修订当前偏好"), featureText("按新偏好整理")],
  team: [featureText("资料助手核对"), featureText("交给项目助手"), featureText("个人助理补充"), featureText("汇总待确认项")],
} as const;
type Feature = keyof typeof timelines;

function Beat({ name, visible, children }: { name: string; visible: boolean; children: ReactNode }) {
  return <div className="story-beat" data-beat={name} data-revealed={visible} aria-hidden={!visible} inert={!visible}>{children}</div>;
}

function Computer({ step, choice, onPick }: { step: number; choice: string; onPick: (choice: string) => void }) {
  const deferred = choice === featureText("先保留待确认");
  return <div className="feature-native-stack">
    <AskDetail label={featureText("你的任务")} text={featureText("核对两份读书会资料，列准备清单；邀请先留作草稿。")} />
    <ToolActivity tool={tool(featureText("核对活动说明与场地备注"), step >= 1, featureText("活动说明：周五晚。场地备注：周六晚。需要确认日期。")) } live={step === 0} />
    <Beat name="date-question" visible={step >= 1}>
    <AskCard ariaLabel={featureText("核对日期的示例确认")} icon={<Monitor size={16} />} title={step < 2 ? featureText("两份资料的日期不一致") : choice === featureText("先保留待确认") ? featureText("日期保留为待确认") : featureText("以周五晚为准继续整理")}
      header={<AskHeader asker={research} line={step < 2 ? featureText("资料助手需要你确认") : featureText("资料助手 · 已收到你的选择")} />}
      explanation={featureText("活动说明写周五，场地备注写周六。以哪份为准？")}>
      <AskChoices label={featureText("示例活动日期")} choices={[{ label: featureText("按周五晚整理") }, { label: featureText("先保留待确认") }]} picked={step >= 2 ? [choice] : []} onPick={onPick} />
    </AskCard>
    </Beat>
    <Beat name="prepare" visible={step >= 2}><ToolActivity tool={tool(deferred ? featureText("整理不依赖日期的准备项") : featureText("按周五整理准备项"), step === 3, featureText("整理书目、讨论问题与邀请草稿，不发送邀请。"))} live={step === 2} /></Beat>
    <Beat name="result" visible={step === 3}><Card title={deferred ? featureText("准备清单已整理，日期待确认") : featureText("准备清单已整理，按周五安排")} subtitle={featureText("书目摘要、三个讨论问题、人数确认。邀请保留为草稿，等你决定。")} /></Beat>
  </div>;
}

function Teach({ step }: { step: number }) {
  const message: Message = { id: "feature-routine", role: "bot", kind: "routine.run", at,
    routineRun: { runId: "synthetic-run", routineId: "synthetic-routine", routineName: featureText("再次整理 · 新增场地备注"), status: step < 2 ? "queued" : step === 2 ? "running" : "completed",
      summary: step < 3 ? featureText("复用已确认的方法：对照、标差异、给摘要。") : featureText("发现人数从12人调整为16人，已列入新摘要。邀请仍保留为草稿。") } };
  return <div className="feature-native-stack">
    <AskCard ariaLabel={featureText("可复用步骤示例")} title={featureText("第一次，把方法说清楚")} header={<AskHeader asker={project} line={featureText("项目助手 · 跟着你的方法")} />}>
      <AskDetail text={featureText("1. 对照活动说明与场地备注\n2. 列出差异与待确认项\n3. 整理一页摘要，邀请留作草稿")} />
    </AskCard>
    <Beat name="method-saved" visible={step >= 1}><ToolActivity tool={tool(featureText("三个步骤已整理，下次沿用"), true, featureText("先对照，再列差异，最后给摘要。这是合成步骤记录。"))} /></Beat>
    <Beat name="second-request" visible={step >= 2}><AskDetail label={featureText("第二次任务")} text={featureText("又补了一份场地备注，按刚才的方法再整理一次。")} /></Beat>
    <Beat name="second-result" visible={step >= 2}><RoutineRunCard message={message} /></Beat>
  </div>;
}

function Memory({ step }: { step: number }) {
  return <div className="feature-native-stack">
    <div className={step >= 2 ? "story-superseded" : undefined}><AskDetail label={featureText("原来的偏好")} text={featureText("原偏好：先展开细节，再给结论。")} /></div>
    <Beat name="correction" visible={step >= 1}><AskCard ariaLabel={featureText("纠正偏好的示例")} title={featureText("以后先给摘要，再展开细节")} header={<AskHeader asker={personal} line={featureText("你更新了阅读偏好")} />} /></Beat>
    <Beat name="current-preference" visible={step >= 2}><Card title={featureText("当前偏好 · 已修订")} subtitle={featureText("先给摘要，需要时再展开细节。")} /></Beat>
    <Beat name="new-answer" visible={step === 3}><Card title={featureText("下一次回答，先看结论")} subtitle={featureText("活动日期待确认；书目、讨论问题和人数可以先准备。需要时再展开依据。")} /></Beat>
  </div>;
}

function Team({ step, advance }: { step: number; advance: () => void }) {
  const names = [research, project, personal];
  return <div className="feature-native-stack">
    <div className="feature-team-faces">{names.map((bot, index) => <div key={bot.name} data-active={Math.min(step, 2) === index}><BotAvatar bot={bot} size={36} animated={false} /><span>{bot.name}</span></div>)}</div>
    <AskDetail label={featureText("共同目标")} text={featureText("核对日期、安排准备工作，最后给我一页摘要。")} />
    {names.map((bot, index) => {
      const message: Message = { id: `feature-handoff-${index}`, kind: "activity", role: "bot", at, tool: { name: [featureText("资料助手 → 项目助手：日期差异"), featureText("项目助手 → 个人助理：准备清单"), featureText("个人助理 → 汇总：一页摘要")][index], ...(step > index ? { ok: true } : {}) },
        comm: { groupId: "synthetic-team", withBotId: `synthetic-${index}`, withName: bot.name, withColor: bot.color } };
      return <Beat key={bot.name} name={`handoff-${index}`} visible={step >= index}><HandoffChip message={message} bots={[]} title={featureText("查看下一步合成协作状态")} onClick={advance} /></Beat>;
    })}
    <Beat name="team-result" visible={step === 3}><Card title={featureText("一页摘要已汇总")} subtitle={featureText("资料助手找出日期差异，项目助手列好准备项；个人助理按新偏好汇总。日期仍等你确认。")} /></Beat>
  </div>;
}

const copy = {
  computer: { title: featureText("在你的工具里，把事情做完。"), body: featureText("按授权使用工具、核对资料。遇到需要你决定的地方，先停下来确认。"), name: featureText("资料助手"), bot: research },
  teach: { title: featureText("示范一次，把步骤留给下次。"), body: featureText("把操作方法整理成可复用步骤。启用步骤复用后，让重复工作沿着已确认的方法继续。"), name: featureText("项目助手"), bot: project },
  memory: { title: featureText("记住你的偏好，也接受纠正。"), body: featureText("保留必要背景，按新的偏好调整下一次回答。记忆可以查看、修订与维护。"), name: featureText("个人助理"), bot: personal },
  team: { title: featureText("让助手之间，接着把事做下去。"), body: featureText("给不同助手明确分工，交接资料、补充背景，再把结果和待确认项汇总给你。"), name: featureText("助手协作"), bot: project },
};

function FeatureCard({ kind }: { kind: Feature }) {
  const root = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [paused, setPaused] = useState(false);
  const [choice, setChoice] = useState(featureText("按周五晚整理"));
  const [reduced, setReduced] = useState(matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 });
    if (root.current) observer.observe(root.current);
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(query.matches);
    const visibility = () => setPageVisible(!document.hidden);
    query.addEventListener("change", change);
    document.addEventListener("visibilitychange", visibility);
    return () => { observer.disconnect(); query.removeEventListener("change", change); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    if (!visible || !pageVisible || paused || reduced) return;
    const timer = setTimeout(() => setStep(step => (step + 1) % 4), step === 3 ? 4200 : 2400);
    return () => clearTimeout(timer);
  }, [visible, pageVisible, paused, reduced, step]);
  const shown = reduced ? 3 : step;
  const advance = () => { setPaused(true); setStep(step => Math.min(step + 1, 3)); };
  const details = copy[kind];
  return <article ref={root} className="feature-article" data-feature={kind} data-step={shown} data-running={visible && pageVisible && !paused && !reduced}>
    <h3>{details.title}</h3><p className="feature-description">{details.body}</p>
    <div className="feature-product" onFocusCapture={() => setPaused(true)}>
      <div className="feature-product-head"><BotAvatar bot={details.bot} size={23} animated={false} /><span>{details.name}</span><span className="feature-stage-label">{timelines[kind][shown]}</span></div>
      <div className="feature-stage">
        {kind === "computer" ? <Computer step={shown} choice={choice} onPick={choice => { setChoice(choice); setPaused(true); setStep(2); }} /> : kind === "teach" ? <Teach step={shown} /> : kind === "memory" ? <Memory step={shown} /> : <Team step={shown} advance={advance} />}
      </div>
    </div>
    <button className="feature-chat" type="button" onClick={() => { setPaused(true); post("feature-chat", { feature: kind, ...(kind === "computer" && shown >= 2 ? { choice: choice === featureText("按周五晚整理") ? "按周五晚整理" : "先保留待确认" } : {}) }); }}>{featureText("用这个示例继续聊 ↑")}</button>
    <div className="feature-controls"><span>{featureText("合成状态演示")}</span><div>
      <button type="button" onClick={() => { setChoice(featureText("按周五晚整理")); setStep(0); setPaused(false); }} disabled={reduced} aria-label={`${featureText("重播：")}${details.title}`}><RotateCcw size={14} />{featureText("重播")}</button>
      <button type="button" onClick={() => setPaused(value => !value)} disabled={reduced} aria-label={`${paused ? featureText("播放") : featureText("暂停")}：${details.title}`} aria-pressed={paused}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? featureText("播放") : featureText("暂停")}</button>
    </div></div>
  </article>;
}

function Features() {
  useEffect(() => {
    const resize = new ResizeObserver(() => post("features-size", { width: innerWidth, height: Math.ceil(document.getElementById("root")!.getBoundingClientRect().height) }));
    resize.observe(document.getElementById("root")!);
    post("features-ready");
    return () => resize.disconnect();
  }, []);
  return <div className="site-feature-grid">{(Object.keys(copy) as Feature[]).map(kind => <FeatureCard key={kind} kind={kind} />)}<p className="feature-scope"><Check size={13} />{featureText("原生产品组件 · 合成数据与预设状态，不连接账号或执行外部任务。")}</p></div>;
}
createRoot(document.getElementById("root")!).render(<Features />);
