import type { RoutineCollectionPlan } from "../../../shared/collection-plan";

export function collectionSources(input: string): Array<{ url: string }> | null {
  const lines = input.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 100) return null;
  const sources: Array<{ url: string }> = [];
  for (const line of lines) {
    if (line.length > 8192 || !/^https?:\/\//i.test(line) || /[\s<>\\]/.test(line)
      || Array.from(line).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null;
    try {
      const url = new URL(line);
      if (!url.hostname || url.username || url.password || !["http:", "https:"].includes(url.protocol)) return null;
      url.hash = "";
      sources.push({ url: url.href });
    } catch { return null; }
  }
  return sources;
}

export function collectionPlan(sources: Array<{ url: string }>, existing?: RoutineCollectionPlan): RoutineCollectionPlan {
  return { kind: "web-collection", version: 1, sources,
    limits: existing ? { ...existing.limits } : { pages: sources.length, bytes: 10_000_000, pageBytes: 1_000_000, attempts: sources.length, durationMs: 30_000 } };
}
