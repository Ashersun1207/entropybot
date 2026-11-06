// Verifies the Entropybot patch inventory still points at real files and tests.
import { existsSync } from "node:fs";

const required = [
  "server/memory-embeddings.ts",
  "server/memory-retrieval.ts",
  "server/memory-embedding-config.ts",
  "server/memory-embedding-client.ts",
  "server/routes/memory-embedding.ts",
  "server/memory-embedding-settings.e2e.test.ts",
  "electron/memory-credentials.test.mjs",
  "src/components/MemorySettings.tsx",
  "src/components/MemorySettings.test.ts",
  "server/recall.ts",
  "server/context-rebuild.ts",
  "server/drivers/chat-delivered-replay.ts",
  "server/drivers/chat-size-limit.ts",
  "electron/update-policy.mjs",
  "electron/entropybot-updater.test.mjs",
  "server/update-check.test.ts",
  "scripts/entropybot-release.mjs",
  ".github/workflows/entropybot-release.yml",
  ".github/workflows/entropybot-ci.yml",
  "docs/ENTROPYBOT_PATCHES.md",
  "NOTICE",
  "LICENSE",
];

const missing = required.filter((file) => !existsSync(file));
if (missing.length) {
  console.error(`Patch inventory references missing paths:\n${missing.join("\n")}`);
  process.exit(1);
}
console.log(`Patch inventory OK (${required.length} paths)`);
