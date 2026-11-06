import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_DIR, loadConfig, parseConfigPatch, saveConfig, stripWorkspaceCredentialEnv, syncCredentialEnv } from "./config.ts";
import { memoryEmbeddingEnv, memoryEmbeddingStatus } from "./memory-embedding-config.ts";
import { memoryEmbeddingSettings } from "./memory-embeddings.ts";
import { chatMcpEnvironment } from "./drivers/chat-mcp-tools.ts";

beforeEach(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  for (const name of ["OMB_MEMORY_EMBEDDING_KEY", "OMB_MEMORY_EMBEDDING_STORAGE", "DASHSCOPE_API_KEY", "OMB_MEMORY_EMBEDDING_URL", "OMB_MEMORY_EMBEDDING_MODEL", "OMB_CREDENTIAL_STORE"]) vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("memory embedding configuration", () => {
  it("persists partial settings without clearing the saved key or other parameters", () => {
    saveConfig({ memoryEmbedding: { key: "fixture-plaintext", url: "https://embedding.example/v1/embeddings", model: "fixture-model", dimensions: 64, timeoutMs: 500 } });
    saveConfig(parseConfigPatch({ memoryEmbedding: { enabled: true } }));
    expect(loadConfig().memoryEmbedding).toMatchObject({ enabled: true, key: "fixture-plaintext", model: "fixture-model", dimensions: 64, timeoutMs: 500 });
    const status = memoryEmbeddingStatus(loadConfig());
    expect(status).toMatchObject({ enabled: true, configured: true, storage: "plaintext" });
    expect(status).not.toHaveProperty("key");
    expect(JSON.stringify(status)).not.toContain("fixture-plaintext");
    expect(readFileSync(join(DATA_DIR, "config.json"), "utf8")).toContain("fixture-model");
  });

  it("projects secure, environment, unavailable and empty sources without exposing a key", () => {
    vi.stubEnv("DASHSCOPE_API_KEY", "fixture-legacy");
    expect(memoryEmbeddingStatus({ memoryEmbedding: memoryEmbeddingEnv() }).storage).toBe("environment");
    vi.stubEnv("OMB_MEMORY_EMBEDDING_KEY", "fixture-secure");
    vi.stubEnv("OMB_MEMORY_EMBEDDING_STORAGE", "secure");
    expect(memoryEmbeddingStatus({ memoryEmbedding: memoryEmbeddingEnv() }).storage).toBe("secure");
    expect(memoryEmbeddingStatus({ memoryEmbedding: memoryEmbeddingEnv({ key: "fixture-unmigrated" }) }).storage).toBe("plaintext");
    vi.stubEnv("OMB_CREDENTIAL_STORE", "unavailable");
    expect(memoryEmbeddingStatus({ memoryEmbedding: memoryEmbeddingEnv() }).storage).toBe("unavailable");
    vi.stubEnv("OMB_CREDENTIAL_STORE", undefined);
    vi.stubEnv("OMB_MEMORY_EMBEDDING_KEY", "");
    expect(memoryEmbeddingStatus({ memoryEmbedding: memoryEmbeddingEnv() })).toMatchObject({ storage: "none", configured: false });
  });

  it("keeps explicit removal across a restart and does not change the legacy operator variable", () => {
    vi.stubEnv("DASHSCOPE_API_KEY", "fixture-operator");
    saveConfig({ memoryEmbedding: { enabled: true, key: "" } });
    syncCredentialEnv({ memoryEmbedding: { key: "" } }, true);
    expect(process.env.DASHSCOPE_API_KEY).toBe("fixture-operator");
    expect(memoryEmbeddingSettings(loadConfig())).toBeNull();
    vi.stubEnv("OMB_MEMORY_EMBEDDING_KEY", undefined);
    expect(memoryEmbeddingSettings(loadConfig())).toBeNull();
    expect(memoryEmbeddingStatus(loadConfig()).configured).toBe(false);
  });

  it.each([null, { key: null }, { dimensions: null }, { unknown: true }, { dimensions: 1 }, { timeoutMs: 10 }])("rejects invalid memory settings %j", (memoryEmbedding) => {
    expect(() => parseConfigPatch(JSON.parse(JSON.stringify({ memoryEmbedding })))).toThrow();
  });

  it.each(["file:///fixture", "ftp://embedding.example", "https://user:fixture-secret@embedding.example", "https://embedding.example/?key=fixture-secret", "https://embedding.example/#fragment", "http://169.254.169.254/latest/meta-data", "https://169.254.169.254/", "https://[fd00:ec2::254]/", "https://[fe80::1]/", "http://public.example/embeddings"])('rejects unsafe saved endpoint %s', (url) => {
    expect(() => parseConfigPatch({ memoryEmbedding: { url } })).toThrow();
  });

  it("strips inherited memory keys from engines and an actual fake MCP child environment", async () => {
    const source = { OMB_MEMORY_EMBEDDING_KEY: "fixture-own", DASHSCOPE_API_KEY: "fixture-legacy", omb_memory_embedding_key: "fixture-lower", KEEP: "value" };
    const child = { ...source };
    stripWorkspaceCredentialEnv(child);
    expect(child).toEqual({ KEEP: "value" });
    const mcp = chatMcpEnvironment({ OWN_MCP_VALUE: "fixture-explicit" }, source);
    expect(JSON.stringify(mcp)).not.toContain("fixture-own");
    expect(JSON.stringify(mcp)).not.toContain("fixture-legacy");
    expect(JSON.stringify(mcp)).not.toContain("fixture-lower");
    expect(mcp).toMatchObject({ KEEP: "value", OWN_MCP_VALUE: "fixture-explicit" });
    const childResult = await promisify(execFile)(process.execPath, ["-e", 'process.stdout.write(JSON.stringify({own:process.env.OMB_MEMORY_EMBEDDING_KEY,legacy:process.env.DASHSCOPE_API_KEY,lower:process.env.omb_memory_embedding_key,keep:process.env.KEEP}))'], { env: mcp });
    expect(JSON.parse(childResult.stdout)).toEqual({ keep: "value" });
    expect(source.DASHSCOPE_API_KEY).toBe("fixture-legacy");
  });
});
