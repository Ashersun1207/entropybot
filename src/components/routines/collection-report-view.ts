import { collectionSources } from "./collection-input";

export function collectionSummary(output?: string) {
  if (!output || output.length > 16_384 || !output.startsWith("Web collection report\n")) return null;
  const pages = /^Pages: (\d+)$/m.exec(output);
  const unique = /^Unique: (\d+)$/m.exec(output);
  const hash = /^SHA-256: ([a-f0-9]{64})$/m.exec(output);
  if (!pages || !unique || !hash) return null;
  const result = { pages: Number(pages[1]), unique: Number(unique[1]), hash: hash[1] };
  return result.pages >= 1 && result.pages <= 100 && result.unique >= 1 && result.unique <= result.pages ? result : null;
}

export function collectionReportView(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const report = value as Record<string, unknown>;
  if (report.version !== 1 || !Number.isInteger(report.pages) || !Number.isInteger(report.unique)
    || typeof report.pages !== "number" || typeof report.unique !== "number"
    || report.pages < 1 || report.pages > 100 || report.unique < 1 || report.unique > report.pages
    || typeof report.hash !== "string" || !/^[a-f0-9]{64}$/.test(report.hash)
    || !Array.isArray(report.sources) || report.sources.length !== report.unique) return null;
  let total = 0;
  const sources: Array<{ url: string; text: string }> = [];
  for (const source of report.sources) {
    if (!source || typeof source !== "object" || typeof source.url !== "string" || typeof source.text !== "string"
      || collectionSources(source.url)?.length !== 1 || source.text.length > 1_000_000) return null;
    total += source.text.length;
    if (total > 10_000_000) return null;
    sources.push({ url: source.url, text: source.text });
  }
  return { version: 1 as const, pages: report.pages, unique: report.unique, hash: report.hash, sources };
}
