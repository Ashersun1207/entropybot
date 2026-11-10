import { userInfo } from "node:os";
import { describe, expect, it } from "vitest";

import { chromeLaunchArgs, chromeLaunchEnv } from "./chrome-pipe.ts";

describe("the test Chrome launcher", () => {
  it("keeps Chrome off the person's keychain on macOS and keyring on Linux", () => {
    expect(chromeLaunchArgs("/profile", [], "darwin")).toContain("--use-mock-keychain");
    expect(chromeLaunchArgs("/profile", [], "darwin")).not.toContain("--password-store=basic");
    expect(chromeLaunchArgs("/profile", [], "linux")).toContain("--password-store=basic");
    expect(chromeLaunchArgs("/profile", [], "win32").filter((arg) => /keychain|password-store/.test(arg))).toEqual([]);
    expect(chromeLaunchArgs("/profile", ["--proxy-server=socks5://127.0.0.1:1"], process.platform)).toEqual(expect.arrayContaining(["--remote-debugging-pipe", "--user-data-dir=/profile", "--proxy-server=socks5://127.0.0.1:1"]));
  });

  it("uses an explicitly injected home instead of the caller's home", () => {
    const home = process.env.HOME!;
    expect(home).not.toBe(userInfo().homedir);
    expect(chromeLaunchEnv({ HOME: "ignored", PATH: "/bin" }, "darwin", home)).toEqual({ HOME: home, PATH: "/bin" });
    expect(chromeLaunchEnv({ USERPROFILE: "ignored" }, "win32", home).USERPROFILE).toBe(home);
  });

  it.each(["darwin", "linux", "win32"] as const)("preserves the caller's synthetic home on %s", (platform) => {
    const home = process.env.HOME!;
    expect(home).not.toBe(userInfo().homedir);
    const env = { HOME: home, USERPROFILE: `${home}/windows`, PATH: "/bin" };
    const launched = chromeLaunchEnv(env, platform);
    expect(launched).toEqual(env);
    expect(launched[platform === "win32" ? "USERPROFILE" : "HOME"]).not.toBe(userInfo().homedir);
    expect(env).toEqual({ HOME: home, USERPROFILE: `${home}/windows`, PATH: "/bin" });
  });

  it("defaults to the current caller environment", () => {
    expect(chromeLaunchEnv()).toEqual(process.env);
    expect(chromeLaunchEnv().HOME).not.toBe(userInfo().homedir);
  });

  it.each(["darwin", "linux", "win32"] as const)("does not invent an account home for an absent or empty home on %s", (platform) => {
    expect(chromeLaunchEnv({ PATH: "/bin" }, platform)).toEqual({ PATH: "/bin" });
    expect(chromeLaunchEnv({ HOME: "", USERPROFILE: "" }, platform)).toEqual({ HOME: "", USERPROFILE: "" });
  });

  it("retains an explicit known account home override", () => {
    const home = userInfo().homedir;
    expect(chromeLaunchEnv({ HOME: "synthetic" }, "darwin", home).HOME).toBe(home);
    expect(chromeLaunchEnv({ USERPROFILE: "synthetic" }, "win32", home).USERPROFILE).toBe(home);
  });
});
