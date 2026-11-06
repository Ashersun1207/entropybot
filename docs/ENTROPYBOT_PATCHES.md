# Entropybot 补丁清单

> 与上游 OpenMausBot 同步前先读这里。每次同步后更新“上游状态”。
> 校验：`node scripts/check-patches.mjs`（CI 会跑）。

| ID | 目的 | 涉及文件 | 测试 | 上游状态 | 冲突处理 |
|---|---|---|---|---|---|
| P1 | 记忆语义检索（千问 embedding + 本地 bigram 兜底） | `server/memory-embeddings.ts`、`server/memory-retrieval.ts`、`server/memory-embedding-config.ts`、`server/recall.ts`、`server/message-db.ts`、`server/config.ts` | `server/memory-embeddings.test.ts`、`server/recall.test.ts`、`server/config.test.ts` | 未合并 | 先取上游，再接回 `recall.ts` 的两处调用与配置字段 |
| P2 | 对话运行时修复（窗口自适应重放、stateless 压缩、400 回缩、工具 ID 批次、JSON/数组响应） | `server/context-rebuild.ts`、`server/index.ts`、`server/drivers/openai-chat.ts`、`server/drivers/chat-size-limit.ts`、`server/drivers/chat-delivered-replay.ts` | `server/context-rebuild.test.ts`、`server/drivers/chat-size-limit.test.ts`、`server/drivers/openai-chat.test.ts` | 未合并 | 优先高冲突；按函数逐个重放，不要整文件覆盖 |
| P3 | 身份（appId / productName / CUA bundle id） | `electron-builder.yml`、`package.json`、`electron/cua.mjs`、`server/local-computer.ts` | `server/local-computer.test.ts` | 未合并 | 永远保留我们的 |
| P4 | 发布与更新（自有 GitHub Releases、手动模式、版本/标签、Draft 流程） | `electron/update-policy.mjs`、`electron/updater.mjs`、`server/update-check.ts`、`.github/workflows/entropybot-*.yml`、`scripts/entropybot-release.mjs` | `electron/entropybot-updater.test.mjs`、`server/update-check.test.ts` | 未合并 | 上游更新源一律丢弃，保留我们的 |
| P5 | 上游 workflow 归档（不执行官方发布/部署） | `.github/upstream-workflows/` | — | 结构决策 | 合并上游 workflow 时移到这里 |
| P6 | 数据目录（`~/.entropybot`，旧 `~/.openmausbot` 自动迁移） | `server/config.ts`、`electron/main.mjs`、`server/data-dir*.ts` | `server/config.test.ts` | 未合并 | 保留迁移分支，否则用户像“数据丢了” |
| P7 | 协议名（`entropybot://` 新增，旧 `openmausbot://` 兼容） | `electron-builder.yml`、`electron/main.mjs` | `electron/*.test.mjs` | 未合并 | 两个 scheme 都注册 |
| P8 | 品牌与链接（产品名、文案、域名、GitHub） | `src/`、`server/`、`electron/`、`shared/`、`docs/`、`README.md` | `src/locales/*.test.ts` | 未合并 | 保留 NOTICE/LICENSE 归属，不改法律文本 |
| P9 | 应用内“有新版本”提示（只检查不安装） | `electron/updater.mjs`、`src/components/AppSettingsRows.tsx` | `electron/entropybot-updater.test.mjs` | 未合并 | 手动模式专用 |
| P10 | 应用内语义记忆设置与安全凭证（safeStorage / macOS Keychain 保护） | `src/components/MemorySettings.tsx`、Settings 导航与配置状态、`electron/workspace-credentials.mjs`、`electron/credential-patch.mjs`、`electron/main.mjs`、`server/memory-embedding-*.ts`、`server/routes/memory-embedding.ts`、配置与环境隔离 | `electron/memory-credentials.test.mjs`、`server/memory-embedding-{config,client,index,auth}.test.ts`、`server/memory-embedding-settings.e2e.test.ts`、`src/components/MemorySettings.test.ts`、`src/state/memory-status.test.ts` | 未合并 | 保留专属 slot、迁移先加密后删明文、清除空值标记、脱敏状态、受保护测试路由和 endpoint/model/dimensions 索引身份；不得回退明文保存 |

路径检查只确认文件存在；P10 的行为测试已列入自有 CI。上游合并后仍需按最终集成提交执行隔离验收，不能把路径检查通过当作行为验证。设置、凭证与验证边界见 [记忆设置验收](verification/memory-embedding-settings.md)。

## 必须保留（不可替换）

- `NOTICE`、`LICENSE`、`LICENSING.md`、`enterprise/LICENSE` 与“基于 OpenMausBot”的归属说明。
- 上游仓库地址仅出现在归属/审计文档中。
- `OMB_*` 环境变量（兼容既有部署）。
- Keychain 服务名与 Electron profile 目录（改了会丢已保存的加密凭证）。
