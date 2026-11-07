import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { calibrateIdentity } from "./calibrate.ts";
import { ChromeLaunchError, launchChrome } from "./launch.ts";
import { CdpBrowser } from "../cdp/browser.ts";
import { FAKE_IDENTITY } from "../testing/fake-chrome.ts";

vi.mock("./launch.ts", async (original) => ({ ...await original<typeof import("./launch.ts")>(), launchChrome: vi.fn() }));
vi.mock("node:http", async (original) => {
  const actual = await original<typeof import("node:http")>();
  return { ...actual, createServer: vi.fn(actual.createServer) };
});
afterEach(() => { vi.restoreAllMocks(); vi.mocked(launchChrome).mockReset(); vi.mocked(createServer).mockClear(); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "omb-calibration-cleanup-"));
  const binary = join(root, "synthetic-chrome");
  writeFileSync(binary, "synthetic; never executed");
  const options = { executablePath: binary, host: "desktop" as const, home: root, tmpRoot: root };
  return { root, options, profiles: () => readdirSync(root).filter(name => name.startsWith("omb-calibrate-")) };
}

it("retains handshake-unknown profile and registry while closing its independent loopback", async () => {
  const f = fixture();
  vi.mocked(launchChrome).mockImplementationOnce(async (options) => {
    writeFileSync(join(options.userDataDir, "processes.json"), "synthetic registry evidence");
    throw new ChromeLaunchError("synthetic handshake cleanup unknown", "", { status: "unknown", userDataDir: options.userDataDir });
  });
  await expect(calibrateIdentity(f.options)).rejects.toMatchObject({ cleanup: { status: "unknown" } });
  expect(f.profiles()).toHaveLength(1);
  expect(existsSync(join(f.root, f.profiles()[0]!, "processes.json"))).toBe(true);
  const server = vi.mocked(createServer).mock.results.at(-1)!.value as Server;
  await expect.poll(() => server.listening).toBe(false);
});

it("closes the loopback independently when post-handshake Chrome cleanup rejects", async () => {
  const f = fixture();
  vi.mocked(launchChrome).mockImplementationOnce(async (options) => ({
    close: async () => { throw new ChromeLaunchError("synthetic close unknown", "", { status: "unknown", userDataDir: options.userDataDir }); },
    transport: {},
  }) as never);
  vi.spyOn(CdpBrowser, "connect").mockRejectedValueOnce(new Error("synthetic calibration init failure"));
  await expect(calibrateIdentity(f.options)).rejects.toMatchObject({ cleanup: { status: "unknown" } });
  expect(f.profiles()).toHaveLength(1);
  const server = vi.mocked(createServer).mock.results.at(-1)!.value as Server;
  await expect.poll(() => server.listening).toBe(false);
});

it("retains a successfully read calibration's profile on close failure while still closing the loopback", async () => {
  const f = fixture();
  const browserClose = vi.fn(async () => {});
  const tab = { navigate: async () => {}, evaluate: async () => ({ userAgent: FAKE_IDENTITY.userAgent,
    high: { ...FAKE_IDENTITY.userAgentMetadata, uaFullVersion: FAKE_IDENTITY.userAgentMetadata.fullVersion } }) };
  vi.mocked(launchChrome).mockImplementationOnce(async (options) => ({ transport: {}, version: { product: FAKE_IDENTITY.product },
    close: async () => { throw new ChromeLaunchError("synthetic final close unknown", "", { status: "unknown", userDataDir: options.userDataDir }); },
  }) as never);
  vi.spyOn(CdpBrowser, "connect").mockResolvedValueOnce({ waitForPage: async () => tab, close: browserClose } as never);
  await expect(calibrateIdentity(f.options)).rejects.toMatchObject({ cleanup: { status: "unknown" } });
  expect(browserClose).toHaveBeenCalledOnce();
  expect(f.profiles()).toHaveLength(1);
  const server = vi.mocked(createServer).mock.results.at(-1)!.value as Server;
  await expect.poll(() => server.listening).toBe(false);
});

it("removes a failed calibration profile only with structured confirmed-close evidence", async () => {
  const f = fixture();
  vi.mocked(launchChrome).mockImplementationOnce(async (options) => {
    throw new ChromeLaunchError("synthetic refused handshake after confirmed close", "", { status: "closed", userDataDir: options.userDataDir });
  });
  await expect(calibrateIdentity(f.options)).rejects.toMatchObject({ cleanup: { status: "closed" } });
  expect(f.profiles()).toEqual([]);
});
