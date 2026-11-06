export const WORKSPACE_CREDENTIALS = [
  { section: "memoryEmbedding", field: "key", name: "memoryEmbeddingKey", env: "OMB_MEMORY_EMBEDDING_KEY" },
  { section: "xai", field: "key", name: "xaiApiKey", env: "XAI_API_KEY" },
  { section: "box", field: "token", name: "boxToken", env: "BOX_TOKEN" },
  { section: "tts", field: "key", name: "ttsKey", env: "OMB_TTS_KEY" },
  { section: "tts", field: "fishKey", name: "fishAudioKey", env: "OMB_FISH_AUDIO_API_KEY" },
  { section: "tts", field: "geminiKey", name: "geminiTtsKey", env: "OMB_GEMINI_API_KEY" },
  { section: "decider", field: "key", name: "jevApiKey", env: "OMB_JEV_API_KEY" },
  { section: "decider", field: "openrouterKey", name: "openrouterDeciderKey", env: "OMB_OPENROUTER_DECIDER_KEY" },
  { section: "decider", field: "workersAiToken", name: "workersAiToken", env: "OMB_WORKERS_AI_TOKEN" },
  { section: "imageGen", field: "key", name: "openaiImageApiKey", env: "OMB_OPENAI_IMAGE_KEY" },
  { section: "imageGen", field: "customApiKey", name: "customImageApiKey", env: "OMB_CUSTOM_IMAGE_KEY" },
  { section: "live", field: "key", name: "openaiLiveKey", env: "OMB_OPENAI_LIVE_KEY" },
  { section: "treg", field: "key", name: "tregApiKey", env: "OMB_TREG_KEY" },
  { section: "postiz", field: "key", name: "postizApiKey", env: "OMB_POSTIZ_API_KEY" },
  { section: "opencodeGo", field: "apiKey", name: "opencodeGoApiKey", env: "OPENCODE_API_KEY" },
];

/** Moves plaintext secrets into the store and deletes the field. "" never drops a stored secret: every packaged
 * credential save writes an empty tombstone to config.json. The caller persists credentials before config. */
export function migrateWorkspaceCredentials(config, credentials) {
  const nextConfig = structuredClone(config ?? {});
  const nextCredentials = { ...credentials };
  let configChanged = false;
  let credentialsChanged = false;
  for (const { section, field, name } of WORKSPACE_CREDENTIALS) {
    const home = nextConfig?.[section];
    if (!home || typeof home !== "object" || Array.isArray(home)) continue;
    if (!Object.hasOwn(home, field)) continue;
    const value = home[field];
    if (typeof value !== "string") continue;
    const secret = value.trim();
    // A durable empty slot suppresses the legacy environment fallback even after config migration removes its tombstone.
    if (name === "memoryEmbeddingKey" && !secret && typeof nextCredentials[name] !== "string") {
      nextCredentials[name] = "";
      credentialsChanged = true;
    }
    const memorySlotIsAuthoritative = name === "memoryEmbeddingKey" && typeof nextCredentials[name] === "string";
    if (secret && nextCredentials[name] !== secret && !memorySlotIsAuthoritative) {
      nextCredentials[name] = secret;
      credentialsChanged = true;
    }
    delete home[field];
    configChanged = true;
  }
  return { config: nextConfig, credentials: nextCredentials, configChanged, credentialsChanged };
}

export async function persistWorkspaceCredentialMigration(config, credentials, { saveCredentials, saveConfig }) {
  const migrated = migrateWorkspaceCredentials(config, credentials);
  if (migrated.credentialsChanged) await saveCredentials(migrated.credentials);
  if (migrated.configChanged) await saveConfig(migrated.config);
  return migrated;
}

export function withWorkspaceCredential(credentials, name, secret) {
  const next = { ...credentials };
  if (secret || name === "memoryEmbeddingKey") next[name] = secret;
  else delete next[name];
  return next;
}

export function workspaceCredentialEnv(credentials) {
  const env = {};
  for (const { name, env: envName } of WORKSPACE_CREDENTIALS) {
    const value = credentials?.[name];
    if (typeof value === "string" && (value || name === "memoryEmbeddingKey")) env[envName] = value;
  }
  if (env.OMB_MEMORY_EMBEDDING_KEY) env.OMB_MEMORY_EMBEDDING_STORAGE = "secure";
  return env;
}
