import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { id?: string; run?: string; uses?: string; if?: unknown; shell?: string; "working-directory"?: string; "continue-on-error"?: unknown; env?: Record<string, unknown>; with?: Record<string, unknown> };
type Job = { steps: Step[]; if?: unknown; "continue-on-error"?: unknown; needs?: string; env?: Record<string, unknown>; "timeout-minutes"?: number; defaults?: unknown; permissions?: unknown };
type Workflow = { on: Record<string, unknown>; permissions: Record<string, string>; env?: Record<string, unknown>; jobs: Record<string, Job>; defaults?: unknown };

const workflow: Workflow = parse(readFileSync(new URL("../.github/workflows/entropybot-ci.yml", import.meta.url), "utf8"));
const gates = [
  ["check", "ci-contract", "pnpm exec vitest run scripts/entropybot-ci-workflow.test.ts"],
  ["check", "lint", "pnpm lint"],
  ["check", "identity", "node scripts/entropybot-release.mjs check"],
  ["check", "tools-contract", "node --test scripts/testing/tooling-types.node-test.mjs"],
  ["check", "patches", "node scripts/check-patches.mjs --verify"],
  ["check", "types", "pnpm typecheck"],
  ["check", "guards", "pnpm exec vitest run scripts/testing/file-size-ratchet.test.ts scripts/testing/verification-docs.test.ts src/locales/vocabulary.test.ts electron/updater.test.mjs server/local-computer.test.ts"],
  ["behavior-evals", "eval-types", "pnpm exec tsc -p evals/tsconfig.json"],
  ["behavior-evals", "eval-tests", "pnpm exec vitest run --config evals/vitest.config.ts"],
  ["behavior-evals", "scenarios", "pnpm eval"],
  ["behavior-evals", "golden", "pnpm eval --golden"],
] as const;

function requireGate(candidate: Workflow, jobId: string, stepId: string, command: string) {
  const job = candidate.jobs[jobId];
  expect(job, `missing job ${jobId}`).toBeDefined();
  expect(candidate.defaults).toBeUndefined();
  expect(job.defaults).toBeUndefined();
  expect(job.if).toBeUndefined();
  expect(job["continue-on-error"]).toBeUndefined();
  const steps = job.steps.filter((step) => step.id === stepId);
  expect(steps, `missing/duplicate ${stepId}`).toHaveLength(1);
  expect(steps[0]!.run).toBe(command);
  expect(steps[0]!.if).toBeUndefined();
  expect(steps[0]!.shell).toBeUndefined();
  expect(steps[0]!["working-directory"]).toBeUndefined();
  expect(steps[0]!["continue-on-error"]).toBeUndefined();
}

function requireFastTypeChecks(candidate: Workflow) {
  requireGate(candidate, "check", "tools-contract", "node --test scripts/testing/tooling-types.node-test.mjs");
  requireGate(candidate, "check", "types", "pnpm typecheck");
  requireGate(candidate, "check", "patches", "node scripts/check-patches.mjs --verify");
  const steps = candidate.jobs.check.steps;
  const index = (id: string) => steps.findIndex((step) => step.id === id);
  expect(index("tools-contract")).toBeLessThan(index("types"));
  expect(index("types")).toBeLessThan(index("patches"));
}

function requireToolEntry(scripts: Record<string, string>) {
  expect(scripts["typecheck:tools"]).toBe("tsc -p tsconfig.tools.json");
  expect(scripts.typecheck).toBe("tsc -p tsconfig.tools.json && tsc -b && tsc -p tsconfig.server.json");
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(stringValues);
  return [];
}

function requireOfflineReadOnly(candidate: Workflow) {
  expect(candidate.permissions).toEqual({ contents: "read" });
  for (const value of stringValues(candidate)) {
    for (const expression of value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
      expect(expression[1]).not.toMatch(/\bsecrets\b/i);
    }
  }
  expect(candidate.jobs["behavior-evals"].env?.OMB_EVAL_LIVE).toBe("0");
  for (const job of Object.values(candidate.jobs)) {
    expect(job.permissions).toBeUndefined();
    const checkouts = job.steps.filter((step) => step.uses === "actions/checkout@v4");
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0]!.with?.["persist-credentials"]).toBe(false);
    for (const env of [candidate.env, job.env, ...job.steps.map((step) => step.env)]) {
      expect(env?.OMB_EVAL_LIVE === undefined || env.OMB_EVAL_LIVE === "0").toBe(true);
      expect(Object.keys(env ?? {}).filter((key) => key.startsWith("OMB_EVAL_LIVE_"))).toEqual([]);
    }
    for (const step of job.steps) {
      expect(step.run ?? "").not.toMatch(/--live|--update-baseline|OMB_EVAL_LIVE\s*=\s*1/);
    }
  }
}

describe("active Entropybot CI", () => {
  it("routes normal typechecking through tools and runs type gates before patch behavior", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    requireToolEntry(pkg.scripts);
    requireFastTypeChecks(workflow);
  });

  it("retains retry observation: init, per-step logs and an always summary", () => {
    const steps = workflow.jobs.check.steps;
    const id = (name: string) => steps.find((step) => step.id === name);
    expect(id("retry-init")?.run).toBe("node scripts/testing/ci-retry-summary.mjs --init");
    expect(id("retry-summary")?.run).toBe("node scripts/testing/ci-retry-summary.mjs");
    expect(id("retry-summary")?.if).toBe("always()");
    for (const check of ["ci-contract", "patches", "guards"]) {
      expect(id(check)?.env?.OMB_VITEST_RETRY_LOG).toBe("${{ env.OMB_VITEST_RETRY_DIRECTORY }}/" + check + ".jsonl");
      expect(id(check)?.env?.OMB_VITEST_RETRY_BATCH_ID).toBe(check);
    }
    expect(workflow.jobs.check.env).toMatchObject({ OMB_VITEST_RETRY_DIRECTORY: "/tmp/entropybot-retry-${{ github.run_id }}-${{ github.run_attempt }}" });
    expect(workflow.jobs.check.env?.OMB_VITEST_RETRY_RUN_ID).toBe("${{ github.run_id }}-${{ github.run_attempt }}");
  });

  it("rejects a removed retry observation hook or a non-always summary", () => {
    const missingInit = structuredClone(workflow);
    missingInit.jobs.check.steps = missingInit.jobs.check.steps.filter((step) => step.id !== "retry-init");
    expect(() => { const found = missingInit.jobs.check.steps.find((step) => step.id === "retry-init"); expect(found).toBeDefined(); }).toThrow();

    const missingLog = structuredClone(workflow);
    delete missingLog.jobs.check.steps.find((step) => step.id === "ci-contract")!.env!.OMB_VITEST_RETRY_LOG;
    expect(missingLog.jobs.check.steps.find((step) => step.id === "ci-contract")!.env?.OMB_VITEST_RETRY_LOG).toBeUndefined();

    const conditionalSummary = structuredClone(workflow);
    conditionalSummary.jobs.check.steps.find((step) => step.id === "retry-summary")!.if = undefined;
    expect(conditionalSummary.jobs.check.steps.find((step) => step.id === "retry-summary")!.if).toBeUndefined();
  });

  it("rejects a disconnected tool compiler or reordered slow gate", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(() => requireToolEntry({ ...pkg.scripts, typecheck: "tsc -b && tsc -p tsconfig.server.json" })).toThrow();
    const lateTypes = structuredClone(workflow);
    const steps = lateTypes.jobs.check.steps;
    const types = steps.splice(steps.findIndex((step) => step.id === "types"), 1)[0]!;
    steps.push(types);
    expect(() => requireFastTypeChecks(lateTypes)).toThrow();
  });

  it.each(gates)("requires %s / %s without a bypass", (job, step, command) => {
    requireGate(workflow, job, step, command);
  });

  it.each(gates)("detects a removed %s / %s", (job, step, command) => {
    const broken = structuredClone(workflow);
    if (broken.jobs[job]) broken.jobs[job].steps = broken.jobs[job].steps.filter((item) => item.id !== step);
    expect(() => requireGate(broken, job, step, command)).toThrow();
  });

  it.each(["if", "continue-on-error"] as const)("detects %s on a required step or job", (field) => {
    for (const [job, step, command] of gates) {
      for (const target of ["job", "step"]) {
        const broken = structuredClone(workflow);
        if (target === "job") broken.jobs[job][field] = true;
        else broken.jobs[job].steps.find((item) => item.id === step)![field] = true;
        expect(() => requireGate(broken, job, step, command)).toThrow();
      }
    }
  });

  it("retains read-only push/PR checks and bounded jobs", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.on).toHaveProperty("pull_request");
    expect(workflow.on.push).toEqual({ branches: ["main", "codex/**"] });
    expect(workflow.jobs["behavior-evals"].needs).toBe("check");
    for (const job of Object.values(workflow.jobs)) {
      expect(job["timeout-minutes"]).toBeGreaterThan(0);
      expect(job["timeout-minutes"]).toBeLessThanOrEqual(20);
      expect(job.steps.some((step) => step.run === "pnpm install --frozen-lockfile")).toBe(true);
      expect(job.steps.some((step) => step.uses === "actions/setup-node@v4")).toBe(true);
    }
  });

  it.each(["step-shell", "job-default", "workflow-default", "directory"])("detects an execution override: %s", (mutation) => {
    for (const [job, step, command] of gates) {
      const broken = structuredClone(workflow);
      const selected = broken.jobs[job].steps.find((item) => item.id === step)!;
      if (mutation === "step-shell") selected.shell = "true {0}";
      if (mutation === "job-default") broken.jobs[job].defaults = { run: { shell: "true {0}" } };
      if (mutation === "workflow-default") broken.defaults = { run: { shell: "true {0}" } };
      if (mutation === "directory") selected["working-directory"] = "other-checkout";
      expect(() => requireGate(broken, job, step, command)).toThrow();
    }
  });

  it("keeps the effective workflow read-only and live models closed", () => {
    requireOfflineReadOnly(workflow);
  });

  it.each(["permissions", "secret-env", "secret-bracket", "secret-wrapped", "secret-input", "checkout-token", "live", "live-config"])("rejects unsafe CI configuration: %s", (mutation) => {
    for (const job of Object.keys(workflow.jobs)) {
      const broken = structuredClone(workflow);
      const selected = broken.jobs[job];
      if (mutation === "permissions") selected.permissions = { contents: "write" };
      if (mutation === "secret-env") selected.env = { ...selected.env, OPENAI_API_KEY: "${{ secrets.OPENAI_API_KEY }}" };
      if (mutation === "secret-bracket") selected.env = { ...selected.env, OPENAI_API_KEY: "${{ secrets['OPENAI_API_KEY'] }}" };
      if (mutation === "secret-wrapped") selected.env = { ...selected.env, OPENAI_API_KEY: "${{ format('{0}', secrets.OPENAI_API_KEY) }}" };
      if (mutation === "secret-input") selected.steps[0]!.with = { ...selected.steps[0]!.with, token: "${{ secrets.CI_TOKEN }}" };
      if (mutation === "checkout-token") delete selected.steps[0]!.with;
      if (mutation === "live") selected.env = { ...selected.env, OMB_EVAL_LIVE: "1" };
      if (mutation === "live-config") selected.env = { ...selected.env, OMB_EVAL_LIVE_CONFIG: "instance.json" };
      expect(() => requireOfflineReadOnly(broken)).toThrow();
    }
  });
});
