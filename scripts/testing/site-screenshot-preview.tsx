import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { setAnalyticsEnabled, setEmailGateDone } from "../../src/lib/analytics";
import { setAdvancedMode } from "../../src/lib/interface-mode";
import { setLanguageChoice, loadPageLanguage } from "../../src/lib/language-preference";
import { NOTICES, GROK_MOVE_NOTICE } from "../../src/lib/notices";
import { markSimpleModePromptSeen } from "../../src/lib/simple-mode-prompt";
import { applySkin, type SkinId } from "../../src/lib/skins";
import "../../src/styles.css";

setAnalyticsEnabled(false);
setEmailGateDone("skipped");
setAdvancedMode(false);
setLanguageChoice(new URLSearchParams(location.search).get("lang") === "en" ? "en" : "zh-CN");
await loadPageLanguage();
markSimpleModePromptSeen();
for (const notice of [...NOTICES, GROK_MOVE_NOTICE]) localStorage.setItem(notice, "1");
applySkin((new URLSearchParams(location.search).get("skin") ?? "midnight") as SkinId);
createRoot(document.getElementById("root")!).render(<App />);
