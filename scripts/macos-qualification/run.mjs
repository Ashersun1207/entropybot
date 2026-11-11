import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, lstatSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { source, unchanged } from "../full-gate/core.mjs";
import { beginResourceAudit } from "../full-gate/resource-audit.mjs";
import { createGateCapability, gateBootstrapArgs, gateVitestWorkerArg, assertGateLeases } from "../testing/verification-lifecycle.ts";
import { actualHost, environment, identity, inventory, writeReport, requireValue, recordCommand, downloadPnpm, checkSuiteReport, SUITES, ELECTRON_SHA, sealReports } from "./contract.mjs";
import { applicationSuites, provisionDiagnosticCache } from "./application.mjs";
import { workflowContract } from "./workflow-contract.mjs";

const [reportArgument, sha, runId, attempt] = process.argv.slice(2);
const root = resolve(import.meta.dirname, "../..");
const reports = realpathSync(reportArgument);
const summary = { kind: "macos-qualification-diagnostic", startedAt: new Date().toISOString(), sourceSha: sha, runId, attempt, phases: [],
  missingCapabilities: ["first-JavaScript trust qualification", "Node PGP verification", "complete resource containment", "authoritative F2 producer/trust approval", "Entropybot signing/notarization and installed application acceptance"],
  outOfScope: ["release acceptance", "packaging", "local application installation", "Linux and Windows qualification (deferred)"] };
const phase = async (name, action) => {
  const record = { name, startedAt: new Date().toISOString() };
  summary.phases.push(record);
  try { await action(); record.status = "diagnostic-pass"; return true; }
  catch (error) { record.status = "diagnostic-fail"; record.error = String(error); return false; }
  finally { record.finishedAt = new Date().toISOString(); }
};
let home;
let env;
let capability;
let before;
let audit;
let dependencyBefore;
const run = (name, executable, argv, timeoutMs = 120000, childEnv = env) => recordCommand({ reports, name, executable, argv, cwd: root, env: childEnv, timeoutMs, capability });
const catalog = JSON.parse(readFileSync(join(root, "scripts/full-gate/toolchain-candidates.json"), "utf8"));
try {
  const host = await phase("host-source", async () => {
    const uname = execFileSync("/usr/bin/uname", ["-sm"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" }, timeout: 5000 }).trim();
    actualHost(process.platform, process.arch, uname, process.version);
    requireValue(attempt === "1" && /^[1-9]\d*$/.test(runId) && /^[a-f0-9]{40}$/.test(sha), "source/run/attempt mismatch");
    before = source(root, sha);
    writeReport(reports, "source-before.json", before);
    writeReport(reports, "source-inputs.json", ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".github/workflows/entropybot-macos-qualification.yml", ...readdirSync(join(root, "scripts/macos-qualification")).map(name => "scripts/macos-qualification/" + name)].map(name => identity(join(root, name))));
    const selected = catalog.node.selectedMembers["node-v24.22.2-darwin-arm64/bin/node"];
    const observed = identity(process.execPath);
    writeReport(reports, "node-tool.json", { version: process.version, platform: process.platform, arch: process.arch, uname, observed,
      expectedExecutable: selected, expectedOfficialArchive: { url: catalog.node.archiveURL, sha256: catalog.node.archiveSha256 },
      observedArchive: null, provisioning: "pinned setup-node action; hosted toolcache allowed; archive transport is in action logs, not observed here",
      pgpVerification: "not-verified", trustBoundary: "trusted hosted runner, OS and pinned action startup; standard public package SRI" });
    requireValue(observed.sha256 === selected.sha256, "Node executable differs from pristine candidate bytes");
    home = realpathSync(mkdtempSync("/private/tmp/mq-"));
    env = environment(home, dirname(realpathSync(process.execPath)));
    for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "TMPDIR", "npm_config_cache", "npm_config_store_dir", "PNPM_HOME"]) mkdirSync(env[key], { recursive: true, mode: 0o700 });
    for (const key of ["npm_config_userconfig", "npm_config_globalconfig"]) writeFileSync(env[key], "", { mode: 0o600, flag: "wx" });
    mkdirSync(join(home, "server-logs"), { mode: 0o700 });
    env.OMB_VERIFICATION_EVIDENCE_DIR = join(home, "server-logs");
    const binding = { sourceSha: sha, runId, attempt, group: "macos-qualification" };
    capability = createGateCapability(home, binding);
    audit = await beginResourceAudit({ root, home, binding, output: join(reports, "resource-audit.json"), processCapability: capability });
  });
  if (host) {
    let pnpm;
    const prepared = await phase("pnpm-prepare", async () => {
      const inputs = join(home, "inputs");
      mkdirSync(inputs, { mode: 0o700 });
      writeReport(reports, "pnpm-download.json", await downloadPnpm(join(inputs, "pnpm-10.33.0.tgz")));
      const output = join(home, "pnpm-data");
      await run("pnpm-extract", "/usr/bin/python3", ["scripts/full-gate/prepare-toolchain-candidate.py", "--input-root", inputs, "--output-root", output, "--profile", "pnpm-complete-runtime"]);
      writeReport(reports, "pnpm-preparation.json", JSON.parse(readFileSync(join(output, "manifest.json"), "utf8")));
      pnpm = join(output, "data/package/bin/pnpm.cjs");
      const approved = catalog.packages.find(item => item.name === "pnpm");
      for (const member of ["bin/pnpm.cjs", "dist/pnpm.cjs"]) requireValue(identity(join(output, "data/package", member)).sha256 === approved.members[`package/${member}`].sha256, "pnpm source hash mismatch");
      const result = await run("pnpm-version", process.execPath, [pnpm, "--version"]);
      requireValue(result.stdout.trim() === "10.33.0", "pnpm version mismatch");
    });
    let installed = false;
    if (prepared) installed = await phase("dependency-install", async () => {
      requireValue(!existsSync(join(root, "node_modules")), "checkout must have no prior dependency installation");
      await run("dependency-install", process.execPath, [pnpm, "install", "--frozen-lockfile", "--store-dir", env.npm_config_store_dir], 720000);
      unchanged(before, source(root, sha));
    });
    if (installed) {
      await phase("workflow-contract", async () => {
        const { parse } = createRequire(import.meta.url)("yaml");
        workflowContract(parse(readFileSync(join(root, ".github/workflows/entropybot-macos-qualification.yml"), "utf8")));
      });
      await phase("electron-provision-and-start", async () => {
        const electron = realpathSync(join(root, "node_modules/electron"));
        const requireElectron = createRequire(join(electron, "install.js"));
        const selected = [catalog.packages.find(item => item.name === "electron"), ...["@electron/get", "@electron-internal/extract-zip"].map(name => catalog.packages.find(item => item.name === name))];
        const sources = [];
        for (const item of selected) {
          const directory = item.name === "electron" ? electron : realpathSync(join(electron, "..", item.name));
          requireValue(JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version === item.version, "Electron provisioner version mismatch");
          for (const [member, expected] of Object.entries(item.members)) {
            const observed = identity(join(directory, member.slice("package/".length)));
            sources.push({ package: item.name, member, expected, observed });
            requireValue(observed.sha256 === expected.sha256 && observed.bytes === expected.bytes, "Electron provisioner pristine source mismatch");
          }
        }
        const getEntry = requireElectron.resolve("@electron/get");
        const extractorEntry = requireElectron.resolve("@electron-internal/extract-zip");
        const checksums = JSON.parse(readFileSync(join(electron, "checksums.json"), "utf8"));
        requireValue(checksums["electron-v43.7.9-darwin-arm64.zip"] === ELECTRON_SHA, "Electron archive table mismatch");
        requireValue(!existsSync(join(electron, "dist")) && !existsSync(join(electron, "path.txt")), "Electron must be freshly explicitly provisioned");
        writeReport(reports, "electron-before.json", { sources, getEntry, extractorEntry, distPresent: false, cachePresent: false, expectedArchiveSha256: ELECTRON_SHA });
        const cache = join(home, "electron-cache");
        const electronEnv = { ...env, electron_config_cache: cache };
        await run("electron-provision", process.execPath, [join(electron, "install.js")], 360000, electronEnv);
        const archives = [];
        function scan(directory) {
          for (const name of readdirSync(directory)) {
            const path = join(directory, name);
            const stat = lstatSync(path);
            requireValue(!stat.isSymbolicLink(), "unexpected Electron cache link");
            if (stat.isDirectory()) scan(path);
            else if (name === "electron-v43.7.9-darwin-arm64.zip") archives.push(identity(path));
          }
        }
        scan(cache);
        requireValue(archives.length === 1 && archives[0].sha256 === ELECTRON_SHA, "actual Electron cached archive hash missing/mismatched");
        const relative = readFileSync(join(electron, "path.txt"), "utf8");
        requireValue(relative === "Electron.app/Contents/MacOS/Electron", "unexpected Electron executable path");
        requireValue(readFileSync(join(electron, "dist/version"), "utf8").trim().replace(/^v/, "") === "43.7.9", "Electron extracted version mismatch");
        const executable = join(electron, "dist", relative);
        const executableBefore = identity(executable);
        const result = await run("electron-version", executable, ["--user-data-dir=" + join(home, "electron-profile"), "--use-mock-keychain", "--version"], 30000);
        requireValue(result.stdout.trim() === "v43.7.9", "actual Electron startup version mismatch");
        const executableAfter = identity(executable);
        requireValue(executableBefore.sha256 === executableAfter.sha256, "Electron executable changed on startup");
        writeReport(reports, "electron-after.json", { archives, executableBefore, executableAfter, version: result.stdout.trim(), vendorCodesign: "not-checked", desktopReadiness: "official Electron --version only; application window readiness unqualified" });
      });
      await phase("dependency-snapshot-before-tests", async () => {
        writeReport(reports, "mutable-cache-links.json", provisionDiagnosticCache(root, home));
        dependencyBefore = inventory(join(root, "node_modules"));
        writeReport(reports, "dependencies-before.json", dependencyBefore);
      });
      await phase("actual-http-normal-operation", async () => {
        await run("http-smoke", process.execPath, [...gateBootstrapArgs(capability), "scripts/macos-qualification/http-smoke.mjs", reports], 150000);
      });
      await phase("normal-failure-cancel-suites", async () => {
        const config = join(home, "qualification.config.mjs");
        const original = pathToFileURL(join(root, "vite.config.ts")).href;
        const strict = pathToFileURL(join(root, "scripts/full-gate/strict-config.mjs")).href;
        writeFileSync(config, `import base from ${JSON.stringify(original)}; import {strictConfig} from ${JSON.stringify(strict)}; const config=strictConfig(base); export default {...config,cacheDir:${JSON.stringify(join(home, "vite-cache"))},test:{...config.test,retry:0,fileParallelism:false,maxWorkers:1}};\n`, { flag: "wx", mode: 0o600 });
        await run("lifecycle-suites", process.execPath, [...gateBootstrapArgs(capability), "node_modules/vitest/vitest.mjs", "run", ...SUITES, "--config", config, "--configLoader", "native", gateVitestWorkerArg(capability), "--reporter=json", "--outputFile=" + join(reports, "lifecycle-results.json")], 300000);
        checkSuiteReport(JSON.parse(readFileSync(join(reports, "lifecycle-results.json"), "utf8")));
      });
      await applicationSuites({ root, reports, binding: { sourceSha: sha, runId, attempt }, before, phase });
      await phase("leases-dependencies-source", async () => {
        writeReport(reports, "leases.json", { verified: assertGateLeases(capability), completeCleanup: false });
        const after = inventory(join(root, "node_modules"));
        writeReport(reports, "dependencies-after.json", after);
        requireValue(dependencyBefore && after.sha256 === dependencyBefore.sha256, "dependency bytes changed during diagnostics");
        unchanged(before, source(root, sha));
      });
    }
  }
} catch (error) {
  summary.phases.push({ name: "orchestrator", status: "diagnostic-fail", error: String(error) });
} finally {
  if (audit) await phase("owned-resource-observation", async () => {
    const result = await audit.finish();
    requireValue(result.status === "clear-observed-domain", "owned resource observation unknown or residual; incomplete containment remains a missing capability");
  });
  if (before) await phase("unchanged-source", async () => {
    const after = source(root, sha);
    writeReport(reports, "source-after.json", after);
    unchanged(before, after);
  });
  await phase("bounded-artifact-inventory", async () => {
    const quarantine = mkdtempSync(join(dirname(reports), "mq-quarantine-"));
    writeReport(reports, "artifact-inventory.json", sealReports(reports, quarantine, capability?.secret));
  });
  summary.finishedAt = new Date().toISOString();
  summary.status = summary.phases.some(record => record.status !== "diagnostic-pass") ? "diagnostic-fail" : "diagnostic-pass";
  summary.completeQualification = false;
  summary.completeCleanup = false;
  summary.scratchHome = home;
  writeReport(reports, "summary.json", summary);
  process.exitCode = summary.status === "diagnostic-pass" ? 0 : 1;
}
