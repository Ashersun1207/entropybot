# Entropybot 补丁清单

> 与上游 OpenMausBot 同步前先读这里。每次同步后更新“上游状态”。
> 结构校验：`node scripts/check-patches.mjs`。完整行为门槛：`node scripts/check-patches.mjs --verify`（Node 24，接入方式见下文；workflow 由主控统一修改）。

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
| P11 | 中文历史自动召回与可重建派生索引 | `server/message-db.ts`、`server/recall.ts`、`server/message-recall-{index,chinese,terms,evidence}.ts` | `server/chinese-history-recall{,.e2e}.test.ts`、`server/recall-accent.test.ts`、`server/message-recall-evidence.test.ts`、`server/message-recall-index.test.ts`、`server/chinese-history-performance.test.ts`、`server/message-db.test.ts` | 未合并 | 保留原生触发器与事务回填、授权/时间过滤、短中文准入、真实正文相关性复核、作者与预算；不可退回全库扫描或仅最近窗口 |
| P12 | 数据查询公开提前中断不丢失 | `server/data/engine.ts` | `server/data/engine.test.ts`、`server/data/engine-interrupt.test.ts`、`server/data/engine-interrupt-native.test.ts` | 未合并 | 保留原 deadline/首因、单 retry、state 身份及 finally；此修复不保证截止后派发或所有 bot Stop |
| P14 | 记忆提示投影过滤 superseded / expired | `server/workspace.ts`、`server/memory-upkeep.ts` | `server/memory-prompt-projection.test.ts`、`server/workspace.test.ts`、`server/memory-upkeep.test.ts` | 未合并 | 只在模型可见投影过滤，原文/UI/archive/journal 保留；聊天、摘要、日志、备份不在范围 |
| P15 | 桌面手动更新检查失败状态 | `electron/updater.mjs`、`src/lib/updater.ts`、`src/components/AppSettingsRows.tsx`、locale | `electron/entropybot-updater.test.mjs`、`src/components/SettingsModal.manual-updates.test.ts` | 未合并 | 缺 tag/无效版本/HTTP/超时/坏响应均失败可重试，不显示最新；不改来源、服务端或自动安装 |
| P16 | 长对话连续压缩保留活跃约束 | `server/active-constraints.ts`、`server/compaction-summary.ts` | `server/compaction-constraints.test.ts`、`server/context-compaction.e2e.test.ts` | 未合并 | 只保留有限条活跃约束/纠正/目标，跨两次压缩与重启；中英文 cue 与有界块，不是完整语义引擎；不提高 60KB/6KB 预算 |
| P13 | 门槛执行截止、取消及验证 fixture 资源确认 | `scripts/patch-gate-process.ts`、`scripts/check-patches.mjs`、`server/verification-process-scope.ts`、`scripts/testing/verification-{lifecycle,server-preload}.ts`、`server/procs.ts`、`server/graceful-shutdown.ts`、`scripts/control-omb.ts` | `scripts/testing/patch-gate-{process.test.ts,cli.test.mjs}`、`scripts/testing/verification-lifecycle.test.ts`、`scripts/testing/verification-boundary.e2e.test.ts`、`server/verification-process-scope.test.ts` | 未合并 | 保留自有组与内部登记资源分开确认、INIT/lease 身份、异常保留目录、按代重启；确认域仅限本次登记正常 fixture CLI 与自有外组，Windows/未知平台行为执行前拒绝 |

契约清单见 `scripts/patch-contracts.mjs`，区分结构规则与必须执行的行为测试。P10 的行为测试已列入自有 CI；新增完整门槛的 workflow 接入由主控处理。设置、凭证与验证边界见 [记忆设置验收](verification/memory-embedding-settings.md)。

## 第二轮契约门槛

本轮源码基线固定为 `c1aeda2501c5a003446acb413de46d0e16012976`。这是 Entropybot 定制源码基线，不是“上游最新版本”。源码上游固定 SHA、Entropybot 应用版本（本轮基线为 0.2.3）、外部执行引擎版本和模型版本分别记录、分别验证；源码同步不能替代引擎能力或模型效果验收。脚本不 fetch、merge、下载上游实现或恢复上游发布 workflow。

最终集成清单包含 30 项结构契约，行为文件清单为 44 个 Vitest 文件、5 个 Node test 文件。契约测试共 10 项，其中三个独立来源/接线变异分别验证 recall 调用、发布页 URL 与桌面 API URL；桌面 updater 的既有三项行为测试保持登记。

| 契约 | 结构保护范围 | 复用的行为证据 |
|---|---|---|
| P1 | `index`→`buildRecall`、embedding 配置、两处 `withRecalled` 调用；recall→语义与本地 bigram 来源 | `recall.test.ts`、`memory-embeddings.test.ts`；`memory-layer.e2e.test.ts` 在假引擎收到的 prompt 中检查记忆与跨 chat 历史，关停记忆后消失 |
| P2 | 自适应预算、selectReplay、压缩判断/摘要、delivered replay、400 回缩调用来源 | `context-budget.test.ts`、`context-rebuild.test.ts`、`context-compaction.e2e.test.ts`（自动/手动压缩、Stop、重启）；`drivers/chat-size-limit.test.ts`、`drivers/openai-chat{,-protocol}.test.ts`（假传输、真实驱动） |
| P3/P4/P9 | appId、发布页（P4/release-source）、桌面实际 LATEST_RELEASE_URL（P4/desktop-source）、服务 API（P4/server-source）和打包来源固定为自有仓库、manual 模式 | `electron/entropybot-updater.test.mjs` 断言真实 manualCheck 在定时检查及授权 IPC 检查中传给 mock fetch 的精确 API URL，同时拒绝安装且不加载二进制 updater；`server/update-check.test.ts` 断言服务端请求来源和版本行为；不请求真实 GitHub |
| P6 | config 调用数据目录迁移 helper | `server/legacy-migration.test.ts` 在合成 HOME 启动真实服务并检查 `.opengrokbot` 迁移；`scripts/testing/patch-contracts.test.ts` 在独立子进程调用真实 config/ensureDirs，检查 `.openmausbot` → `.entropybot` 及内容保留；`server/config.test.ts` 使用隔离目录检查配置 |
| P7 | builder 同时注册 `entropybot` / `openmausbot` | Node tests：package-link、chat-link、organization-entry 的新协议解析与拒绝规则；旧 scheme 此门槛仅检查注册，不承诺所有 handler 对旧 scheme 等价，也不证明 OS 已注册 |
| P10 | main 接回凭证迁移、环境注入、存储 guard；server 注册测试路由；config 委托记忆凭证环境同步 | `memory-credentials`、`workspace-credentials`、`secure-credential-state`、`workspace-backup-policy`、`memory-embedding-{config,client,index,auth}`、`memory-embedding-settings.e2e`、MemorySettings/导航/status 与两项凭证 Node tests；覆盖 slot、先加密后删明文、失败保留、空值 tombstone、外置清除、权限/脱敏与索引身份 |
| P11 | 消息库打开时确保中文索引、调用中文候选、短查询准入、以真实正文及原生 FTS 高亮证据复核片段 | `message-db`、`recall-accent`、`message-recall-evidence`、`chinese-history-recall`、`message-recall-index`、`chinese-history-recall.e2e`、`chinese-history-performance`；覆盖既有 Unicode 重音匹配、旧库重建、事务失败重试、第二连接写改删、授权/时间/all-any/作者/预算、当前回合 prompt 及 2k/20k 合成性能 |

维护契约 M01 另保护中文回合 e2e 在创建 scratch 后注册 `onTestFinished`。本轮以合成 launcher 拒绝和 close 拒绝实际导入该 e2e 验证 scratch 删除、零网络请求；结构注册检查不替代所有资源/后代进程的运行证明。

表中未带目录的服务测试位于 `server/`；完整、可执行的文件清单以 `scripts/patch-contracts.mjs` 为准。P5/P8 的全部品牌文案、法律归属和发布行为不在自动行为证明范围内；相关清单路径仍检查存在。

结构层解析 TypeScript/JavaScript AST 和 YAML，不靠注释、字符串片段或仅有 import 判定接线。支持空格、注释、导入本地别名和同文件函数提取；不固定 A 的中文历史检索实现或旧 unicode61 路径。跨文件迁移调用时应审查语义并更新清单。AST 调用边不证明可达性、参数正确或无同名局部遮蔽；即使调用保留在死分支，也必须由完整行为门槛验证。结构层不能证明运行中的授权范围、编辑删除一致性、凭证事务、实际 macOS Keychain、Electron 安装包或真实模型质量。

`scripts/testing/patch-contracts.test.ts` 在稀疏临时源码副本中验证：未变异副本通过；保留文件/import/注释但移除实际 buildRecall 调用时仅按 P1/auto-recall 失败；文件仍在但发布页换成上游来源时仅按 P4/release-source 失败；仅替换 `electron/updater.mjs` 的桌面 API URL、保留发布页/manual 等其它内容时，仅按 P4/desktop-source 失败；格式/别名和函数提取控制样本通过；缺少登记测试时报错。稀疏副本仅运行结构检查，不执行测试，故变异失败不会来自缺依赖或 Vite 配置。

## CI 与 release 接入

依赖安装后使用 Node 24，在打包前执行相同命令；建议替换原有结构检查步骤。CI 与 release 均由主控接入，避免重复注册与 A 的测试冲突：

```sh
node scripts/check-patches.mjs --verify
```

执行预算、信号取消、进程组回收和失败目录保留见 [门槛生命周期](verification/patch-gate-lifecycle.md)。完整行为执行当前要求 POSIX 进程组支持；Windows/未知平台会在启动命令前明确拒绝，结构模式仍可使用。

该命令先检查结构和测试文件存在，再运行显式 Vitest 文件清单（含契约变异测试和真实隔离假引擎 fixture），最后逐文件运行 Node tests。不接受其它参数，不使用 `--passWithNoTests`；缺文件、解析失败、测试非零退出、空 suite、跳过/todo 测试均返回非零。结构错误输出契约 ID、文件、预期/实际与完整行为门槛命令。

脚本根目录由 `import.meta.url` 决定，允许从任意 cwd 调用绝对脚本路径；不支持 CLI `--root`。Vitest 内部显式传入该根目录、`vite.config.ts` 和 `--configLoader native`，即使 node_modules 链接到主仓库，也读取本 worktree 源码与测试。行为进程使用临时 HOME/data 与过滤后的环境；不继承 API Key 或宿主应用配置。Node 必须已在 PATH 指向 24（子引擎也使用该 PATH）。完整门槛可耗时数分钟，不构建安装包，也不操作用户应用。

单独调试结构与变异测试的确切命令：

```sh
node scripts/check-patches.mjs
node node_modules/vitest/vitest.mjs run --root "$PWD" --config "$PWD/vite.config.ts" --configLoader native scripts/testing/patch-contracts.test.ts
```

第一条明确输出行为未运行；第二条需在应用仓库根目录运行。A 的中文数据库/buildRecall/服务回合与规模回归已登记到统一清单，由两个 workflow 的相同 `--verify` 命令执行；测试清单本身不代替第二轮最终集成验证。通过后仍需按最终提交记录源码 SHA、检查命令与实际结果，再独立验收发布产物。

## 第三轮集成

P12 的确定性 Lane/BotDb、原生临时库及原 engine 回归已登记到同一行为清单，由既有 CI/release 入口运行。Native 实测与 fake 派发证据分别记录，不能外推所有平台和工具取消。

P13 的 5 个新增 suite 与既有 gate 回归也在同一清单；执行器确认范围严格分为“自有外部进程组”和“本次 fixture 登记的内部 CLI 资源”，未知时保留目录并非零退出，旧 generation 回执不完成新 generation。完整行为执行当前只在 Darwin 实测，Linux 未实测；Windows/未知平台在启动行为命令前拒绝，结构模式仍可用。通过结构门槛不等于进程/目录回收已证明，需结合真实 fixture probe 与最终提交门槛。

## 第四轮集成

P14 在 `loadMemory` / capture 输入投影层过滤整条 superseded/expired 条目，先过滤再应用原行/字节预算；原始 `MEMORY.md`、UI 编辑、archive、journal 保留。它不处理历史聊天、压缩摘要、`memory/log`、备份或向量，不能称为彻底遗忘。

P15 让桌面手动更新检查区分无新版、有新版与失败；缺 tag/空 tag/无效版本/HTTP/超时/坏 JSON 均为固定脱敏、可重试失败，不再显示“已是最新”。版本比较、更新来源、服务端语义及手动模式不自动安装保持原样。两项新增回归均进入统一行为清单；真实 Electron IPC、系统安装和真实网络仍未验证。

## 第五轮集成

P16 在摘要投影中加入有界活跃约束块：从当前分支用户消息及上一摘要块提取，支持新增、纠正、完成/取消和日期过期，最多 12 条/1800 bytes；摘要输入先为约束块留空间，确定性/模型回退都保留该块。覆盖两次真实压缩、重启、分支锚点、回退与中英文 cue。它不保存全部历史，不保证真实模型服从，也不处理所有自然语言改写；不得以此提高 60KB/6KB 预算。

## 必须保留（不可替换）

- `NOTICE`、`LICENSE`、`LICENSING.md`、`enterprise/LICENSE` 与“基于 OpenMausBot”的归属说明。
- 上游仓库地址仅出现在归属/审计文档中。
- `OMB_*` 环境变量（兼容既有部署）。
- Keychain 服务名与 Electron profile 目录（改了会丢已保存的加密凭证）。
