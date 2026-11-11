import { verify } from "node:crypto";
import { insist, digest, vitestResults } from "./core.mjs";
import { nodeResults } from "./node-results.mjs";
import { recordResolver, reviewRecord, executionRecord, policyRecords } from "./evidence-records.mjs";

export const CLASSES = ["executed-in-this-run", "policy-prohibited"];
export const identity = row => JSON.stringify([row.group, row.file, row.fullName]);
const concrete = value => typeof value === "string" && value.trim().length > 0 && !/^(?:unknown|unresolved|pending|todo|tbd)$/i.test(value.trim());
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function reconcile(tests, bundle, binding, { publicKeys = {}, sameRun, now = Date.now() } = {}) {
  insist(Array.isArray(tests) && tests.length > 0, "missing per-test report identities");
  insist(new Set(tests.map(identity)).size === tests.length, "duplicate report test identity");
  insist(tests.every(t => ["passed", "skipped"].includes(t.status)), "nonterminal report status");
  const skipped = tests.filter(t => t.status === "skipped");
  insist(bundle?.sourceSha === binding.sourceSha && bundle?.runId === binding.runId && bundle?.attempt === "1", "disposition source/run mismatch");
  insist(Array.isArray(bundle.entries) && Array.isArray(bundle.evidence), "missing disposition artifact");
  insist(bundle.entries.length === skipped.length, "undeclared or extra disposition count");
  insist(new Set(bundle.entries.map(identity)).size === bundle.entries.length, "duplicate disposition identity");
  const records = recordResolver(bundle.records);
  let reviewedAt;
  if (skipped.length) {
    const { controllerReview, ...payload } = bundle;
    insist(controllerReview?.decision === "accepted with dispositions" && concrete(controllerReview.reference), "controller review missing");
    const key = publicKeys[controllerReview.keyId];
    insist(key && typeof controllerReview.signature === "string", "untrusted controller review");
    const { signature, ...review } = controllerReview;
    insist(verify(null, Buffer.from(canonical({ ...payload, controllerReview: review })), key, Buffer.from(signature, "base64")), "controller signature mismatch");
    reviewedAt = reviewRecord(records, controllerReview, bundle.entries, binding, now);
  }
  const actual = new Map(skipped.map(t => [identity(t), t]));
  const evidence = new Map();
  for (const row of bundle.evidence) {
    insist(concrete(row.id) && !evidence.has(row.id), "duplicate or missing evidence identity");
    evidence.set(row.id, row);
  }
  const used = new Set();
  for (const entry of bundle.entries) {
    insist(actual.has(identity(entry)), "undeclared or mismatched skip identity");
    insist(CLASSES.includes(entry.class) && Object.keys(entry).every(k => ["group", "file", "fullName", "class", "reason", "targetPlatform", "evidenceRef", "sourceHash"].includes(k)), "invalid or multiple disposition classes/fields");
    insist(concrete(entry.reason) && concrete(entry.targetPlatform) && concrete(entry.evidenceRef), "missing or unresolved disposition fields");
    const cited = evidence.get(entry.evidenceRef);
    insist(cited && cited.sourceSha === binding.sourceSha && concrete(cited.reference), "missing or unresolved target-platform evidence");
    for (const key of ["group", "file", "fullName", "class", "reason", "targetPlatform"]) insist(entry[key] === cited[key], `evidence ${key} mismatch`);
    used.add(cited.id);
    if (entry.class === "policy-prohibited") {
      insist(cited.kind === "policy" && cited.status === "prohibited" && concrete(cited.policyRef) && concrete(cited.acceptanceReference), "policy prohibition/acceptance reference missing");
      policyRecords(records, cited, entry, binding, bundle.controllerReview, now, reviewedAt);
    } else {
      insist(cited.kind === "execution" && cited.status === "passed" && /^[a-f0-9]{64}$/.test(cited.reportHash) && concrete(cited.reportRoot), "unresolved execution evidence");
      insist(["linux", "win32", "darwin"].includes(cited.targetPlatform), "invalid target platform");
      const raw = executionRecord(sameRun, cited, entry, binding, now, reviewedAt);
      insist(digest(raw) === cited.reportHash, "target evidence altered");
      const parsed = cited.format === "vitest" ? vitestResults(JSON.parse(raw), cited.reportRoot, cited.group) : cited.format === "node-events" ? nodeResults(raw.toString(), cited.reportRoot, cited.group) : null;
      insist(parsed && parsed.tests.some(t => identity(t) === identity(entry) && t.status === "passed"), "target assertion not executed and passed");
    }
  }
  insist(used.size === evidence.size, "extra unreferenced evidence");
  records.finish();
  return { total: tests.length, passed: tests.length - skipped.length, skipped: skipped.length, strictGreen: skipped.length === 0, status: skipped.length ? "accepted with dispositions" : "strict green" };
}
export function proposedDispositions(tests, binding, declarations) {
  const entries = tests.filter(t => t.status === "skipped").map(test => {
    const declared = declarations.find(row => identity(row) === identity(test));
    return declared ? { ...declared } : { group: test.group, file: test.file, fullName: test.fullName, class: null, reason: "unresolved", targetPlatform: "unresolved", evidenceRef: null };
  });
  return { ...binding, attempt: "1", entries, evidence: [], controllerReview: null };
}
