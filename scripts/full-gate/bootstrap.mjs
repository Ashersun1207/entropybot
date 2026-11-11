import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GROUPS, insist } from "./core.mjs";
import { regularBytes } from "./artifact-input.mjs";
import { workflowJobs, artifactJobs, WORKFLOW_PATH } from "./same-run.mjs";

const EXTRACT = `import pathlib,stat,sys,zipfile
archive,destination=sys.argv[1:]
root=pathlib.Path(destination)
root.mkdir()
with zipfile.ZipFile(archive) as z:
 items=z.infolist()
 assert len(items)<=10000 and sum(i.file_size for i in items)<=1073741824, 'artifact too large'
 names=set()
 for i in items:
  p=pathlib.PurePosixPath(i.filename)
  assert not p.is_absolute() and '..' not in p.parts and '\\\\' not in i.filename and i.filename not in names, 'unsafe artifact path'
  names.add(i.filename)
  mode=stat.S_IFMT(i.external_attr>>16)
  assert mode in (0,stat.S_IFREG,stat.S_IFDIR), 'artifact symlink or special file'
 z.extractall(root)
`;
export async function bootstrap({ github, context, env = process.env, reviewArtifactId = "" }) {
  const { owner, repo } = context.repo;
  insist(`${owner}/${repo}` === "Ashersun1207/entropybot" && env.GITHUB_RUN_ATTEMPT === "1", "bootstrap provenance mismatch");
  const binding = { sourceSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID };
  insist(String(context.runId) === binding.runId, "bootstrap run identity mismatch");
  const { data: run } = await github.rest.actions.getWorkflowRun({ owner, repo, run_id: context.runId });
  insist(String(run.id) === binding.runId && run.head_sha === binding.sourceSha && run.run_attempt === 1 && run.path === WORKFLOW_PATH && run.event === "workflow_dispatch" && run.repository?.full_name === `${owner}/${repo}` && run.head_repository?.full_name === `${owner}/${repo}`, "foreign/external workflow execution collection");
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt, { owner, repo, run_id: context.runId, attempt_number: 1, per_page: 100 });
  workflowJobs(jobs, binding);
  const expected = [...GROUPS, "static-checks"].map(g => `full-gate-${g}`).sort();
  const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, { owner, repo, run_id: context.runId, per_page: 100 });
  const selected = artifactJobs(jobs, artifacts.filter(a => a.name.startsWith("full-gate-")), binding);
  insist(selected.length === expected.length, "missing lane artifact mapping");
  const directory = join(env.RUNNER_TEMP, "full-gate");
  mkdirSync(directory);
  const download = async (artifact, destination, currentRun = true) => {
    if (currentRun) insist(String(artifact.workflow_run?.id) === binding.runId && artifact.workflow_run?.head_sha === binding.sourceSha, "artifact is not from this workflow run/source");
    insist(!artifact.expired && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 268435456, "artifact unavailable or oversized");
    const response = await github.rest.actions.downloadArtifact({ owner, repo, artifact_id: artifact.id, archive_format: "zip" });
    const bytes = Buffer.from(response.data);
    insist(bytes.length <= 268435456, "archive response oversized");
    const path = join(env.RUNNER_TEMP, `full-gate-${artifact.id}.zip`);
    writeFileSync(path, bytes, { flag: "wx" });
    execFileSync("python3", ["-I", "-c", EXTRACT, path, destination], { timeout: 60000, stdio: "pipe" });
  };
  for (const artifact of selected) await download(artifact, join(directory, artifact.name.slice("full-gate-".length)));
  writeFileSync(join(directory, "collection.json"), JSON.stringify({ ...binding, attempt: "1", workflow: WORKFLOW_PATH, jobs, artifacts: selected }));
  const reviewDirectory = join(env.RUNNER_TEMP, "full-gate-dispositions");
  if (reviewArtifactId) {
    insist(/^[1-9]\d*$/.test(reviewArtifactId) && Number.isSafeInteger(Number(reviewArtifactId)), "invalid disposition artifact ID");
    const { data: artifact } = await github.rest.actions.getArtifact({ owner, repo, artifact_id: Number(reviewArtifactId) });
    await download(artifact, reviewDirectory, false);
  } else {
    mkdirSync(reviewDirectory);
    const entries = [];
    for (const group of GROUPS) {
      const proposal = JSON.parse(regularBytes(join(directory, group, "platform-dispositions.json")));
      insist(proposal.sourceSha === env.GITHUB_SHA && proposal.runId === env.GITHUB_RUN_ID && proposal.attempt === "1", "proposal provenance mismatch");
      entries.push(...proposal.entries);
    }
    writeFileSync(join(reviewDirectory, "platform-dispositions.json"), JSON.stringify({ sourceSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, attempt: "1", entries, evidence: [], controllerReview: null }));
  }
  return directory;
}
