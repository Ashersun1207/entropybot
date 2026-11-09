export const siteEnglish = new URLSearchParams(location.search).get("lang") === "en";
export const siteLanguage = siteEnglish ? "en" : "zh-CN";
export const siteText = (chinese: string, english: string): string => siteEnglish ? english : chinese;
document.documentElement.lang = siteLanguage;
document.title = siteText("Entropybot · 合成示例", "Entropybot · Synthetic example");
