import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSecureCredentialIO } from "./secure-credential-io.mjs";

const directories = [];
const workspace = () => {
  const directory = mkdtempSync(join(tmpdir(), "entropybot-credential-io-"));
  directories.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const fakeStorage = (over = {}) => ({
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (value) => Buffer.from(value, "utf8"),
  decryptStringAsync: async (buffer) => ({ result: buffer.toString("utf8") }),
  ...over,
});

const io = (over = {}) => {
  const file = join(workspace(), "credentials.bin");
  return {
    file,
    io: createSecureCredentialIO({
      file,
      safeStorage: fakeStorage(),
      isPackaged: true,
      platform: "darwin",
      ...over,
    }),
  };
};

describe("createSecureCredentialIO", () => {
  it("loads a readable store and allows saving", async () => {
    const { file, io: store } = io();
    writeFileSync(file, Buffer.from(JSON.stringify({ xaiApiKey: "synthetic" })));
    await expect(store.load()).resolves.toEqual({ xaiApiKey: "synthetic" });
    expect(store.unavailable()).toBe(false);
    await store.save({ xaiApiKey: "replacement" });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ xaiApiKey: "replacement" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("uses a successful legacy migration instead of reporting the old store unreadable", async () => {
    const migrate = vi.fn().mockResolvedValue({ memoryEmbeddingKey: "synthetic-legacy" });
    const { io: store } = io({
      read: async () => ({ status: "unavailable", credentials: {}, error: "wrong key" }),
      migrate,
    });
    await expect(store.load()).resolves.toEqual({ memoryEmbeddingKey: "synthetic-legacy" });
    expect(store.unavailable()).toBe(false);
    expect(migrate).toHaveBeenCalledWith(expect.objectContaining({ file: expect.any(String), markerFile: expect.any(String) }));
  });

  it("stays unwritable and reports unavailable when migration does not recover the store", async () => {
    const { io: store } = io({
      read: async () => ({ status: "unavailable", credentials: {}, error: "wrong key" }),
      migrate: async () => null,
    });
    await expect(store.load()).resolves.toEqual({});
    expect(store.unavailable()).toBe(true);
    await expect(store.save({ xaiApiKey: "must-not-write" })).rejects.toThrow(/could not be read/);
  });

  it("keeps the launch alive and unwritable when the migration itself throws", async () => {
    const { io: store } = io({
      read: async () => ({ status: "unavailable", credentials: {}, error: "wrong key" }),
      migrate: async () => { throw new Error("unexpected"); },
    });
    await expect(store.load()).resolves.toEqual({});
    expect(store.unavailable()).toBe(true);
    await expect(store.save({ key: "must-not-write" })).rejects.toThrow(/could not be read/);
  });

  it("does not attempt the macOS migration outside packaged macOS", async () => {
    const migrate = vi.fn();
    const { io: store } = io({
      read: async () => ({ status: "unavailable", credentials: {}, error: "wrong key" }),
      migrate,
      isPackaged: false,
    });
    await store.load();
    expect(migrate).not.toHaveBeenCalled();
    expect(store.unavailable()).toBe(true);
  });

  it("refuses to save when encryption is unavailable", async () => {
    const { io: store } = io({ safeStorage: fakeStorage({ isAsyncEncryptionAvailable: async () => false }) });
    await expect(store.save({ xaiApiKey: "synthetic" })).rejects.toThrow(/unavailable/);
  });
});
