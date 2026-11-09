// About me, the profile every bot reads: facts bots learn into it, and lines a person asks a bot to forget.
import { foldForMatch, passageMatcher } from "./memory-entries.ts";
import { appendAboutMe, commitLearned, correctLearnedLines, planLearned } from "./profile-learned.ts";
import { redactSecretsInText } from "./redact.ts";

const LEARNED_PREFIX = /^\s*-\s*\d{4}-\d{2}-\d{2} · learned by [^·\n]* · /;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** A learned line is judged by its fact, never by the bot that learned it. */
export function withoutMentionedLines(aboutMe: string, mentions: (text: string) => boolean): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept = aboutMe.split("\n").filter((line) => {
    const fact = line.replace(LEARNED_PREFIX, "").replace(BULLET, "").trim();
    if (!fact || !mentions(fact)) return true;
    removed.push(fact);
    return false;
  });
  return { text: kept.join("\n"), removed };
}

type Plan = (current: string) => { next: string; count: number } | null;

export interface AboutMeDeps {
  read(): string;
  write(text: string): void;
  /** Clients are told after the learned facts are recorded, so a reload sees both. */
  changed(): void;
  today(): string;
  /** A Team Cloud keeps one About me per person, found from the memory layer of their conversation. */
  person?: (layer: string, plan: Plan) => number;
}

export type AboutMe = ReturnType<typeof createAboutMe>;

export function createAboutMe(deps: AboutMeDeps) {
  const learnPlan = (from: { botId: string; botName: string }, texts: readonly string[]) => {
    let facts: ReturnType<typeof planLearned> = [];
    const plan: Plan = (current) => {
      facts = planLearned(from, texts, current, deps.today());
      const next = appendAboutMe(current, facts.map((fact) => fact.line));
      return facts.length && next !== null ? { next, count: facts.length } : null;
    };
    return { plan, facts: () => facts };
  };
  return {
    learn(from: { botId: string; botName: string }, texts: readonly string[]): number {
      const { plan, facts } = learnPlan(from, texts);
      if (deps.person) return deps.person(from.botId, plan);
      const planned = plan(deps.read());
      if (!planned) return 0;
      deps.write(planned.next);
      commitLearned(facts());
      deps.changed();
      return planned.count;
    },
    correct(layer: string, oldText: string, text: string): number {
      const mentions = passageMatcher(oldText);
      const replacement = redactSecretsInText(text.trim());
      if (!mentions || !replacement || replacement.length > 300 || /[\r\n]/.test(oldText + replacement)) return 0;
      const changes = new Map<string, { text: string; line: string }>();
      const plan: Plan = (current) => {
        const next = current.split("\n").map((line) => {
          if (line.trim().startsWith("#")) return line;
          const prefix = LEARNED_PREFIX.exec(line)?.[0] ?? BULLET.exec(line)?.[0] ?? "";
          const fact = line.slice(prefix.length).trim();
          if (!mentions(fact) || foldForMatch(fact) !== foldForMatch(oldText)) return line;
          const corrected = prefix + replacement;
          if (corrected !== line) changes.set(line, { text: replacement, line: corrected });
          return corrected;
        }).join("\n");
        return next === current ? null : { next, count: changes.size };
      };
      if (deps.person) return deps.person(layer, plan);
      const planned = plan(deps.read());
      if (!planned) return 0;
      deps.write(planned.next);
      correctLearnedLines(changes);
      deps.changed();
      return planned.count;
    },
    /** The facts removed from the About me of the person whose conversation `layer` is. */
    forget(layer: string, mentions: (text: string) => boolean): string[] {
      let removed: string[] = [];
      const plan: Plan = (current) => {
        const kept = withoutMentionedLines(current, mentions);
        removed = kept.removed;
        return kept.removed.length ? { next: kept.text, count: kept.removed.length } : null;
      };
      if (deps.person) {
        deps.person(layer, plan);
        return removed;
      }
      const planned = plan(deps.read());
      if (!planned) return [];
      deps.write(planned.next);
      deps.changed();
      return removed;
    },
  };
}
