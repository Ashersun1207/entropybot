# Entropybot 0.2.4

日期：2026-11-07。状态：本地发布候选，未推送、未创建 tag、未替换本机应用。

## 内容

- 应用内语义记忆设置与安全凭证；旧 Key 迁移、清除语义、连接测试与脱敏。
- 中文历史对话自动召回；授权/时间过滤、旧库重建、真实正文证据与本地 FTS。
- 数据查询提前停止不再丢失；同连接恢复验证。
- 执行门槛的命令/整体截止、取消、自有进程组与正常 fixture 内部资源确认。
- 记忆提示过滤 superseded/expired；原文、UI、archive、journal 保留。
- 桌面更新检查失败不再显示“已是最新”；可重试、脱敏，仍只检查不安装。
- 长对话连续压缩后保留有界活跃约束；取消/完成/过期/伪块/中文编号边界已验证。
- 停止后迟到工具回执不污染新回合；回归和过期测试契约已修正，产品未改。

## 本地验收

- 源码 HEAD：版本提交（见 `release/entropybot-build.json`）。
- 完整行为门槛：46 个 Vitest 文件/1000 项、5 个 Node 文件/29 项、30 项结构契约通过。
- 打包服务：13 项冒烟通过（无 node_modules 启动、代理路径、MCP、doctor、备份、容器、桌面入口、企业层）。
- 数据迁移：合成 `~/.openmausbot`（含 config 标记与有效 SQLite）启动后变为 `~/.entropybot`，标记和数据库保留，健康检查通过。
- App/DMG：版本 `0.2.4`、bundle id `ai.entropybot.desktop`、ad-hoc 签名校验通过；DMG 内 App 同版本同身份。

## 未验证

- 未替换或安装到本机 Applications；未验证真实用户 profile 升级/回退。
- 未在真实 macOS Keychain 锁定/拒绝路径下运行；未验证真实 Electron IPC 全链路。
- 未做 Apple Developer ID/公证；未验证自动更新（当前手动模式）。
- 未验证真实模型、真实聊天/记忆、Windows/Linux。
- 本次只生成候选，不代表已发布。
