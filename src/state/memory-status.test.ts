import { expect, it } from "vitest";
import { configStatusFromFrame, type ConfigStatusFrame } from "./store";

it("retains memory status when a config websocket frame replaces the current status", () => {
  const frame: ConfigStatusFrame = {
    composio: { configured: false }, box: { configured: false }, vps: { configured: false, sshAlias: "" },
    rooms: { turnTimeoutMinutes: 10 }, localVm: { mode: "shared", maxInstances: 1 },
    memoryEmbedding: { enabled: true, configured: true, storage: "secure", url: "https://embedding.example.test/v1/embeddings", model: "synthetic", dimensions: 1024, timeoutMs: 8000 },
  };
  expect(configStatusFromFrame(frame).memoryEmbedding).toEqual(frame.memoryEmbedding);
});
