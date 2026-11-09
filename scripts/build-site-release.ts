import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, lstatSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "entropybot-site-release-"));
const bundle = join(scratch, "bundle"), site = join(scratch, "site");
const entries = { product: "scripts/testing/site-interactive-preview.tsx", features: "scripts/testing/site-browser-features-entry.ts", hero: "scripts/testing/site-hero-avatar.tsx" };
await build({ configFile: false, root, publicDir: false, envDir: false, envPrefix: [], logLevel: "warn", base: "/ui/",
  plugins: [react(), tailwindcss()], resolve: { alias: { "@": join(root, "src") } },
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version) },
  build: { outDir: bundle, emptyOutDir: true, manifest: true, sourcemap: false, rollupOptions: { input: Object.fromEntries(Object.entries(entries).map(([key, path]) => [key, join(root, path)])) } },
});
function copy(source: string, target: string) { mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target); }
function copyTree(source: string, target: string) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) { if (entry.name.endsWith(".map")) throw new Error("Unexpected sourcemap"); copy(from, to); }
  }
}
copyTree(join(bundle, "assets"), join(site, "ui/assets"));
for (const path of execFileSync("git", ["ls-files", "-z", "--", "public"], { cwd: root }).toString().split("\0").filter(Boolean)) {
  if (lstatSync(join(root, path)).isFile()) copy(join(root, path), join(site, path.slice("public/".length)));
}
for (const name of ["index.html", "product.css", "language.js", "product-experience.js", "feature-experience.js"]) {
  const content = readFileSync(join(root, "site", name), "utf8");
  mkdirSync(site, { recursive: true });
  writeFileSync(join(site, name), name.endsWith(".js") ? content.replaceAll("'/product/connection'", "'/product/connection.json'") : content);
}
for (const file of ["app-icon-128.png", "hero-mascot.svg", "product-ui-dark.webp", "product-ui-light.webp"]) {
  const source = join(root, "site/assets", file);
  if (!lstatSync(source).isFile()) throw new Error(`Missing website asset: ${file}`);
  copy(source, join(site, "assets", file));
}
type Entry = { file: string; css?: string[]; imports?: string[]; dynamicImports?: string[] };
const manifest = JSON.parse(readFileSync(join(bundle, ".vite/manifest.json"), "utf8")) as Record<string, Entry>;
for (const [kind, key] of Object.entries(entries)) {
  const css = new Set<string>(), preload = new Set<string>(), visited = new Set<string>();
  const collect = (key: string) => {
    if (visited.has(key)) return;
    visited.add(key); const entry = manifest[key];
    for (const file of entry.css ?? []) css.add(file);
    for (const imported of entry.imports ?? []) { preload.add(manifest[imported].file); collect(imported); }
    for (const imported of entry.dynamicImports ?? []) if (/site-(?:browser-api|screenshot-preview|features-preview)/.test(imported)) { preload.add(manifest[imported].file); collect(imported); }
  };
  collect(key);
  if (kind === "hero") {
    const index = join(site, "index.html");
    writeFileSync(index, readFileSync(index, "utf8").replace("</body>", `<script type="module" src="/ui/${manifest[key].file}"></script></body>`));
    continue;
  }
  if (manifest["src/locales/zh.json"]) preload.add(manifest["src/locales/zh.json"].file);
  const html = `<!doctype html><html lang="zh-CN" data-site-demo="browser"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content"><title>Entropybot · 合成示例</title>${[...preload].map(file => `<link rel="modulepreload" href="/ui/${file}">`).join("")}${[...css].map(file => `<link rel="stylesheet" href="/ui/${file}">`).join("")}</head><body><div id="root"></div><script type="module" src="/ui/${manifest[key].file}"></script></body></html>`;
  mkdirSync(join(site, kind), { recursive: true }); writeFileSync(join(site, kind, "index.html"), html);
}
writeFileSync(join(site, "product/connection.json"), JSON.stringify({ origin: "self" }));
for (const name of ["LICENSE", "NOTICE"]) copy(join(root, name), join(site, name + ".txt"));
const main = readFileSync(join(site, "index.html"), "utf8");
const scriptHashes = [...main.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => "'sha256-" + createHash("sha256").update(match[1]).digest("base64") + "'");
const csp = `default-src 'self'; script-src 'self' ${scriptHashes.join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'`;
const hashes: Record<string, string> = {};
const scan = (dir: string, prefix = "") => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name), key = prefix + entry.name; if (entry.isDirectory()) scan(path, key + "/"); else hashes[key] = createHash("sha256").update(readFileSync(path)).digest("hex"); } };
scan(site);
const record = { site, scratch, head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), csp, hashes };
writeFileSync(join(scratch, "release.json"), JSON.stringify(record, null, 2));
console.log(JSON.stringify({ site, record: join(scratch, "release.json"), files: Object.keys(hashes).length }));
