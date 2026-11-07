# Agent 工程经验：避免重复犯错

适用 Entropybot 开发、审查、验收和上游集成。任务开始先读，针对本次改动选取相关条目；发现新失败模式后更新相应回归和本文。这里记录证据与经验，不把潜在风险直接称为已确认的恶意代码。

## 已遇到的问题

| 编号 | 失败模式与教训 | 下一次必须检查 | 可执行证据入口 |
|---|---|---|---|
| L01 | 配置 schema 接受字段，不代表 saveConfig 真正保存；新增记忆配置曾漏进合并白名单 | 从 UI/调用者到持久化、重载、状态投影完整核对；局部 PATCH 保留其他值 | `server/config.test.ts`、`server/memory-embedding-config.test.ts`、`server/memory-embedding-settings.e2e.test.ts` |
| L02 | 只新增凭证 slot，外置 secret 路径仍可能把 Key 写回明文；dev 桥也可能绕过加密 | slot→patch→external tombstone→服务环境→状态→清除→重启逐层验证；无桥禁止明文降级 | `electron/memory-credentials.test.mjs`、配置 e2e、`src/components/MemorySettings.test.ts` |
| L03 | 加密文件已提交、配置清理失败后，调用方仍拿旧内存；后续无关保存会覆盖迁移结果 | 故障后用调用方实际保留的引用继续一次无关事务，不能拿最新磁盘变量直接重试来掩盖缺口 | `electron/workspace-credentials.mjs` 的提交回调、`electron/memory-credentials.test.mjs` |
| L04 | 全局“凭证库不可读”曾掩盖已知的明文残留 | 测组合状态，已知明文必须明确提示；不能只分别测 plaintext/unavailable | `server/memory-embedding-config.test.ts` |
| L05 | 发布页、桌面查询 API、服务端查询 API、打包来源是不同入口；只验证其中几个会漏掉来源替换 | 列出每个真正发请求的边界，断言 mock fetch 的真实参数，不只检查 UI 状态或配置对象 | `scripts/patch-contracts.mjs`、`electron/entropybot-updater.test.mjs`、`server/update-check.test.ts` |
| L06 | FTS 能命中不代表自动注入能通过准入和二次过滤；源文本去重音、查询不去重音会破坏既有拉丁语词召回 | helper→buildRecall→当前回合 prompt 分层验证；源与查询规范化一致，覆盖预组合/组合重音及两词门槛负例 | `server/recall-accent.test.ts`、`server/message-recall-evidence.test.ts`；修复 `16fbe2e8c`，`a633cbb0c` 完整门槛与独立复审通过 |
| L07 | 大批测试通过仍可能漏掉文件体积守卫；第一轮 config 超限直到第二轮被发现 | 每轮最终提交都运行源码体积守卫、相关 lint/typecheck；拆分职责，不抬预算或挤空白绕过 | `scripts/testing/file-size-ratchet.test.ts`；抽取 `a0c4938c7`，守卫通过，message-db 958/config 1274 行，预算未改 |
| L08 | 文件存在/import 存在不代表接线有效；静态调用存在也不证明可达或授权正确 | 结构契约配行为回归；至少验证真实断线变异失败、等价重构控制通过，明确静态局限 | `scripts/testing/patch-contracts.test.ts`、`node scripts/check-patches.mjs --verify` |
| L09 | helper 或假回答命中，可能只是当前聊天 replay、查询自带答案或前次注入残留 | 源事实放另一授权线程，查询不带唯一标记，每次用新查询线程，检查新增 user prompt 的 RECALL 围栏 | `server/chinese-history-recall.e2e.test.ts`、`server/memory-layer.e2e.test.ts` |
| L10 | 返回 LIMIT 不等于查询成本有界；最近 N 条窗口会漏掉真正旧历史 | 记录索引/候选 SQL、授权与时间在排序前、原生命中量、首次重建、索引体积和 p95；旧目标放最早记录 | `server/chinese-history-performance.test.ts`，只代表合成样本，不外推百万行 |
| L11 | Mock safeStorage 成功不证明真实 macOS Keychain、签名、重启与安装迁移通过 | 合成事务、真实 renderer/HTTP、打包平台分别记录，未验证就明确写出 | `docs/verification/memory-embedding-settings.md` |
| L12 | 会话后台存在但没有已交付消息，用户可能看不到；等待接口超时也不代表任务停止 | 新会话完成一次初始化并确认实际消息；超时读真实执行状态、inbox、提交和交接，不能重复派写任务 | 开发控制面进度与交接记录；不把 idle/succeeded 直接当验收通过 |
| L13 | 两个对话共享目录切分支、写文件会影响彼此；外层 worktree 不会隔离嵌套 app 仓库 | 写任务在正确仓库的独立 worktree，文件范围明确；未知改动保留，集成串行 | 任务基线、worktree、owner、最终 commit 的交接 |
| L14 | scratch 在启动前创建，但清理只放在启动后的 finally，或 close 抛错后才删除，会漏掉失败路径 | 资源取得后立即登记清理；模拟启动拒绝/关闭拒绝，实际导入测试验证目录消失，不能只数 finally | 中文 e2e 的 onTestFinished、M01 结构契约；第二轮两类实际失败探针 |
| L15 | 测试自身超时/CI job 截止，不等于执行门槛有独立截止或已回收所有后代 | 区分测试、脚本、直接子进程及后代的边界；取消与清理策略配合设计，未验证的退出/回收不要声称完成 | 修复 `b6c2a7a84`：命令/整体预算、信号取消、自有组 TERM→KILL；确认域仍限登记正常 fixture CLI 与自有外组，Windows/Linux 限制见 MAINTENANCE_LOG.md |
| L16 | 修复重音漏召回后，按查询别名计数会把同一个 Café 算两次；通用 NFD 折叠也不完全等于 unicode61 | 兼容第三方分词语义时依真实匹配证据计数，避免维护近似 tokenizer；覆盖词干/复数别名及多重音预组合字符的单命中负例 | 修复 `16fbe2e8c`；真实 evidence/accent 回归已登记，`a633cbb0c` 完整门槛通过且复审 approve；保留两个反例，不能用前一版正例替代 |
| L17 | 为集中归档全局覆写深层 TMPDIR，使 macOS Unix socket 路径达到 180 bytes，权限代理 listen EINVAL，真实回合失败 | socket fixture 使用默认/足够短的临时路径，日志运行后复制到证据目录；先定位环境错误，保留失败证据，再原样重跑，不改产品或跳过测试凑绿 | 第二轮候选 332577a04 首次环境失败已诊断；恢复默认 TMPDIR 后同门槛通过，两个结果均保留 |
| L18 | 只测外层 POSIX 组会漏正常 spawnCli 自建的内部组；外组 gone/cleanupConfirmed=true 时内组仍可能写 HOME | 审查必须追踪真实 fixture→server→driver→spawnCli/关闭确认链，不能把正常内部拓扑统称恶意逃逸；局部组确认不作全资源退出或删目录依据 | `b6c2a7a84` 已修：外组与登记内部资源分开确认，unknown 保留目录；真实 awaited/unawaited/forced probe 与 41 文件/822 项门槛通过。确认域仍限本次登记正常 fixture CLI 与自有外组 |
| L19 | Vitest 4.1 会过滤 manager 的普通 `--import`；只测单文件会漏跨 worker/隔离文件的初始化。INIT 监听晚建还会产生发送竞态 | 验证能力用受控 bootstrap/`--execArgv` 明确传入 worker，先 awaiting-init 再发送；同时测同 worker 多文件、两个 worker 和 restart。能力不进产品 env/MCP，失效必须 fail-closed，不能退回无声 noop | `scripts/testing/verification-*.ts`、`patch-gate-cli.test.mjs`；第三轮独立验收 5 个 Runner suite/78 项通过 |

| L20 | “搜索已过滤”不等于“模型提示已过滤”：superseded 条目仍随 MEMORY.md 每回合注入；过期多行条目只删首行还会漏续文 | 区分存储原文、搜索投影、模型提示投影和 capture 输入；按条目 line..end 整条过滤，先过滤再预算，空结果不回退原文，UI/审计原文保持可读 | `server/workspace.ts`、`server/memory-upkeep.ts`、`server/memory-prompt-projection.test.ts`；`1e8e00f4a` 完整门槛与独立验收通过 |
| L21 | HTTP 2xx 不代表 feed 有效：缺 tag/空 tag/无效版本被当成“没有新版”，重试又保留旧错误；合并型状态容易残留旧版本 | 验证响应契约后才比较版本；失败固定脱敏、可重试，不显示最新；开始检查清旧 version/message，timer/IPC 共享在途，迟到结果不覆盖新结果 | `electron/updater.mjs`、`electron/entropybot-updater.test.mjs`、`SettingsModal.manual-updates.test.ts`；`1e8e00f4a` 通过 |

| L22 | 只靠摘要提示“保留约束”不能防止中段约束在连续压缩中丢失；摘要文本里的伪块又可能被下一轮当成可信约束 | 用有界结构化约束块并随真实 compaction 记录传递；只接受末尾完整行结构的程序块，普通消息/引用/JSON 转义摘录不获得快照身份；空状态要写显式空尾块，不能靠省略块让旧摘录复活 | `server/active-constraints.ts`、`server/compaction-summary.ts`、`server/compaction-constraints.test.ts`；`e0ed9097d` 完整门槛与独立验收通过 |
| L23 | 中文“编号”与英文 `\b` 不兼容；共享 must/reference 模板词会让纠正 7319 误删 8888；“尚未完成/不要取消”会被当完成；非法日期或空快照会误删/复活 | 中英文 ID 分开匹配并按明确 ID 隔离；否定/歧义保守保留；校验真实日历；空状态、超限、脱敏都要显式可见，不靠删断言或放宽预算 | 同上；覆盖两轮伪块/空状态、7319/8888、a1/b2、否定、非法日期、URL canary |

| L24 | “本地 Stop 成功”不等于远端工具未执行或已回滚；只看最终回复/idle 会漏掉迟到回执污染新回合 | 用真实生产入口和受控假工具数清楚未接受/已接受未回包/已完成未回执/审批未允许；分别检查旧副作用、回执尝试、旧/新 turn 事件、工具行、调用计数和未知提示；不把停止当跨服务事务 | `server/openai-stop-receipts.e2e.test.ts`、`server/testing/late-tool-fixture.ts`；`2fa4bf838` 完整门槛与独立验收通过 |
| L25 | 测试可能落后于已接受契约：`openai-chat-tools` 仍要求跨轮复用 call ID 被拒绝，而实现已明确允许跨轮、只拒绝同批重复 | 发现失败先判断是产品回归还是测试契约过期；不要把产品改回旧行为。更新测试为“跨轮允许一次、同批重复拒绝”，保留正负例 | `server/drivers/openai-chat-tools.test.ts`；`05730b861` 修正后 124 项通过 |
| L26 | 品牌更名后 Safe Storage 密钥按应用名变化，保留 userData 仍会读旧库失败；`availability=true` 与通用 decrypt 错误不能区分错误密钥和 ACL 拒绝 | 旧名读取必须在 ready 前设名的独立子进程完成（服务名在主循环阶段固定，当前进程也可能已缓存密钥）；迁移先备份、加密写入、回读逐字段校验、原子替换，替换前失败保留当前字节并保留明文（外部写入不能被旧备份恢复覆盖）；同一文件失败不反复弹授权，成功标记同时记源/结果 hash，恢复旧备份可再迁一次；“替换成功但标记失败”仍算成功；取消先 TERM→KILL，未确认退出不删临时 profile，启动/spawn 同步失败也走失败返回；禁止用真实凭证做故障实验 | `electron/credential-namespace-migration.mjs`、`electron/main.mjs` legacy 分支、`electron/credential-namespace-migration.test.mjs`、`scripts/testing/legacy-credential-read.e2e.py`、`docs/verification/credential-namespace-migration.md`；真实 Keychain 授权/升级/回滚仍待平台验收 |

| L27 | 内部 flag 加调用者环境并不授权明文导出，base64 管道可逆；await 前源 hash 检查不能阻止之后覆盖并发写入 | 读秘密前原生确认默认取消，不设环境绕过；明确用户授权不等于父进程鉴权。await 后、rename 前重查源字节；失败只删本事务临时文件，不能恢复陈旧 original 覆盖外部写入。子进程 error 不等于退出，控制失败也要等待 close 或保留 profile | `credential-namespace-migration-child.test.mjs`、`credential-namespace-migration.test.mjs`、runner/rollback suite；`docs/verification/release-0.2.5-rollback.md`。仍无跨进程原子 CAS、真实 ACL/稳定签名回滚证明 |
| L28 | 选择性 DYLD interpose 不能保证隔离真实 Keychain；service 带长度不能按 NUL 字符串读；默认项/搜索列表未变不证明无凭证访问 | 禁用该探针并撤回绝对保证，不在用户账号补 hook 试错；原生显式私有 Keychain 与 Electron mock 的证据分别记录。平台 fixture 创建资源即登记清理；查询异常也需报告原始错误；退出未确认保留目录 | `keychain-service-probe.py` 已无条件停用；`credential-namespace-migration-fixture.node-test.mjs` 覆盖五类合成清理路径。自有进程组之外的脱组后代不在保证内 |
| L29 | manifest 生成时 HEAD 不是产物构建提交；Node suite 命名 `.test.mjs` 会被 Vitest 当空套件；unsigned DMG 无法满足正式容器主签名门槛 | 正式构建要求干净已提交版本并记录 source/tree/lock；最终签名/票据后算产物 hash。Node 使用 `.node-test.mjs` 并入 Node 门槛。正式 override 开启 DMG 签名，校验容器与嵌套代码，缺证书不降级。纯清理测试用自己的临时根，Ubuntu/macOS 实际执行，不跳过凑绿 | `scripts/release-signing.node-test.mjs`、统一 patch gate；真实 Developer ID/公证未验，用户无会员/证书，旧包 sourceStatus 不能追认为已验证 |

## 0.2.6 全仓回归补充

- CLI 夹具复制可执行入口时必须同步复制其传递依赖；`verification-lifecycle.ts` 引入 `verification-external-stop.ts` 后，缺文件使真实 CLI 在报告/租约检查前启动失败，表现为模块解析失败、等待超时和 HOME 断言连锁失败。补齐实际依赖，回归入口 `scripts/testing/patch-gate-cli.test.mjs`，21 项通过；不能因次生失败降低生命周期检查。
- Vitest 模块 mock 不会自动影响另一个 Node 子进程。附件启动故障通过 `launchVerificationServer` 的 disposable dataDir 启动前钩子真实制造，保留服务日志、500 拒绝、修复后 201/内容和目录回收断言；回归 `server/attachments-startup.test.ts`。外部停止/重启必须经过统一生命周期管理，保留内部退出回执，不能手动 kill 后把 close 失败当清理成功。
- 品牌字符串不能机械覆盖真实部署域名、secret binding 或已发行协议。control-plane 测试必须按固定部署配置使用合成 token；companion 归一化保留调用者选择的主机，不能把旧域名静默改写为新域名后发送配对码。回归 `cloudflare/control-plane/test/endpoint-accounts.test.ts` 与 `electron/desktop-companion-client.test.mjs`；未以真实凭证或云账号验证。

- 独立复审退回 R1–R4：域名兼容要按实际部署主/次账号覆盖 normalize、stored access、pair 和拒绝发送负例；connector 安装器改名必须追到真实 e2e 的 env/容器/卷/身份断言，不能只测脚本文本；Linux 策略内容、builder 资源、hook 根路径和加载/卸载名称需一起核对。归档 workflow 契约通过只证明历史文件，不证明当前启用的发布 gate。源码补齐不等于 Linux/Docker 实测；缺执行环境或可信镜像时显式保留平台阻断，不能机械给旧镜像 digest 换仓库名。

## Chrome 子进程关闭边界

- Node 24 的额外 stdio pipe 是 Duplex；`exit` 只证明根进程已退出，`end()` 只结束写半边，均不等于 `ChildProcess.close`。CDP launch 的 close/kill 和握手失败收尾必须回收本端 fd3/4 并有界等待实际 close，registry 在 close 后才移除；超时抛错、保留 profile/registry 证据。回归 `server/browser/chrome/launch.test.ts` 使用真实 Node 假 Chrome 和短暂继承 fd3/4 的辅助进程制造 exit 先于 close，另用 mock 验证 close 永不到及握手失败清理未知；`server/browser/cdp/connection.test.ts` 验证两端完整销毁。根进程 close 不证明所有 Chrome helper 或外部资源已消失，需单独进程审计。原 S4-actions 功能 32 pass 但缺 close 的 `ok:false` 记录不得被补验覆盖。

- Chrome-close 复审 C1–C3：launch 局部等待 close 不足以保证 profile 保留。`ChromeCleanupError.cleanup` 明确区分 closed/unknown/cleanup-failed；service、校准和手动 CLI 的实际目录 owner 都必须传播该状态，unknown 不擦除、不释放控制句柄，独立 loopback 仍关闭。sweep 对活 owner 的记录不能按 root PID gone 回收；dead-owner 也须确认根进程已消失才恢复。实际 close 的事件 Promise 不执行 registry I/O，I/O 失败经调用方报告为 cleanup-failed 并可安全重试，不能从事件抛出或误报没有 close。回归 `close-retention.test.ts`、`calibrate-cleanup.test.ts`、`omb-browser-cleanup.test.ts` 及 launch/processes 测试；不以先前真实 happy-path 替代这些失败路径。

## 不应合并的改动

- 未知来源的可执行脚本、安装钩子、依赖替换、远程下载后直接执行，或难以解释的混淆代码；需先理解用途、核实来源和运行边界。
- 未经用户目标支持的凭证/记忆外发、日志回显密钥、把安全凭证退回明文、扩大工具/网络/文件/管理权限，或新增隐蔽持久化。
- 把测试失败隐藏成成功：跳过测试、空 suite、吞异常、删除断言、禁用正确性 lint、提高体积预算，或修改测试让它只复述实现。
- 为了通过检查而保留死 import、死调用、重复实现、临时兼容分支，或绕过既有鉴权/更新来源/迁移契约。
- 从上游整文件覆盖本地身份、更新源、Keychain/profile、迁移和记忆接线；把组合 PR 的全部变更当作一个必要修复。
- 修改了配置/协议/缓存/数据库/环境传播，却只验证一个 helper，没有覆盖真实调用者和失败后的后续操作。
- 未按最终集成提交验证，或把前一个提交、某个分支、另一 worktree 的通过记录当作当前组合结果。

发现明确恶意或越权行为时，停止集成该候选、保留脱敏证据并说明影响范围；继续独立且不受影响的任务。不要执行可疑代码来“看看会怎样”，不要删除用户未知工作或凭证。没有证据时写为疑点，不宣称已发现恶意代码。

## 经验记录格式

新增条目包含：触发条件、影响与实际证据、根因、修复提交、可执行回归、尚未验证边界。先用最小失败用例确认，再修复；能落到测试或类型约束的经验应落到代码门槛，文档不能替代执行。

维护时合并重复条目，保留决策依据；同一规则不在多个 README/计划里各写一套。本文是应用侧经验真源，具体轮次日志与截图由主控项目的结果文档保留。
