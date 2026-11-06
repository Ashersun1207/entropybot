import { describe, expect, it, vi } from "vitest";
import { assertCredentialStorage, CREDENTIAL_PATCH } from "./credential-patch.mjs";
import { createSecureCredentialState } from "./secure-credential-state.mjs";
import { migrateWorkspaceCredentials, persistWorkspaceCredentialMigration, withWorkspaceCredential, workspaceCredentialEnv } from "./workspace-credentials.mjs";

const config = () => ({ memoryEmbedding: { enabled: true, key: "fixture-memory-old", model: "fixture-model" }, profile: { name: "Fixture" } });

describe("memory credential storage", () => {
  it("refuses the dev plaintext fallback for saves and removals", () => {
    expect(() => assertCredentialStorage("memoryEmbeddingKey", false)).toThrow("encrypted credential store");
    expect(() => assertCredentialStorage("memoryEmbeddingKey", true)).not.toThrow();
    expect(CREDENTIAL_PATCH.memoryEmbeddingKey("fixture-new")).toEqual({ memoryEmbedding: { key: "fixture-new" } });
    expect(CREDENTIAL_PATCH.memoryEmbeddingKey("")).toEqual({ memoryEmbedding: { key: "" } });
  });

  it("persists encryption before deleting plaintext and leaves unrelated slots intact", async () => {
    const order = [];
    let stored;
    let disk = config();
    const result = await persistWorkspaceCredentialMigration(disk, { boxToken: "fixture-box" }, {
      saveCredentials: async (value) => { order.push("encrypted"); stored = value; },
      saveConfig: async (value) => { order.push("config"); disk = value; },
    });
    expect(order).toEqual(["encrypted", "config"]);
    expect(stored).toEqual({ boxToken: "fixture-box", memoryEmbeddingKey: "fixture-memory-old" });
    expect(disk.memoryEmbedding).toEqual({ enabled: true, model: "fixture-model" });
    expect(workspaceCredentialEnv(result.credentials)).toEqual({ BOX_TOKEN: "fixture-box", OMB_MEMORY_EMBEDDING_KEY: "fixture-memory-old", OMB_MEMORY_EMBEDDING_STORAGE: "secure" });
  });

  it("replaces an unusable memory slot before removing its only plaintext key", async () => {
    const saved = vi.fn();
    const result = await persistWorkspaceCredentialMigration(config(), { memoryEmbeddingKey: 42, boxToken: "fixture-box" }, { saveCredentials: saved, saveConfig: vi.fn() });
    expect(saved).toHaveBeenCalledWith({ memoryEmbeddingKey: "fixture-memory-old", boxToken: "fixture-box" });
    expect(result.config.memoryEmbedding).not.toHaveProperty("key");
  });

  it("preserves plaintext and other slots when the credential store is locked", async () => {
    const disk = config();
    const other = { boxToken: "fixture-box" };
    const saveConfig = vi.fn();
    await expect(persistWorkspaceCredentialMigration(disk, other, {
      saveCredentials: async () => { throw new Error("fixture locked store"); }, saveConfig,
    })).rejects.toThrow("fixture locked store");
    expect(saveConfig).not.toHaveBeenCalled();
    expect(disk).toEqual(config());
    expect(other).toEqual({ boxToken: "fixture-box" });
  });

  it("recovers after config persistence failure without losing either copy", async () => {
    const disk = config();
    let encrypted = { boxToken: "fixture-box" };
    await expect(persistWorkspaceCredentialMigration(disk, encrypted, {
      saveCredentials: async (value) => { encrypted = value; },
      saveConfig: async () => { throw new Error("fixture config write failed"); },
    })).rejects.toThrow("fixture config write failed");
    expect(disk.memoryEmbedding.key).toBe("fixture-memory-old");
    expect(encrypted.memoryEmbeddingKey).toBe("fixture-memory-old");
    const saveCredentials = vi.fn();
    const result = await persistWorkspaceCredentialMigration(disk, encrypted, { saveCredentials, saveConfig: vi.fn() });
    expect(saveCredentials).not.toHaveBeenCalled();
    expect(result.config.memoryEmbedding).not.toHaveProperty("key");
  });

  it("rolls back replacement and removal if the harness rejects the secure transaction", async () => {
    for (const value of ["fixture-new", ""]) {
      const original = { memoryEmbeddingKey: "fixture-old", boxToken: "fixture-box" };
      const writes = [];
      const state = createSecureCredentialState(original, async (document) => writes.push(document));
      await expect(state.update((document) => withWorkspaceCredential(document, "memoryEmbeddingKey", value),
        async () => { throw new Error("fixture harness failure"); })).rejects.toThrow("fixture harness failure");
      expect(state.read()).toEqual(original);
      expect(writes.at(-1)).toEqual(original);
    }
  });

  it("preserves a cleared memory credential across boot migration and the encrypted-write/config-write crash window", async () => {
    const stored = withWorkspaceCredential({ boxToken: "fixture-box", memoryEmbeddingKey: "fixture-old" }, "memoryEmbeddingKey", "");
    expect(stored).toEqual({ boxToken: "fixture-box", memoryEmbeddingKey: "" });
    for (const disk of [{ memoryEmbedding: { enabled: true } }, { memoryEmbedding: { key: "", enabled: true } }, { memoryEmbedding: { key: "fixture-stale-plaintext", enabled: true } }]) {
      const reboot = migrateWorkspaceCredentials(disk, stored);
      expect(reboot.credentials.memoryEmbeddingKey).toBe("");
      expect(workspaceCredentialEnv(reboot.credentials)).toMatchObject({ OMB_MEMORY_EMBEDDING_KEY: "", BOX_TOKEN: "fixture-box" });
      expect(workspaceCredentialEnv(reboot.credentials)).not.toHaveProperty("OMB_MEMORY_EMBEDDING_STORAGE");
    }
    const replacement = migrateWorkspaceCredentials(config(), { memoryEmbeddingKey: "fixture-new-encrypted" });
    expect(replacement.credentials.memoryEmbeddingKey).toBe("fixture-new-encrypted");
    expect(replacement.config.memoryEmbedding).not.toHaveProperty("key");
    const migratedEmpty = await persistWorkspaceCredentialMigration({ memoryEmbedding: { key: "" } }, {}, { saveCredentials: vi.fn(), saveConfig: vi.fn() });
    expect(migratedEmpty.credentials).toEqual({ memoryEmbeddingKey: "" });
    expect(migratedEmpty.config.memoryEmbedding).not.toHaveProperty("key");
  });

  it("does not overwrite any slot after an unreadable encrypted document", async () => {
    const persist = vi.fn();
    const state = createSecureCredentialState({}, persist, { writable: false });
    await expect(state.update((value) => ({ ...value, memoryEmbeddingKey: "fixture-new" }))).rejects.toThrow("could not be read");
    expect(persist).not.toHaveBeenCalled();
  });
});
