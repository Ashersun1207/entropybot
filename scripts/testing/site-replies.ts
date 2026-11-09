export const SITE_REPLIES = {
  "日期先保留待确认": "## 日期先保留，准备工作继续\n\n先整理书目摘要、三个讨论问题和人数清单。**日期仍待确认，邀请保留为草稿。**\n\n这是合成示例，没有安排活动或发送邀请。",
  "按刚才的三个步骤": "## 按相同方法整理新增资料\n\n1. 对照活动说明与新增场地备注。\n2. 标出人数从 **12人调整为16人** 的变化。\n3. 给出一页摘要，把人数确认列为下一步。\n\n日期仍需确认；邀请保留为草稿。这是步骤复用的合成结果。",
  "请汇总资料助手": "## 一页协作摘要\n\n- **日期差异**：活动说明为周五，场地备注为周六，等你确认。\n- **准备清单**：书目摘要、三个讨论问题、场地与人数。\n- **下一步**：先确认日期，再审阅邀请草稿。\n\n这是合成协作结果，没有实际调用其他助手或发送内容。",
  "两份活动资料": "## 先确认一处日期差异\n\n活动说明写 **周五晚**，场地备注写 **周六晚**。请先确认以哪份为准。\n\n准备工作可以先安排：书目摘要、三个讨论问题、场地与人数。**邀请保留为草稿，等待你确认。**\n\n你可以接着输入“准备清单”或“先给摘要”。这是合成示例，没有查询外部服务或发送邀请。",
  "日期": "两份示例资料有一处日期差异：\n\n- 活动说明：**周五晚**。\n- 场地备注：**周六晚**。\n\n先确认活动日期，再决定是否发送邀请。这次只核对示例资料，没有查询外部服务。",
  "清单": "## 读书会准备清单\n\n1. 确定书目，整理一页摘要。\n2. 准备三个讨论问题。\n3. 确认日期、场地与人数。\n\n邀请先留作草稿，等待你确认。这里没有发送邀请或创建日历。",
  "偏好": "在这段示例对话里，以最新偏好为准：**先给摘要，再展开细节。**\n\n你可以继续切换助手、输入文字。这是合成交互预览，不会修改你的真实记忆。",
  "摘要": "## 示例摘要\n\n读书会需要先核对活动日期，再确认书目、讨论问题和参与人数。邀请保留为草稿。\n\n需要时，可以继续要求列出准备清单。",
  "你好": "你好，我是 Entropybot。你现在可以直接操作真实产品界面。\n\n试试输入：\n- 帮我核对读书会的日期\n- 整理准备清单\n- 以后先给摘要，再展开细节\n\n这里使用预设示例回复，不连接真实模型或个人数据。",
  "读书会": "准备读书会时，可以先核对日期，再列书目、讨论问题和人数清单。\n\n你可以输入“核对日期”或“准备清单”继续体验。这些是合成示例，不会执行外部任务。",
};
export const SITE_FALLBACK_REPLY = "收到。这个示例用预设回复，不会执行外部任务或读取你的数据。\n\n可以试试“核对日期”“准备清单”或“先给摘要”，也可以在侧栏切换助手。";
const ENGLISH_REPLIES: Array<[RegExp, string]> = [
  [/日期先保留待确认|unconfirmed|pending date/i, "## Prepare while the date is pending\n\nPrepare a book summary, three discussion questions and an attendee list. **The date still needs confirmation; the invitation stays a draft.**\n\nThis is a synthetic example. No event was scheduled and no invitation was sent."],
  [/按刚才的三个步骤|same (method|steps)/i, "## Apply the same steps to the new notes\n\n1. Compare the event brief with the new venue notes.\n2. Highlight the attendee count changing from **12 to 16**.\n3. Summarize the changes and ask for confirmation.\n\nThe invitation remains a draft. This is a synthetic example of reusing steps."],
  [/请汇总资料助手|handoff|collaborat/i, "## A shared summary\n\n- **Date conflict:** Friday in the event brief, Saturday in the venue notes.\n- **Preparation:** book summary, three discussion questions, venue and attendees.\n- **Next:** confirm the date, then review the draft invitation.\n\nThis is synthetic collaboration; no other assistant was called and nothing was sent."],
  [/两份活动资料|日期|date|friday|saturday/i, "The two sample documents disagree on the date:\n\n- Event brief: **Friday evening**.\n- Venue notes: **Saturday evening**.\n\nPlease confirm the date before sending an invitation. This example only compares synthetic documents; it does not query external services."],
  [/清单|checklist|prepar/i, "## Book club preparation checklist\n\n1. Choose the book and write a one-page summary.\n2. Prepare three discussion questions.\n3. Confirm the date, venue and attendees.\n\nThe invitation stays a draft for your approval. No invitation was sent and no calendar event was created."],
  [/偏好|prefer|remember/i, "For this example conversation, use your latest preference: **summary first, details when needed.**\n\nYou can switch assistants and keep chatting. This is a synthetic preview; it does not change your real memories."],
  [/摘要|summary|summari/i, "## Sample summary\n\nConfirm the book club date, then the book, discussion questions and attendees. The invitation remains a draft.\n\nYou can ask for a preparation checklist next."],
  [/你好|hello|\bhi\b/i, "Hi, I'm Entropybot. You can interact with the real product interface here.\n\nTry asking me to check the book club date, prepare a checklist, or use summaries first.\n\nThese are preset example replies. No real model or personal data is connected."],
  [/读书会|book club/i, "Start by confirming the date, then prepare the book, discussion questions and attendee list.\n\nTry ‘check the date’ or ‘preparation checklist’. These are synthetic examples; no external task will run."],
];
export function siteReply(text: string, english = false): string {
  if (english) return ENGLISH_REPLIES.find(([marker]) => marker.test(text))?.[1] ?? "Got it. This preview uses preset replies. It does not run external tasks or read your data.\n\nTry ‘check the date’, ‘preparation checklist’ or ‘summary first’, or switch assistants in the sidebar.";
  return Object.entries(SITE_REPLIES).find(([marker]) => text.includes(marker))?.[1] ?? SITE_FALLBACK_REPLY;
}
