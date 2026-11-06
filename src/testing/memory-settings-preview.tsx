import { useEffect, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { SettingsModal } from "../components/SettingsModal";
import { api, BotEditorStore, initialState, reducer, type ConfigStatus } from "../state/store";
import { loadLocale } from "../lib/i18n";
import { setAdvancedMode } from "../lib/interface-mode";
import { applySkin, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
await loadLocale(params.get("language") ?? "zh-CN");
setAdvancedMode(params.get("mode") === "advanced");
applySkin((params.get("skin") ?? "daylight") as SkinId);
let status: ConfigStatus;
if (params.has("bridge")) {
  window.ogb = {
    platform: "darwin",
    setCredential: async (slot, value) => {
      if (slot !== "memoryEmbeddingKey") throw new Error("unexpected_fixture_slot");
      status = { ...status, memoryEmbedding: { ...status.memoryEmbedding!, configured: Boolean(value), storage: value ? "secure" : "none" } };
      return status;
    },
  } as NonNullable<Window["ogb"]>;
}
function Preview() {
  const [state, dispatch] = useReducer(reducer, { ...initialState, appSettingsSection: "memory" });
  useEffect(() => {
    void api<ConfigStatus>("/__memory-fixture/status").then((config) => {
      status = config;
      dispatch({ type: "configStatus", config });
    });
  }, []);
  return <BotEditorStore value={{ state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}><SettingsModal /></BotEditorStore>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
