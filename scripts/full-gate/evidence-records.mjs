import { isAbsolute, posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { insist, safeArgv } from "./core.mjs";
import { absoluteArgument, validateExecutionPaths } from "./execution-paths.mjs";

const kinds = ["policy-prohibition", "policy-acceptance", "controller-review"];
const text = value => typeof value === "string" && value.trim().length > 0 && !/^(?:unknown|unresolved|pending|todo|tbd)$/i.test(value.trim());
const fields = ["group", "file", "fullName", "targetPlatform"];
function date(value, now) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  insist(Number.isFinite(parsed) && new Date(parsed).toISOString() === value && parsed <= now, "missing, invalid or future provenance date");
  return parsed;
}
function scoped(scope, entry, binding, runRequired) {
  insist(scope && scope.sourceSha === binding.sourceSha, "provenance scope source mismatch");
  for (const key of fields) insist(scope[key] === entry[key], `provenance scope ${key} mismatch`);
  insist(runRequired ? scope.runId === binding.runId : scope.runId === undefined || scope.runId === binding.runId, "provenance scope run mismatch");
}
function controller(record, review) {
  insist(text(review?.controllerId) && record?.id === review.controllerId && record?.keyId === review.keyId, "provenance controller identity mismatch");
}
export function testCommand(receipt) {
  const { argv, cwd } = receipt.command;
  const paths = receipt.platform === "win32" ? win32 : posix;
  const pathKey = value => {
    const path = absoluteArgument(cwd, value, receipt.platform);
    return receipt.platform === "win32" ? path.toLowerCase() : path;
  };
  const sourcePath = file => paths.resolve(receipt.report.root, file);
  const bootstrap = value => {
    const url = new URL(value);
    insist(url.protocol === "file:" && !url.host && !url.hash && url.searchParams.size === 1 && url.searchParams.getAll("gate").length === 1 && paths.isAbsolute(url.searchParams.get("gate")), "execution receipt unsupported bootstrap import");
    insist(pathKey(fileURLToPath(url, { windows: receipt.platform === "win32" })) === pathKey(sourcePath("scripts/testing/verification-lifecycle.ts")), "execution receipt unapproved bootstrap entry");
  };
  const executable = argv[0].replaceAll("\\", "/").split("/").at(-1);
  insist(/^node(?:\.exe)?$/.test(executable), "execution receipt requires a direct Node test command");
  let index = 1;
  if (argv[index] === "--import") { bootstrap(argv[index + 1]); index += 2; }
  else if (argv[index]?.startsWith("--import=")) { bootstrap(argv[index].slice("--import=".length)); index++; }
  if (receipt.report.format === "vitest") {
    const entry = argv[index++];
    insist(text(entry) && !entry.startsWith("-") && pathKey(entry) === pathKey(paths.resolve(cwd, "node_modules/vitest/vitest.mjs")), "execution receipt wrong effective Vitest entry");
    insist(argv[index++] === "run", "execution receipt requires immediate Vitest run subcommand");
    const seen = new Set();
    while (index < argv.length) {
      const option = argv[index++];
      const name = option.split("=")[0];
      insist(!seen.has(name), "execution receipt duplicate Vitest option"); seen.add(name);
      if (["--config", "--runner", "--maxWorkers"].includes(option)) {
        const value = argv[index++];
        insist(text(value) && !value.startsWith("-"), "execution receipt missing Vitest option value");
        if (option === "--maxWorkers") insist(/^[12]$/.test(value), "execution receipt unsupported worker count");
        else {
          const allowed = option === "--runner" ? ["scripts/full-gate/strict-runner.ts"] : ["vite.config.ts", "cloudflare/composio-broker/vitest.config.ts", "cloudflare/control-plane/vitest.config.ts", "scripts/full-gate/platform-vitest.config.mjs", "scripts/full-gate/main-vitest.config.mjs", "scripts/full-gate/broker-vitest.config.mjs", "scripts/full-gate/control-plane-vitest.config.mjs"];
          insist(allowed.some(file => pathKey(value) === pathKey(sourcePath(file))), "execution receipt unapproved Vitest configuration");
        }
      } else if (option === "--reporter=json") continue;
      else if (option.startsWith("--outputFile=")) insist(paths.isAbsolute(option.slice("--outputFile=".length)), "execution receipt invalid report destination");
      else if (/^--shard=(?:[1-9]|10)\/10$/.test(option)) continue;
      else if (option.startsWith("--execArgv=--import=")) bootstrap(option.slice("--execArgv=--import=".length));
      else insist(false, "execution receipt unsupported Vitest option or positional filter");
    }
    return [entry];
  }
  insist(receipt.report.format === "node-events" && argv[index++] === "--test", "execution receipt wrong effective Node test mode");
  const files = [];
  const arguments_ = [];
  let concurrency = false;
  let reporters = 0;
  let destinations = 0;
  while (index < argv.length) {
    const argument = argv[index++];
    if (!argument.startsWith("-")) {
      insist(argument.endsWith(".node-test.mjs") && !/[?*[\]{}]/.test(argument), "execution receipt requires literal Node test entries");
      const file = pathKey(argument);
      const relative = paths.relative(receipt.report.root, paths.resolve(cwd, argument));
      insist(relative && relative !== ".." && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative) && !files.includes(file), "execution receipt duplicate or foreign Node test entry");
      files.push(file);
      arguments_.push(argument);
      continue;
    }
    insist(files.length === 0, "execution receipt Node option follows test entry");
    if (/^--test-concurrency=[12]$/.test(argument)) { insist(!concurrency, "execution receipt duplicate Node concurrency"); concurrency = true; }
    else if (argument.startsWith("--test-reporter=")) {
      const value = argument.slice("--test-reporter=".length);
      insist(value === "tap" || pathKey(value) === pathKey(sourcePath("scripts/full-gate/node-reporter.mjs")), "execution receipt unapproved Node reporter"); reporters++;
    } else if (argument.startsWith("--test-reporter-destination=")) {
      insist(paths.isAbsolute(argument.slice("--test-reporter-destination=".length)), "execution receipt invalid Node report destination"); destinations++;
    } else insist(false, "execution receipt unsupported Node test option");
  }
  insist(files.length > 0 && files.includes(pathKey(sourcePath(receipt.assertion.file))) && reporters === destinations, "execution receipt missing Node assertion entry or reporter destination");
  return arguments_;
}
export function recordResolver(records = []) {
  insist(Array.isArray(records), "provenance records missing");
  const index = new Map();
  const used = new Set();
  for (const record of records) {
    insist(record && record.schemaVersion === 1 && text(record.id) && kinds.includes(record.kind) && !index.has(record.id), "invalid or duplicate provenance record");
    index.set(record.id, record);
  }
  return {
    resolve(reference, kind) {
      const record = index.get(reference);
      insist(text(reference) && record?.kind === kind, `unresolvable ${kind} reference`);
      used.add(reference);
      return record;
    },
    finish() { insist(used.size === index.size, "extra unreferenced provenance record"); },
  };
}
export function reviewRecord(resolver, review, entries, binding, now) {
  const record = resolver.resolve(review?.reference, "controller-review");
  insist(record.sourceSha === binding.sourceSha && record.runId === binding.runId && record.decision === "accepted with dispositions", "controller review scope mismatch");
  controller(record.controller, review);
  insist(Array.isArray(record.scope) && record.scope.length === entries.length, "controller review identity coverage mismatch");
  const key = row => JSON.stringify([...fields, "class"].map(k => row[k]));
  insist(new Set(record.scope.map(key)).size === record.scope.length && JSON.stringify(record.scope.map(key).sort()) === JSON.stringify(entries.map(key).sort()), "controller review assertion scope mismatch");
  return date(record.date, now);
}
export function executionRecord(sameRun, cited, entry, binding, now, reviewedAt) {
  insist(sameRun && typeof sameRun.resolve === "function", "same-workflow execution collection missing");
  const collected = sameRun.resolve(cited.reference);
  const receipt = collected.receipt;
  insist(receipt.sourceSha === binding.sourceSha && receipt.platform === entry.targetPlatform, "execution receipt source/platform mismatch");
  insist(receipt.report?.sha256 === cited.reportHash && receipt.report?.root === cited.reportRoot && receipt.report?.format === cited.format, "execution receipt report binding mismatch");
  for (const key of ["group", "file", "fullName"]) insist(receipt.assertion?.[key] === entry[key], `execution receipt ${key} mismatch`);
  insist(receipt.assertion.status === "passed", "execution receipt assertion not passed");
  const { before, after } = receipt.source ?? {};
  insist(before?.sha === binding.sourceSha && after?.sha === binding.sourceSha && before.clean === true && after.clean === true && /^[a-f0-9]{40}$/.test(before.tree) && before.tree === after.tree, "execution receipt dirty or changed source");
  const command = receipt.command;
  insist(command && Array.isArray(command.argv) && command.argv.every(text) && text(command.cwd), "execution receipt command missing");
  safeArgv(command.argv);
  const absolute = receipt.platform === "win32" ? win32.isAbsolute : isAbsolute;
  insist(absolute(command.cwd) && absolute(receipt.report.root), "execution receipt requires absolute command/report roots");
  validateExecutionPaths(receipt, collected.installation, testCommand(receipt));
  insist(command.exitCode === 0 && command.signal === null && command.timedOut === false && command.retries === 0, "execution receipt outcome failed or incomplete");
  const started = date(receipt.startedAt, now);
  const finished = date(receipt.finishedAt, now);
  insist(started <= finished && finished <= reviewedAt, "execution receipt chronology mismatch");
  return collected.report;
}
export function policyRecords(resolver, cited, entry, binding, review, now, reviewedAt) {
  const prohibition = resolver.resolve(cited.policyRef, "policy-prohibition");
  const acceptance = resolver.resolve(cited.acceptanceReference, "policy-acceptance");
  insist(cited.reference === acceptance.id, "policy reference must resolve to its acceptance record");
  scoped(prohibition.scope, entry, binding, false);
  scoped(acceptance.scope, entry, binding, true);
  insist(prohibition.status === "prohibited" && text(prohibition.prohibition) && prohibition.reason === entry.reason, "policy prohibition absent or inapplicable");
  insist(acceptance.policyRef === prohibition.id && acceptance.decision === "accepted with dispositions", "policy acceptance mismatch");
  controller(acceptance.controller, review);
  const prohibitedAt = date(prohibition.date, now);
  const acceptedAt = date(acceptance.date, now);
  insist(prohibitedAt <= acceptedAt && acceptedAt <= reviewedAt, "policy acceptance chronology mismatch");
}
