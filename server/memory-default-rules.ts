import { z } from "zod";
import { MEMORY_DEFAULT_RULES_MAX_BYTES } from "../shared/memory-default-rules.ts";

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
