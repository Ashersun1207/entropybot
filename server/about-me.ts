// About me, the profile every bot reads: facts bots learn into it, and lines a person asks a bot to forget.
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

export type AboutMeScope = { kind: "person"; key: string } | { kind: "no-person" } | { kind: "unresolved" };

export interface AboutMeDeps {
  read(): string;
  write(text: string): void;
  /** Clients are told after the learned facts are recorded, so a reload sees both. */
  changed(): void;
  today(): string;
  /** A Team Cloud keeps one About me per person, found from the memory layer of their conversation. */
  person?: (layer: string, plan: Plan, checked?: boolean) => number;
  personScope?: (layer: string) => AboutMeScope;
}

export type AboutMeCorrectionOutcome =
  | { status: "not_checked"; reason: "selector_missing" }
  | { status: "refused"; reason: "not_authorized" | "no_person" | "unsupported_target" }
  | { status: "conflict"; reason: "absent_or_changed" | "ambiguous" }
  | { status: "saved"; metadata: "saved" | "not_applicable"; notification: "sent" | "failed" }
  | { status: "partial"; reason: "profile_save_failed" | "metadata_save_failed" | "persisted_value_mismatch" };

export type AboutMe = ReturnType<typeof createAboutMe>;

export function createAboutMe(deps: AboutMeDeps) {
  const revisions = new Map<string, number>();
  const scopeFor = (layer: string): AboutMeScope => deps.person
    ? deps.personScope?.(layer) ?? { kind: "unresolved" }
    : { kind: "person", key: "owner" };
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
    fence(layer: string): () => boolean {
      const scope = scopeFor(layer);
      if (scope.kind === "unresolved") return () => false;
      const revision = scope.kind === "person" ? revisions.get(scope.key) ?? 0 : 0;
      return () => {
        const current = scopeFor(layer);
        return scope.kind === "no-person" ? current.kind === "no-person"
          : current.kind === "person" && current.key === scope.key && revision === (revisions.get(scope.key) ?? 0);
      };
    },
    correct(layer: string, oldLine: string, text: string): AboutMeCorrectionOutcome {
      const scope = scopeFor(layer);
      if (scope.kind !== "person") return { status: "refused", reason: "no_person" };
      const key = scope.key;
      if (!oldLine.trim() || oldLine.trim().startsWith("#") || !text.trim() || text.length > 300 || /[\r\n]/.test(oldLine + text)) {
        return { status: "refused", reason: "unsupported_target" };
      }
      const replacement = redactSecretsInText(text.trim());
      const changes = new Map<string, { text: string; line: string }>();
      let outcome: AboutMeCorrectionOutcome = { status: "refused", reason: "no_person" };
      let expected: string | undefined;
      const plan: Plan = (current) => {
        const lines = current.split("\n");
        const matches = lines.flatMap((line, at) => line === oldLine ? [at] : []);
        if (matches.length !== 1) {
          outcome = { status: "conflict", reason: matches.length ? "ambiguous" : "absent_or_changed" };
          return null;
        }
        const prefix = LEARNED_PREFIX.exec(oldLine)?.[0] ?? BULLET.exec(oldLine)?.[0] ?? "";
        if (!oldLine.slice(prefix.length).trim()) {
          outcome = { status: "refused", reason: "unsupported_target" };
          return null;
        }
        const corrected = prefix + replacement;
        lines[matches[0]!] = corrected;
        const next = lines.join("\n");
        if (next.length > (deps.person ? 4_000 : 24_000) || (deps.person && next.trim() !== next)) {
          outcome = { status: "refused", reason: "unsupported_target" };
          return null;
        }
        expected = next;
        changes.set(oldLine, { text: replacement, line: corrected });
        revisions.set(key, (revisions.get(key) ?? 0) + 1);
        return { next, count: 1 };
      };
      try {
        if (deps.person) {
          deps.person(layer, plan, true);
        } else {
          const planned = plan(deps.read());
          if (planned) {
            deps.write(planned.next);
            if (deps.read() !== expected) return { status: "partial", reason: "persisted_value_mismatch" };
          }
        }
      } catch {
        return { status: "partial", reason: "profile_save_failed" };
      }
      if (expected === undefined) return outcome;
      let metadata: "saved" | "not_applicable" = "not_applicable";
      if (!deps.person) {
        try { if (correctLearnedLines(changes)) metadata = "saved"; } catch { return { status: "partial", reason: "metadata_save_failed" }; }
      }
      try { deps.changed(); } catch {
        return { status: "saved", metadata, notification: "failed" };
      }
      return { status: "saved", metadata, notification: "sent" };
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
