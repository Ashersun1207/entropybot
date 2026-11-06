import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { checkPatchContracts, repositoryRoot } from "../check-patches.mjs";
import { inventory, vitestFiles, nodeTestFiles } from "../patch-contracts.mjs";

function copyFixture(change: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "entropybot-patch-mutation-"));
  try {
    for (const file of new Set([...inventory, ...vitestFiles, ...nodeTestFiles])) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), readFileSync(join(repositoryRoot, file)));
    }
    change(root);
    return checkPatchContracts(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

it("accepts the unchanged repository and a temporary copy", () => {
  expect(checkPatchContracts()).toEqual([]);
  expect(copyFixture(() => {})).toEqual([]);
});

it("rejects removed recall wiring even with its import, comment and file intact", () => {
  const failures = copyFixture(root => {
    const file = join(root, "server/index.ts");
    const source = readFileSync(file, "utf8");
    expect(source).toContain("await buildRecall({");
    writeFileSync(file, source.replace("await buildRecall({", "await Promise.resolve({") + '\n// buildRecall({})\nconst deadPatchText = "buildRecall({})";\n');
  });
  expect(failures).toHaveLength(1);
  expect(failures[0]).toContain("[P1/auto-recall] server/index.ts:");
  expect(failures[0]).toContain("found 0");
  console.info(failures[0]);
});

it("rejects an upstream replacement release source with every file intact", () => {
  const failures = copyFixture(root => {
    writeFileSync(join(root, "electron/update-policy.mjs"), 'export const RELEASES_URL = "https://github.com/upstream/product/releases";\nexport const UPDATE_MODE = "manual";\n');
  });
  expect(failures).toHaveLength(1);
  expect(failures[0]).toContain("[P4/release-source] electron/update-policy.mjs:");
  expect(failures[0]).toContain("https://github.com/upstream/product/releases");
  console.info(failures[0]);
});

it("rejects only the desktop API source contract when its URL is replaced", () => {
  const failures = copyFixture(root => {
    const file = join(root, "electron/updater.mjs");
    const source = readFileSync(file, "utf8");
    const expected = "https://api.github.com/repos/Ashersun1207/entropybot/releases/latest";
    expect(source.split(expected)).toHaveLength(2);
    writeFileSync(file, source.replace(expected, "https://api.github.com/repos/upstream/product/releases/latest"));
  });
  expect(failures).toHaveLength(1);
  expect(failures[0]).toContain("[P4/desktop-source] electron/updater.mjs:");
  expect(failures[0]).toContain('LATEST_RELEASE_URL expected "https://api.github.com/repos/Ashersun1207/entropybot/releases/latest", got "https://api.github.com/repos/upstream/product/releases/latest"');
  console.info(failures[0]);
});

it("ignores formatting and imported local aliases", () => {
  expect(copyFixture(root => {
    const file = join(root, "server/index.ts");
    const source = readFileSync(file, "utf8");
    writeFileSync(file, source.replace("import { buildRecall,", "import { buildRecall as retrievePatchMemory,")
      .replace("await buildRecall({", "await retrievePatchMemory ( /* synthetic formatting */ {"));
  })).toEqual([]);
});

it("allows extracting the imported call into a helper", () => {
  expect(copyFixture(root => {
    const file = join(root, "server/index.ts");
    const source = readFileSync(file, "utf8");
    writeFileSync(file, source.replace("await buildRecall({", "await patchRecallHelper({")
      + "\nfunction patchRecallHelper(input: Parameters<typeof buildRecall>[0]) { return buildRecall(input); }\n");
  })).toEqual([]);
});

it("reports a missing registered behavior test rather than skipping it", () => {
  const failures = copyFixture(root => rmSync(join(root, "server/recall.test.ts")));
  expect(failures.some((failure: string) => failure.startsWith("[inventory] missing/unreadable file: server/recall.test.ts"))).toBe(true);
});

it.each([
  "electron/credential-namespace-migration.test.mjs",
  "electron/credential-namespace-migration-runner.test.mjs",
  "electron/credential-namespace-migration-child.test.mjs",
  "electron/credential-namespace-migration-rollback.test.mjs",
  "electron/secure-credential-io.test.mjs",
])("requires migration behavior coverage and rejects its missing file: %s", file => {
  expect(vitestFiles.filter(registered => registered === file)).toEqual([file]);
  const failures = copyFixture(root => rmSync(join(root, file)));
  expect(failures).toHaveLength(1);
  expect(failures[0]).toContain(`[inventory] missing/unreadable file: ${file}`);
});

it("selects the script's repository when launched from another working directory", () => {
  const result = spawnSync(process.execPath, [join(repositoryRoot, "scripts/check-patches.mjs")], { cwd: tmpdir(), encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("behavior NOT RUN");
});

it("rejects unknown arguments instead of silently ignoring a target root", () => {
  const result = spawnSync(process.execPath, [join(repositoryRoot, "scripts/check-patches.mjs"), "--root", tmpdir()], { encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Usage:");
  expect(result.stdout).toBe("");
});

it("migrates the OpenMausBot data path into .entropybot using a disposable home", () => {
  const temporary = mkdtempSync(join(tmpdir(), "entropybot-patch-data-path-"));
  try {
    const legacy = join(temporary, ".openmausbot");
    mkdirSync(legacy);
    writeFileSync(join(legacy, "patch-fixture.txt"), "synthetic legacy data");
    const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TMPDIR", "TEMP", "TMP"].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    const result = spawnSync(process.execPath, ["--input-type=module", "-e",
      "const config = await import(process.argv[1]); config.ensureDirs(); console.log(config.DATA_DIR);",
      pathToFileURL(join(repositoryRoot, "server/config.ts")).href], {
      cwd: repositoryRoot, env: { ...env, HOME: temporary, USERPROFILE: temporary }, encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(join(temporary, ".entropybot"));
    expect(readFileSync(join(temporary, ".entropybot", "patch-fixture.txt"), "utf8")).toBe("synthetic legacy data");
    expect(existsSync(legacy)).toBe(false);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
