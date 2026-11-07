# Entropybot 展示页

静态产品介绍与下载页。官网固定为 <https://bot.cloudentropy.ai/>。Google 授权入口继续使用同域的 `/auth/google/start?rd=/welcome`，由部署环境提供后端；本地静态预览不处理授权。

### 首页内嵌演示（2026-11-08 更新）

按用户要求，首页原“桌面界面”截图区已改为直接可操作的交互演示，通过同源、延迟加载的 iframe 复用 `/demo/`，不重复实现演示。主按钮“直接体验”跳到该区域，“独立打开”保留 `/demo/` 入口。删除了截图切换、大图弹窗及其脚本；图片文件保留供 README 等已有引用使用。此更新取代下文历史记录中“首页只展示截图、不加载演示”的设计。

本地核对：1440/390/320px 页面与 iframe 内均无横向溢出；嵌入演示中记忆、设置切换及发送合成消息/收到本地假回复通过。不连接模型、后端或真实账号。

后续验收修正：官网与演示共用 `entropybot-theme`，保留旧演示主题偏好作为兼容回退；两者切换主题可双向同步，“跟随系统”随系统明暗变化，刷新后仍一致。手机侧栏改为分行显示，320/390px 下聊天、记忆、设置入口均完整可见。输入框 Enter 发送前检查 `isComposing` 与兼容 keyCode 229，避免中文选词误发；Shift+Enter 保留换行。

回归：使用浏览器合成输入验证组合输入 Enter 保留草稿、普通 Enter 发送并收到本地回复；桌面/手机导航无溢出；明色移动与暗色桌面 Lighthouse 均 100/100/100/100、54 通过/0 失败；无 console error/warn，无 fetch/XHR。独立静态复审无新增问题。Google 入口为 302 → `accounts.google.com/o/oauth2/auth`，下载入口为本仓库 `entropybot-v0.2.3`。未登录 Google，未验证真实输入法、Safari/Firefox 或 Lighthouse 性能分数。

演示构建保留两个既有 `::highlight` CSS 优化器识别警告；构建成功且本轮交互、对比度检查通过，不能将构建成功写成没有警告。


## 设计原则

1. **单一目的**：一页完成“是什么、真实界面、下载”；不做博客、文档中心或功能大全。
2. **真实优先**：使用真实应用截图并标注演示内容；不写未实现的能力、签名或发布状态。
3. **下载唯一**：所有下载按钮只指向本仓库 Releases，不把用户导向上游项目。
4. **低认知负担**：首屏只保留标题、短说明、主按钮和截图；功能说明控制在三块。
5. **尊重系统**：默认跟随深浅色，允许手动切换并记住；首屏绘制前应用主题。
6. **可访问**：语义化结构、跳转链接、可见焦点、图片 alt、键盘可用、`dialog` 关闭后焦点返回、尊重减少动画。
7. **响应式**：至少覆盖 1440、390、320px；关键操作不依赖 hover。
8. **轻量静态**：单 HTML、无前端框架/构建、系统字体、WebP 资源、无第三方追踪；禁用 JavaScript 仍能查看原图。
9. **诚实边界**：只写真实公开版本；未发布版本不称“最新”；ad-hoc/未公证必须写明。
10. **保留归属**：页脚保留 Apache-2.0、NOTICE 和 OpenMausBot 上游归属，但不把上游下载/赞助当成本产品入口。

不追求自动播放、视差、3D、复杂动画或“万能 AI”式夸张宣传；可信、清楚、能维护优先。

## 本地预览

```sh
cd site
python3 -m http.server 5187 --bind 127.0.0.1
```

访问 http://127.0.0.1:5187/ 。上传时需同时包含 `index.html`、`assets/` 和 `demo/` 目录，图片与演示资源都采用相对路径。

## 更新应用截图

```sh
# 在仓库根目录执行，使用 Node.js 24+
source ~/.nvm/nvm.sh && nvm use 24
node --experimental-strip-types scripts/capture-site-app.ts
```

脚本启动一次性的隔离环境，用假引擎生成中文演示对话，再拍摄真实应用组件。不会读写用户的应用数据，也不会调用真实模型。脚本结束时自动关闭自己的服务与浏览器。

产物：

- `assets/app-light.webp`：Daylight，2560 × 1600。
- `assets/app-dark.webp`：Midnight，同一场景、相同尺寸。
- `assets/app-icon.png`：应用的 Electron 图标。

演示对话不代表真实任务执行记录。页面已标注演示内容。

## 部署

线上地址：<https://bot.cloudentropy.ai/>（演示 <https://bot.cloudentropy.ai/demo/>）。DNS 为 `muse.cloudentropy.ai` 的 CNAME。

官网静态根目录为 `/opt/entropybot/site`，Caddy 容器只读挂载到 `/srv/site`。发布前先备份旧目录；上传新图片后再原子替换 `index.html`，避免页面引用尚未上传的资源。此更新无需重启容器。

### 2026-11-08 部署记录

先备份旧首页到 `/opt/entropybot/backups/site-index-2026-11-08.html`（13,997 B，`ab872dee…`），再上传 `demo/`，校验内容后以 `mv` 原子替换 `index.html`；未重启容器、未改动 `/opt/entropybot/private` 与 `deploy/`。

| 路径 | 线上状态 | SHA-256（前 16 位） |
|---|---|---|
| `/` | 200，22,832 B | `d58132879a5f527c` |
| `/demo/` | 200，22 个文件 | `648f3695a6c68941` |
| `/demo/assets/index-BSAcwuu3.css` | 200 | `d0cb6c87f3ce3bb1` |
| `/demo/assets/index-CBxrSY1W.js` | 200 | `5e9d7c882721134a` |
| `/assets/app-light.webp` | 200 | `4f3687365fab225e` |
| `/assets/app-dark.webp` | 200 | `e7090352308a69b3` |
| `/assets/app-icon.png` | 200 | `12bf38519d777d96` |

线上核对：首页 2×2 功能卡、3 个职责 tab、4 条 FAQ 点击可用；截图大图打开/Escape 关闭正常；1440、390、320px 无横向溢出；无外部请求、无 console 错误；`/demo/?view=memory` 可直达。移动端 Lighthouse 首页与 `/demo/` 均为 Accessibility/Best Practices/SEO/Agentic Browsing 100、0 失败。

本轮同时修正演示内部件对比度：用户气泡内时间戳原为 `color-mix(…62%, transparent)`，实测 3.56:1，不足 4.5:1；改为 82% 后约 4.9:1，桌面与移动 Lighthouse 均恢复 100。

`/auth/google/start?rd=/welcome` 返回 200，由部署环境的授权代理提供；本轮未执行真实 Google 登录。

仅发布 `index.html`、`assets/` 与 `demo/`。不要上传此目录之外的文件；`/opt/entropybot/private` 为授权后的页面，`/opt/entropybot/deploy` 保存现有 Caddy 和 Google 授权代理配置。

授权代理通过 `network_mode: service:caddy` 共享 Caddy 的网络环境。若 Caddy 重启后登录入口返回 502，应检查代理是否仍连接当前网络环境。需要重建代理时，必须显式加载保存在 Compose 目录外的环境文件，避免以空凭证启动：

```sh
cd /opt/entropybot/deploy
docker compose --env-file /opt/entropybot/.env up -d --no-deps --force-recreate oauth2-proxy
```

不要将服务器环境文件或凭证提交到仓库。

发布后核对主页、三张图片及 `/demo/` 的 HTTP 状态、内容哈希、明暗主题切换、图片预览和交互入口，并检查 Google 授权入口仍重定向到 Google。完整登录需要用户本人完成授权。

## 交互演示 `/demo/`

首页的“试用界面”与“在线演示”进入 `site/demo/`。它是一个独立的静态 React 构建，复用应用的主题 token、字体、颜色和布局语言，但**不连接后端、模型或账号**；所有 bot、消息、记忆和数字都是合成数据。

- 源码：应用仓库 `demo-site/`，构建配置 `vite.demo.config.ts`。
- 构建：在应用仓库根目录运行 `node node_modules/vite/bin/vite.js build --config vite.demo.config.ts`；输出到 `site/demo/`。
- 范围：聊天、侧栏、记忆、设置四个可点击界面；发送消息会生成本地假回复。支持 `?view=chat`、`?view=memory`、`?view=settings` 直接打开对应页面。
- 体积：JS 约 208 kB（gzip 66.6 kB），CSS 约 102 kB（gzip 20.3 kB），字体按需加载；首页不加载这些资源。
- 边界：不是完整应用，不执行真实工具，不读取真实记忆/凭证；不能替代安装验收。

## 2026-11-08 设计原则检验

环境：本地 `python3 -m http.server 5187`，Chrome DevTools 桌面/移动模拟；已部署到 `bot.cloudentropy.ai`，未登录 Google、未调用真实模型。

| 检查项 | 结果 |
|---|---|
| 页面加载 | 200；无 console 错误 |
| 外部请求 | 无；仅 `index.html` 与 3 个本地图片请求 |
| Lighthouse（首页桌面） | Accessibility 100、Best Practices 100、SEO 100、Agentic Browsing 100，54 项通过、0 失败 |
| 响应式 | 1440、390、320px 均无横向溢出 |
| 主题 | 跟随系统；浅/深色切换生效，刷新后保留选择 |
| 截图大图 | 点击打开 `dialog`，Escape 关闭，焦点返回原截图链接 |
| 无 JavaScript | 截图仍是可打开的图片链接 |
| 相对链接 | 0 缺失 |
| 下载链接 | `releases/latest` 当前解析到 `entropybot-v0.2.3`，与“当前公开版本”一致 |
| 本地 Google 登录 | 404，符合“需要部署环境后端”的说明；不能直接静态托管 |
| 首页交互 | 2×2 功能卡、3 个职责 tab、4 条 FAQ 手风琴；tab 切换和 FAQ 展开实际点击通过 |
| `/demo/` | Lighthouse 100/100/100/100，50 项通过、0 失败；390px 无溢出；聊天发送、侧栏、记忆、设置可点；`?view=memory`/`?view=settings` 可直达 |
| 线上部署 | 2026-11-08 已发布；主页、演示、三张图片与授权入口均返回 200，哈希与本地一致 |

本轮修正：把“无需账号即可开始”改为“本地使用无需账号；Cloud 功能可另行使用 Google 登录”；下载区明确写出“0.2.6 本地候选尚未公开发布”，避免把未发布候选当成公开版本。

未验证：真实 Google 登录、Safari/Firefox、Lighthouse 性能分数、真实下载安装。截图是演示数据，不是用户真实记录。

## 页面行为

主题默认跟随系统，可选择浅色、深色或跟随系统；选择保存在此网站自己的 `entropybot-theme` 中。截图随页面主题切换。点击截图可查看大图，Escape 关闭后焦点返回截图链接。关闭 JavaScript 时仍能通过图片链接查看原图。

本次检查包含 1440、390、320px 布局、两种主题、系统主题变化、刷新后的偏好保存、图片加载、大图关闭与焦点返回，以及无 JavaScript 的图片链接。没有执行 Google 登录或线上部署。
