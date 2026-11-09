const examples = {
  computer: { role: "research", prompt: "帮我核对读书会资料的日期，列准备清单。邀请先留作草稿。" },
  teach: { role: "project", prompt: "按刚才的三个步骤再整理一次读书会资料，给我摘要和人数变化。" },
  memory: { role: "personal", prompt: "以后先给摘要，再展开细节。按这个偏好整理读书会资料。" },
  team: { role: "project", prompt: "请汇总资料助手的日期差异、项目助手的准备清单，先给一页摘要。" },
} as const;

const englishPrompts = {
  computer: "Check the dates in the book club documents and prepare a checklist. Keep the invitation as a draft.",
  teach: "Use the same steps to review the new book club notes. Summarize the changes to the attendee count.",
  memory: "Use my preference: summary first, then details. Summarize the book club documents this way.",
  team: "Summarize the assistants' collaboration: date conflict, preparation checklist and next steps on one page.",
};
export function siteExample(feature: unknown, choice: unknown, english = false) {
  if (typeof feature !== "string" || !Object.hasOwn(examples, feature)) return null;
  if (choice !== undefined && choice !== null && (feature !== "computer" || typeof choice !== "string" || !["按周五晚整理", "先保留待确认"].includes(choice))) return null;
  const example = examples[feature as keyof typeof examples];
  const prompt = feature === "computer" && choice === "先保留待确认"
    ? "日期先保留待确认，帮我整理不依赖日期的准备清单。"
    : feature === "computer" && choice === "按周五晚整理"
      ? "按示例中的周五晚准备读书会，列一份清单。邀请先留作草稿。"
      : example.prompt;
  const translated = feature === "computer" && choice === "先保留待确认" ? "Keep the date unconfirmed and prepare the items that do not depend on it." : feature === "computer" && choice === "按周五晚整理" ? "Prepare the book club for Friday evening. Make a checklist and keep the invitation as a draft." : englishPrompts[feature as keyof typeof englishPrompts];
  return { role: example.role, prompt: english ? translated : prompt };
}
