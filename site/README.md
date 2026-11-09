# Entropybot website

官网：<https://bot.cloudentropy.ai/> · [English](https://bot.cloudentropy.ai/?lang=en) · [体验约定 / Experience requirements](EXPERIENCE.md)

首页直接提供真实产品 App 的合成交互工作区：切换助手、输入、发送、流式示例回复和循环播放。中文 / EN 同步切换网页、产品 UI、功能介绍和示例内容，并保留会话与草稿。标题使用原生 SVG 头像、克制的眼形与眨眼/视线动态；功能区复用工具、确认、任务和协作组件。

The homepage embeds the actual product App with an isolated browser adapter. Visitors can switch assistants and send messages; replies and demonstrations use clearly labeled synthetic data. Chinese and English share conversation identity and drafts. The title uses the native SVG mascot with restrained expressions. No live model, account or external execution engine is connected.

## Build and preview

Requires the repository's Node.js 24+ and pnpm dependencies:

```sh
pnpm install --frozen-lockfile
node --experimental-strip-types scripts/build-site-release.ts
```

The command prints a JSON result containing `site` (the generated static directory) and `record` (the local build/hash record). Use the printed `site` path:

```sh
SITE_RELEASE_DIR="/absolute/path/from-the-build-result/site" \
SITE_RELEASE_PORT=5210 \
node scripts/testing/serve-site-release.mjs
```

Open <http://127.0.0.1:5210/> or append `?lang=en`. The preview binds only to localhost. A plain HTTP server pointed at the source `site/` directory cannot provide the compiled product workspace or native hero module.

The build uses the operating system's temporary directory (`TMPDIR` may select an alternate location). It outputs static files, license notices and hashed UI assets. Build metadata, source files and sourcemaps stay outside the served directory.

## Source layout

- `index.html`, `product.css`, `language.js`: marketing layout, theme and Chinese/English copy.
- `product-experience.js`, `feature-experience.js`: validated iframe bridges, loading/retry states, role selection and feature handoff.
- `../scripts/testing/site-interactive-preview.tsx`: real App entry and restricted bridge commands.
- `../scripts/testing/site-browser-api.ts`, `site-browser-storage.ts`: tab-local synthetic state and bounded sample API.
- `../scripts/testing/site-replies.ts`, `site-examples.ts`, `site-locale.ts`: preset replies, finite example drafts and locale selection.
- `../scripts/testing/site-features-preview.tsx`, `site-feature-translations.ts`, `site-features.css`: native feature components and bilingual content.
- `../scripts/testing/site-hero-avatar.tsx`, `assets/hero-mascot.svg`: native mascot animation and static fallback.

## Deployment

Keep the existing <https://bot.cloudentropy.ai/> Caddy site. Publish only the generated `site` directory, uploading hashed assets before atomically replacing HTML entries. Retain older hash assets for pages already open, and keep a rollback copy outside the public directory. Do not upload the build record or repository source.

Use `text/html` for `/` and directory entries, `no-store` for HTML and connection metadata, and immutable caching only for hashed `/ui/assets/` files. Preserve the existing Google authorization routing and legacy `/demo/` directory; the new homepage build does not replace either service. Building or deploying the website does not build, install or publish a desktop package.

## Checks and limits

With Chrome installed (set `OMB_CDP_CHROME` to its executable on other platforms), verify a built release using isolated synthetic browser profiles:

```sh
SITE_RELEASE_DIR="/absolute/path/from-the-build-result/site" \
SITE_EVIDENCE_DIR="/absolute/path/for-local-evidence" \
node --experimental-strip-types scripts/testing/verify-site-release.ts
```

After an authorized deployment, the public smoke check is:

```sh
SITE_PUBLIC_URL="https://bot.cloudentropy.ai/" \
SITE_EVIDENCE_DIR="/absolute/path/for-public-evidence" \
node --experimental-strip-types scripts/testing/verify-site-public.ts
```

These smoke checks cover new input/replies, the feature-to-conversation bridge, served-file boundaries and separate fresh browser profiles; they are not the full visual and language acceptance checklist.

Use the documented browser checks in `EXPERIENCE.md`: actual input and new replies, repeated streaming playback, refresh/visibility recovery, language switching with draft preservation, native mascot frames and eye proportions, reduced motion, and responsive layout. Confirm the deployed entry/assets match the validated build before claiming the public site has changed.

The static preview has no real Google login backend. The public authorization endpoint is supplied by the existing deployment. Browser-local examples do not call a live model, send invitations, schedule events or modify real memories. Chromium emulation is not a claim of Safari/Firefox or physical mobile keyboard validation.
