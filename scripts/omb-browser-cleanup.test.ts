import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { main } from "./omb-browser.ts";
import { calibrateIdentity } from "../server/browser/chrome/calibrate.ts";
import { launchChrome, ChromeLaunchError } from "../server/browser/chrome/launch.ts";

vi.mock("../server/browser/chrome/calibrate.ts", async (original) => ({ ...await original<typeof import("../server/browser/chrome/calibrate.ts")>(), calibrateIdentity: vi.fn() }));
vi.mock("../server/browser/chrome/launch.ts", async (original) => ({ ...await original<typeof import("../server/browser/chrome/launch.ts")>(), launchChrome: vi.fn() }));
afterEach(() => { vi.mocked(calibrateIdentity).mockReset(); vi.mocked(launchChrome).mockReset(); vi.restoreAllMocks(); });

it.each(["snapshot", "calibrate", "bot-tests"])("preserves the actual %s CLI work directory when Chrome closure is unknown", async (command) => {
  let work = "";
  const fail = (home: string) => {
    work = home;
    writeFileSync(join(home, "retain-marker"), "synthetic evidence");
    throw new ChromeLaunchError("synthetic unknown at CLI boundary", "", { status: "unknown", userDataDir: home });
  };
  vi.mocked(calibrateIdentity).mockImplementationOnce(async options => fail(options.home!));
  vi.mocked(launchChrome).mockImplementationOnce(async options => fail(options.home!));
  const output = mkdtempSync(join(tmpdir(), "omb-cli-output-"));
  const args = [command, ...(command === "snapshot" ? ["http://127.0.0.1:9/"] : []), "--chrome", "never-executed-fixture", "--out", output];
  await expect(main(args)).rejects.toMatchObject({ cleanup: { status: "unknown" } });
  expect(work).not.toBe("");
  expect(existsSync(join(work, "retain-marker"))).toBe(true);
});

it.each(["snapshot", "calibrate", "bot-tests"])("cleans the actual %s CLI work directory after a confirmed closed launch failure", async (command) => {
  let work = "";
  const fail = (home: string) => {
    work = home;
    throw new ChromeLaunchError("synthetic confirmed closed", "", { status: "closed", userDataDir: home });
  };
  vi.mocked(calibrateIdentity).mockImplementationOnce(async options => fail(options.home!));
  vi.mocked(launchChrome).mockImplementationOnce(async options => fail(options.home!));
  const output = mkdtempSync(join(tmpdir(), "omb-cli-output-"));
  await expect(main([command, ...(command === "snapshot" ? ["http://127.0.0.1:9/"] : []), "--chrome", "never-executed-fixture", "--out", output])).rejects.toThrow();
  expect(work).not.toBe("");
  expect(existsSync(work)).toBe(false);
});

it("cleans the calibration CLI work directory on normal completion", async () => {
  let work = "";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(calibrateIdentity).mockImplementationOnce(async (options) => { work = options.home!; return {} as never; });
  expect(await main(["calibrate", "--chrome", "never-executed-fixture"])).toBe(0);
  expect(existsSync(work)).toBe(false);
});
