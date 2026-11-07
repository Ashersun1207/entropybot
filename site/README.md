# Entropybot 展示页

静态产品介绍与下载页。Google 授权入口继续使用同域的 `/auth/google/start?rd=/welcome`，由部署环境提供后端；本地静态预览不处理授权。


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

官网静态根目录为 `/opt/entropybot/site`，Caddy 容器只读挂载到 `/srv/site`。发布前先备份旧目录；上传新图片后再原子替换 `index.html`，避免页面引用尚未上传的资源。此更新无需重启容器。

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

环境：本地 `python3 -m http.server 5187`，Chrome DevTools 桌面/移动模拟；未部署、未登录 Google、未调用真实模型。

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

本轮修正：把“无需账号即可开始”改为“本地使用无需账号；Cloud 功能可另行使用 Google 登录”；下载区明确写出“0.2.6 本地候选尚未公开发布”，避免把未发布候选当成公开版本。

未验证：真实托管环境的 `/auth/google/start`、Safari/Firefox、Lighthouse 性能分数、真实下载安装。截图是演示数据，不是用户真实记录。

## 页面行为

主题默认跟随系统，可选择浅色、深色或跟随系统；选择保存在此网站自己的 `entropybot-theme` 中。截图随页面主题切换。点击截图可查看大图，Escape 关闭后焦点返回截图链接。关闭 JavaScript 时仍能通过图片链接查看原图。

本次检查包含 1440、390、320px 布局、两种主题、系统主题变化、刷新后的偏好保存、图片加载、大图关闭与焦点返回，以及无 JavaScript 的图片链接。没有执行 Google 登录或线上部署。
