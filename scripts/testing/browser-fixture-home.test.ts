import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import type { BrowserSpawnSpec } from "../../server/browser-runtime.ts";
import type { ChromeLauncherOptions } from "../../server/browser/chrome/launcher.ts";
import { FAKE_IDENTITY } from "../../server/browser/testing/fake-chrome.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";

const fixture = vi.hoisted(() => ({ launchers: [] as ChromeLauncherOptions[], calibration: [] as NodeJS.ProcessEnv[] }));
vi.mock("../../server/browser/chrome/launcher.ts", async (original) => {
  const actual = await original<typeof import("../../server/browser/chrome/launcher.ts")>();
  return { ...actual, ChromeLauncher: class extends actual.ChromeLauncher {
    constructor(options: ChromeLauncherOptions) {
      fixture.launchers.push(options);
      super({ ...options, screen: async () => ({ width: 1440, height: 900 }), calibrate: async (_executable, env) => {
        fixture.calibration.push(env);
        return FAKE_IDENTITY;
      } });
    }
  } };
});
vi.mock("../../server/browser-runtime.ts", async (original) => {
  const actual = await original<typeof import("../../server/browser-runtime.ts")>();
  return { ...actual, BrowserRuntime: class {
    async agentRpc(_session: string, spec: BrowserSpawnSpec) {
      const result = spawnSync(spec.command, ["record"], { env: actual.browserRuntimeEnv(spec.env), encoding: "utf8", timeout: 10_000 });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout);
    }
    async closeAll() {}
  } };
});
const { withBotBrowser } = await import("../verify-browser-identity.ts");

type Capture = { kind: "chrome" | "agent"; home: string; userprofile: string; args: string[]; executable?: string; config?: string };
it.skipIf(process.platform === "win32").each(["launcher", "legacy-shell", "default-home"])("keeps actual fixture children off the account home in %s", async (mode) => {
  fixture.launchers = []; fixture.calibration = [];
  const root = mkdtempSync(join(tmpdir(), "omb-fixture-home-"));
  onTestFinished(() => removeTempDir(root));
  const captures = join(root, "children.jsonl");
  const chrome = join(root, "chrome");
  const engine = join(root, "agent-browser");
  const append = `appendFileSync(${JSON.stringify(captures)}, JSON.stringify(record) + '\\n');`;
  writeFileSync(chrome, `#!${process.execPath}\nconst {appendFileSync} = require('node:fs');\nconst record = {kind:'chrome',home:process.env.HOME,userprofile:process.env.USERPROFILE,args:process.argv.slice(2)};\n${append}\n`, { mode: 0o700 });
  writeFileSync(engine, `#!${process.execPath}\nconst {appendFileSync,mkdirSync} = require('node:fs');
const {join} = require('node:path'); const {spawnSync} = require('node:child_process');
const record = {kind:'agent',home:process.env.HOME,userprofile:process.env.USERPROFILE,args:process.argv.slice(2),executable:process.env.AGENT_BROWSER_EXECUTABLE_PATH,config:process.env.AGENT_BROWSER_CONFIG};
${append}
if (process.argv[2] === 'record') {
  const profile = join(process.env.TMPDIR, 'recorded-profile'); mkdirSync(profile,{recursive:true});
  const args = ['--headless=new','--user-data-dir='+profile,...(process.env.AGENT_BROWSER_ARGS || '').split('\\n').filter(Boolean)];
  const result = spawnSync(process.env.AGENT_BROWSER_EXECUTABLE_PATH,args,{env:process.env,encoding:'utf8',timeout:5000});
  if (result.status !== 0) { process.stderr.write(result.stderr || String(result.error)); process.exit(1); }
}
console.log(JSON.stringify({success:true,data:{synthetic:true}}));\n`, { mode: 0o700 });
  const out = join(root, "out");
  const home = mode === "default-home" ? undefined : join(root, "fixture-home");
  if (home) mkdirSync(home);
  const env = { PATH: dirname(process.execPath), HOME: "parent-home-canary", USERPROFILE: "parent-home-canary",
    ...(mode === "legacy-shell" ? { OMB_BROWSER_LEGACY_SHELL: "1" } : {}) };
  let expected = "";
  await withBotBrowser({ engine, chrome, out, home, env }, async (call, _gated, launcher) => {
    expected = fixture.launchers[0]!.home!;
    expect(expected).not.toBe(userInfo().homedir);
    expect(expected).not.toBe("parent-home-canary");
    if (home) expect(expected).toBe(home);
    else { expect(expected.startsWith(`${out}/run-`)).toBe(true); expect(expected.endsWith("/home")).toBe(true); }
    expect(fixture.launchers[0]!.env).toMatchObject({ HOME: expected, USERPROFILE: expected });
    if (mode === "legacy-shell") {
      expect(launcher.plan()).toMatchObject({ kind: "legacy", reason: "OMB_BROWSER_LEGACY_SHELL=1" });
      expect(fixture.calibration).toEqual([]);
      expect(existsSync(launcher.path)).toBe(false);
    } else {
      const wrapper = readFileSync(launcher.path, "utf8");
      expect(wrapper).toContain(`HOME='${expected}'`);
      expect(wrapper).not.toContain(`HOME='${userInfo().homedir}'`);
      expect(fixture.calibration).toHaveLength(1);
      expect(fixture.calibration[0]).toMatchObject({ HOME: expected, USERPROFILE: expected });
    }
    await call("fixture_record", {});
  });
  const records: Capture[] = readFileSync(captures, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  for (const record of records) {
    expect(record.home).toBe(expected); expect(record.userprofile).toBe(expected);
    expect(record.home).not.toBe(userInfo().homedir);
  }
  const agent = records.find((record) => record.kind === "agent" && record.args[0] === "record")!;
  expect(agent).toBeDefined();
  expect(agent.config?.startsWith(`${expected}/`)).toBe(true);
  expect(agent.executable === chrome).toBe(mode === "legacy-shell");
  const opened = records.find((record) => record.kind === "chrome" && record.args.some((arg) => arg.startsWith("--user-data-dir=")))!;
  expect(opened).toBeDefined();
  expect(opened.args.find((arg) => arg.startsWith("--user-data-dir="))?.startsWith(`--user-data-dir=${out}/run-`)).toBe(true);
  if (process.platform === "darwin") expect(opened.args).toContain("--use-mock-keychain");
});
