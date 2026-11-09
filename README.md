# Entropybot

本机优先的 AI 机器人团队，面向 macOS。在桌面上与不同职责的机器人对话，按你的选择连接模型，并管理各自的记忆与任务。

[官网 · 在线体验](https://bot.cloudentropy.ai/) · [English](README.en.md) · [下载 macOS 版](https://github.com/Ashersun1207/entropybot/releases/latest) · [版本记录](https://github.com/Ashersun1207/entropybot/releases) · [更新与迁移说明](docs/ENTROPYBOT_UPDATES.md)

![Entropybot 桌面工作区，使用合成示例数据](site/assets/product-ui-light.webp)

## 从对话开始

- **机器人协作**：在侧栏中选择不同职责的机器人，为任务选择模型与执行引擎。
- **本地记忆**：记忆与索引保存在本机；支持中文检索，以及可选的 DashScope `text-embedding-v4` 语义检索。
- **长对话处理**：按模型预算重放历史并压缩上下文，兼容上下文长度错误、内容片段数组与重复工具调用 ID。
- **独立更新渠道**：使用 Entropybot 自己的版本、应用身份与 GitHub Releases，目前采用手动更新。

本地保存不等于全程离线。使用远程模型或开启云端 embedding 时，相关请求会发送到你配置的服务，并可能产生费用。凭证、个人聊天与真实记忆不包含在本仓库中。

## 下载与版本状态

下载以[本仓库 Releases](https://github.com/Ashersun1207/entropybot/releases) 列出的公开版本及附件为准。目前公开版本为 **0.2.3**；**0.2.6 是尚未公开发布的本地候选**。

当前优先 macOS Apple silicon。现有本地候选使用 ad-hoc 签名，未经 Apple 公证；正式 Developer ID 签名与公证尚未完成。其他平台的源码存在不代表已提供对应安装包。

更新前退出应用并备份工作区与桌面配置；详细步骤见[更新与迁移说明](docs/ENTROPYBOT_UPDATES.md)。合成数据回归和局部测试不能替代真实安装、迁移与恢复验收。

## 官网交互体验

打开 [bot.cloudentropy.ai](https://bot.cloudentropy.ai/)，即可在首页操作真实产品工作区：切换助手、输入文字、发送并收到流式示例回复。中文 / EN 覆盖页面、产品 UI 和示例，切换时保留会话与草稿。

首屏对话自动循环，支持暂停和继续；四项功能展示工具使用、步骤复用、偏好纠正和助手协作。标题使用原生 SVG 角色，保持自然眨眼、视线变化与克制的眼睛比例。

这些内容使用合成数据与预设回复，在访客标签页内隔离运行，不连接真实模型、账号或个人记忆。官网展示不代表相应桌面候选已发布。旧 `/demo/` 兼容路径保留。

本地构建与预览见 [`site/README.md`](site/README.md)，持续设计约定见 [`site/EXPERIENCE.md`](site/EXPERIENCE.md)。

## 开发

需要 Node.js 24+ 和 pnpm 10.33.0：

```sh
pnpm install --frozen-lockfile
```

分别在两个终端运行：

```sh
pnpm dev:server
```

```sh
pnpm dev
```

模型服务凭证在本地配置，不应提交到仓库。应用 bundle ID 为 `ai.entropybot.desktop`；版本与发布渠道独立管理。开发验证应使用隔离 fixture 与合成数据，参见[验证说明](docs/verification/README.md)。

## 来源与许可

Entropybot 由 Ashersun1207 基于 [OpenMausBot](https://github.com/milind-soni/OpenMausBot) 独立开发，与上游维护者无隶属关系。保留原作者归属、[Apache-2.0 LICENSE](LICENSE) 和 [NOTICE](NOTICE)。

`enterprise/` 适用其[单独许可](enterprise/LICENSE)，不属于 Apache-2.0 授权范围。上游名称与美术资源的商标权归其权利人所有；本项目不授予相关商标权或企业生产使用许可。
