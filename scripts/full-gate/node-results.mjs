import { insist, reportFile } from "./core.mjs";

export function nodeResults(text, root, group = "electron-node") {
  const events = text.trim().split("\n").map(line => JSON.parse(line));
  const summary = events.filter(e => e.type === "test:summary" && !e.data.file);
  insist(summary.length === 1 && summary[0].data.success === true, "missing or failed Node summary");
  const counts = summary[0].data.counts;
  insist(counts.tests > 0 && counts.tests === counts.passed + counts.skipped && ["failed", "cancelled", "todo"].every(k => counts[k] === 0), "Node incomplete/failure/todo totals");
  insist(!events.some(e => e.type === "test:fail"), "Node failed event");
  const nodes = new Map();
  const key = data => `${data.entryFile}\0${data.testId}`;
  for (const { type, data } of events) if (type === "test:enqueue" && data.entryFile) {
    insist(Number.isSafeInteger(data.testId) && typeof data.file === "string", "Node identity missing");
    insist(!nodes.has(key(data)), "duplicate Node test identity");
    nodes.set(key(data), data);
  }
  const tests = [];
  for (const { type, data } of events) {
    if (type !== "test:pass" || data.details?.type === "suite") continue;
    insist(data.details?.type === "test" && !data.todo && !data.details.retryCount, "Node todo/retry/unknown result");
    const names = [];
    const seen = new Set();
    let node = nodes.get(key(data));
    insist(node && node.name === data.name && node.parentId === data.parentId, "Node declaration/terminal identity mismatch");
    while (node) {
      insist(!seen.has(key(node)), "Node parent cycle"); seen.add(key(node)); names.unshift(node.name);
      if (!node.parentId) break;
      node = nodes.get(`${node.entryFile}\0${node.parentId}`);
      insist(node, "Node parent identity missing");
    }
    const file = reportFile(root, data.file);
    tests.push({ group, file, fullName: names.join(" > "), status: data.skip ? "skipped" : "passed" });
  }
  insist(tests.length === counts.tests && tests.filter(t => t.status === "skipped").length === counts.skipped, "Node event totals mismatch");
  return { tests, files: [...new Set(tests.map(t => t.file))].sort(), total: counts.tests, passed: counts.passed, skipped: counts.skipped };
}
