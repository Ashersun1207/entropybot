import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const REPOSITORY = "Ashersun1207/entropybot";
export const WORKFLOW = ".github/workflows/entropybot-full-gate.yml";
export const REQUIRED_JOBS = Object.freeze([
  ...Array.from({ length: 10 }, (_, index) => `main-vitest-${String(index + 1).padStart(2, "0")}`),
  "broker-vitest", "control-plane-vitest", "electron-node", "static-checks", "full-gate-verdict",
]);
export const VERDICT_STEPS = Object.freeze([
  "Exact final-source file coverage", "Strict totals: no failures or todos",
  "Fixture isolation and resource receipts", "Platform dispositions complete", "Clean unchanged source",
]);
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// No producer is approved yet. Only a reviewed workflow and its transitive runner
// sources, pinned by SHA-256 here, can become authoritative; environment and local
// JSON must never provision this trust root.
const APPROVED_PRODUCER_FILES = Object.freeze({});

function requireThat(condition, message) {
  if (!condition) throw new Error(`Release full gate blocked: ${message}`);
}

export function validateRecord({ run, jobs, sha, now = Date.now() }) {
  requireThat(/^[a-f0-9]{40}$/.test(sha), "invalid source SHA");
  requireThat(run?.repository?.full_name === REPOSITORY && run?.head_repository?.full_name === REPOSITORY, "foreign repository");
  requireThat(run.head_sha === sha, "source SHA mismatch");
  requireThat(run.path === WORKFLOW, "wrong producer workflow");
  requireThat(["push", "workflow_dispatch"].includes(run.event), "unsupported source event");
  requireThat(run.status === "completed" && run.conclusion === "success", "run is not successful and complete");
  requireThat(run.run_attempt === 1, "rerun evidence is not accepted");
  const started = Date.parse(run.run_started_at);
  const finished = Date.parse(run.updated_at);
  requireThat(Number.isFinite(started) && Number.isFinite(finished) && started <= finished && finished <= now && now - started <= MAX_AGE_MS, "stale or invalid run timestamps");
  requireThat(Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.workflow_id) && run.workflow_id > 0, "invalid run identity");
  requireThat(Array.isArray(jobs) && jobs.length === REQUIRED_JOBS.length, "partial or extra job evidence");
  requireThat(new Set(jobs.map(job => job.name)).size === jobs.length, "duplicate job evidence");
  for (const name of REQUIRED_JOBS) {
    const job = jobs.find(candidate => candidate.name === name);
    requireThat(job?.run_id === run.id && job?.head_sha === sha && job?.run_attempt === 1, `job provenance: ${name}`);
    requireThat(job.status === "completed" && job.conclusion === "success", `job failed or skipped: ${name}`);
    requireThat(Array.isArray(job.steps) && job.steps.length > 0 && job.steps.every(step => step.status === "completed" && step.conclusion === "success"), `incomplete, skipped or failed steps: ${name}`);
  }
  const verdict = jobs.find(job => job.name === "full-gate-verdict");
  requireThat(verdict.steps.length === VERDICT_STEPS.length, "partial or extra strict verdict steps");
  for (const name of VERDICT_STEPS) {
    requireThat(verdict.steps.filter(step => step.name === name).length === 1, `missing strict verdict: ${name}`);
  }
  return { sourceSha: sha, runId: run.id, runAttempt: 1 };
}

export async function verifyRemoteGate({ sha, token, fetchImpl = fetch, now = Date.now(), producerFiles = APPROVED_PRODUCER_FILES }) {
  requireThat(/^[a-f0-9]{40}$/.test(sha), "invalid source SHA");
  requireThat(Object.hasOwn(producerFiles, WORKFLOW) && Object.keys(producerFiles).length >= 2 && Object.values(producerFiles).every(hash => /^[a-f0-9]{64}$/.test(hash)), "authoritative full-regression producer is not provisioned (see docs/verification/release-full-gate.md)");
  requireThat(typeof token === "string" && token.length > 0, "authenticated Actions read token is required");
  const get = async path => {
    const response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}${path}`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    requireThat(response.ok, `GitHub evidence unavailable (HTTP ${response.status})`);
    return response.json();
  };
  for (const [path, hash] of Object.entries(producerFiles)) {
    requireThat(/^[a-zA-Z0-9_./-]+$/.test(path) && !path.split("/").includes(".."), "invalid producer source path");
    const file = await get(`/contents/${path}?ref=${sha}`);
    requireThat(file.encoding === "base64" && typeof file.content === "string", "producer source unavailable");
    requireThat(createHash("sha256").update(Buffer.from(file.content, "base64")).digest("hex") === hash, `unapproved producer source: ${path}`);
  }
  const workflow = await get(`/actions/workflows/${WORKFLOW.split("/").at(-1)}`);
  requireThat(workflow.path === WORKFLOW && workflow.state === "active" && Number.isSafeInteger(workflow.id), "unavailable producer workflow");
  const getNewestRun = async () => {
    const listing = await get(`/actions/workflows/${workflow.id}/runs?head_sha=${sha}&per_page=100`);
    requireThat(Array.isArray(listing.workflow_runs) && listing.workflow_runs.length > 0, "missing full regression run");
    requireThat(listing.total_count === listing.workflow_runs.length && listing.total_count <= 100, "truncated run evidence");
    return [...listing.workflow_runs].sort((left, right) => right.id - left.id)[0];
  };
  const selected = await getNewestRun();
  const run = await get(`/actions/runs/${selected.id}`);
  requireThat(run.id === selected.id && run.workflow_id === workflow.id, "run workflow identity mismatch");
  const result = await get(`/actions/runs/${run.id}/attempts/1/jobs?per_page=100`);
  requireThat(Array.isArray(result.jobs) && result.total_count === result.jobs.length && result.total_count <= 100, "truncated job evidence");
  const verdict = validateRecord({ run, jobs: result.jobs, sha, now });
  const current = await get(`/actions/runs/${run.id}`);
  requireThat(current.run_attempt === run.run_attempt && current.status === run.status && current.conclusion === run.conclusion && current.updated_at === run.updated_at, "run changed during verification");
  const newest = await getNewestRun();
  requireThat(newest.id === run.id && newest.run_attempt === 1 && newest.status === "completed" && newest.conclusion === "success", "concurrent rerun detected during verification");
  return verdict;
}

export async function main(env = process.env) {
  requireThat(env.GITHUB_REPOSITORY === REPOSITORY, "wrong release repository");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  requireThat(head === env.GITHUB_SHA, "checkout does not match final release SHA");
  requireThat(execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" }).trim() === "", "source checkout is dirty");
  return verifyRemoteGate({ sha: head, token: env.GH_TOKEN });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
