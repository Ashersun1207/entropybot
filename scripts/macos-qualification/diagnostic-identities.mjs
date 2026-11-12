import { insist } from "../full-gate/core.mjs";
import { identity as fullGateIdentity } from "../full-gate/dispositions.mjs";
import { nodeResults } from "../full-gate/node-results.mjs";

const nameKey = row => JSON.stringify([row.group, row.file, row.fullName]);
export const diagnosticAssertionKey = row => JSON.stringify([row.file, row.fullName, ...(Object.hasOwn(row, "occurrence") ? [row.occurrence] : [])]);
export const diagnosticIdentity = row => Object.hasOwn(row, "occurrence") ? JSON.stringify([row.group, row.file, row.fullName, row.occurrence]) : fullGateIdentity(row);
function byName(tests) {
  const names = new Map();
  for (const test of tests) {
    const key = nameKey(test);
    if (!names.has(key)) names.set(key, []);
    names.get(key).push(test);
  }
  return names;
}
export function diagnosticOccurrences(tests) {
  insist(tests.every(test => !Object.hasOwn(test, "occurrence")), "diagnostic occurrences already assigned");
  const names = byName(tests);
  const next = new Map();
  return tests.map(test => {
    const key = nameKey(test);
    if (names.get(key).length === 1) return { ...test };
    const occurrence = next.get(key) ?? 0;
    next.set(key, occurrence + 1);
    return { ...test, occurrence };
  });
}
export function assertDiagnosticIdentities(tests) {
  insist(tests.length > 0 && new Set(tests.map(diagnosticIdentity)).size === tests.length, "empty/duplicate test identities");
  for (const rows of byName(tests).values()) {
    if (rows.length === 1) insist(!Object.hasOwn(rows[0], "occurrence"), "occurrence on unique diagnostic title");
    else insist(rows.every(row => Number.isSafeInteger(row.occurrence) && row.occurrence >= 0 && row.occurrence < rows.length), "missing or invalid diagnostic occurrence");
  }
}
export function diagnosticNodeResults(text, root, group = "electron-node") {
  const parsed = nodeResults(text, root, group);
  const terminal = text.trim().split("\n").map(line => JSON.parse(line)).filter(event => event.type === "test:pass" && event.data.details?.type === "test");
  insist(terminal.length === parsed.tests.length, "diagnostic Node terminal coverage mismatch");
  const declared = parsed.tests.map((test, index) => ({ test, entryFile: terminal[index].data.entryFile, testId: terminal[index].data.testId }));
  declared.sort((a, b) => a.entryFile < b.entryFile ? -1 : a.entryFile > b.entryFile ? 1 : a.testId - b.testId);
  return { ...parsed, tests: diagnosticOccurrences(declared.map(row => row.test)) };
}
