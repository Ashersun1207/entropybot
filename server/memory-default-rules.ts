import { z } from "zod";
import { MEMORY_DEFAULT_RULES_MAX_BYTES } from "../shared/memory-default-rules.ts";

export const INITIAL_MEMORY_RULES = [
  "- 先给结论，再展开细节。",
  "- 不确定时先问清楚，不要猜。",
  "- 发邮件、发布内容或更改配置前，先征得我的同意。",
].join("\n");

export const defaultRulesSchema = z.string().refine(
  (text) => Buffer.byteLength(text) <= MEMORY_DEFAULT_RULES_MAX_BYTES,
  `Default rules must be at most ${MEMORY_DEFAULT_RULES_MAX_BYTES} UTF-8 bytes`,
).nullish();

export const botDefaultRulesSchema = defaultRulesSchema.transform((text) => text?.trim() ? text : undefined);

export function discardInvalidBotRules(bot: { defaultRules?: string }): boolean {
  if (bot.defaultRules === undefined) return false;
  const parsed = botDefaultRulesSchema.safeParse(bot.defaultRules);
  if (parsed.success && parsed.data !== undefined) return false;
  delete bot.defaultRules;
  return true;
}
