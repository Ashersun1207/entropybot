import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { chromeFingerprint, identityFile } from "../../server/browser/chrome/calibrate.ts";
import { isHeadlessShell } from "../../server/browser/chrome/resolve.ts";
import { credentialStoreFlags } from "../../server/browser/egress/gate.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { launchVerificationServer, verificationServerEnvironment, type VerificationServer } from "../control-omb.ts";

it("supplies only the fixture-owned browser home, including on restart environments", () => {
  const env = verificationServerEnvironment({ HOME: "/unowned", OMB_TEST_BROWSER_HOME: "/unowned" }, "/owned", 19000);
  expect(env.OMB_TEST_BROWSER_HOME).toBe("/owned");
  expect(env.HOME).toBe("/owned");
});

type Child = { HOME: string; USERPROFILE: string; argv: string[]; pid: number; ppid: number };
const identity = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
  userAgentMetadata: {
    brands: [{ brand: "Google Chrome", version: "155" }], fullVersionList: [{ brand: "Google Chrome", version: "155.0.1.2" }],
    fullVersion: "155.0.1.2", platform: "macOS", platformVersion: "26.3.1", architecture: "arm", model: "", mobile: false,
    bitness: "64", wow64: false, formFactors: ["Desktop"],
  },
  product: "Chrome/155.0.1.2", calibratedAt: "2026-11-11T00:00:00Z",
};

async function probe(seed: boolean, fullChrome?: string) {
  const root = mkdtempSync(join(tmpdir(), "omb-fixture-home-"));
  const records = join(root, "children.jsonl"), recorder = join(root, "owned-chrome");
  writeFileSync(recorder, `#!/usr/bin/python3\nimport json, os, sys\nwith open(${JSON.stringify(records)}, 'a') as out:\n out.write(json.dumps({'HOME':os.environ.get('HOME'), 'USERPROFILE':os.environ.get('USERPROFILE'), 'argv':sys.argv[1:], 'pid':os.getpid(), 'ppid':os.getppid()})+'\\n')\n${fullChrome ? `os.execv(${JSON.stringify(fullChrome)}, [${JSON.stringify(fullChrome)}, *sys.argv[1:]])` : "sys.exit(0 if '--version' in sys.argv else 3)"}\n`, { mode: 0o700 });
  const children = (): Child[] => existsSync(records) ? readFileSync(records, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as Child) : [];
  let fixture: VerificationServer | undefined;
  try {
    fixture = await launchVerificationServer({}, undefined, undefined, {
      binaryPath: process.env.OMB_FIXTURE_HOME_BINARY ?? process.execPath, executablePath: recorder,
    }, undefined, undefined, [], undefined, undefined, dataDir => {
      if (!seed) return;
      const file = identityFile(dataDir, recorder);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ ...identity, fingerprint: chromeFingerprint(recorder) }));
    });
    await expect.poll(() => children().some(child => seed || fullChrome ? child.argv.includes("--version") : child.argv.includes("--remote-debugging-pipe")), { timeout: 20000 }).toBe(true);
    const owners = new Set([fixture.info.pid]);
    if (seed) {
      await fixture.restart(undefined, { env: { AGENT_BROWSER_EXECUTABLE_PATH: recorder } });
      owners.add(fixture.info.pid);
      await expect.poll(() => children().filter(child => child.argv.includes("--version")).length, { timeout: 20000 }).toBe(2);
      expect(children().at(-1)!.ppid).toBe(fixture.info.pid);
    }
    const observed = children();
    expect(observed.length).toBeGreaterThan(0);
    if (!seed) expect(observed.some(child => child.argv.includes("--remote-debugging-pipe"))).toBe(true);
    if (seed || fullChrome) expect(observed.some(child => child.argv.includes("--version"))).toBe(true);
    // The recorder is the actual calibration executable or the generated wrapper's exec target.
    for (const child of observed) {
      expect(child.HOME).toBe(fixture.info.dataDir);
      expect(child.HOME).not.toBe(userInfo().homedir);
      expect(child.USERPROFILE).toBe(fixture.info.dataDir);
      expect(owners.has(child.ppid)).toBe(true);
      expect(child.argv).toEqual(expect.arrayContaining(credentialStoreFlags()));
    }
    expect(readFileSync(fixture.info.logPath, "utf8")).not.toContain("downloading:");
  } finally {
    if (fixture) {
      writeFileSync(`${fixture.info.logPath}.fixture-home.json`, JSON.stringify({ seed, fullChrome: fullChrome ?? null, home: fixture.info.dataDir, children: children() }, null, 2));
      await fixture.close();
      expect(existsSync(fixture.info.dataDir)).toBe(false);
    }
    await removeTempDir(root);
  }
}

it.runIf(process.platform !== "win32")("keeps the real fixture server's calibration child in its owned home (failing executable stand-in)", async () => {
  await probe(false);
}, 40000);

it.runIf(process.platform !== "win32")("keeps the real fixture server's generated wrapper --version child in its owned home (cached identity stand-in)", async () => {
  await probe(true);
}, 40000);

const fullChrome = process.env.OMB_FIXTURE_HOME_CHROME;
it.runIf(process.platform !== "win32" && Boolean(fullChrome))("keeps full Chrome calibration and generated wrapper children in the real fixture server's home", async () => {
  expect(existsSync(fullChrome!)).toBe(true);
  expect(isHeadlessShell(fullChrome!)).toBe(false);
  await probe(false, fullChrome);
}, 60000);
