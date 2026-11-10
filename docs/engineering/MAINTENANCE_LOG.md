# 维护审查记录

## 2026-11-10：M1 journal undo 有界候选

- 基线 `d76d40da3ee5090e1b09071b4f5aef6989e3e173`；限定 journal/store 两份产品源码及相关tests/docs，无依赖、安装脚本、权限、网络、模型/提供方、schema、主控集成或真实数据变更。审查 selection→preflight→同步mutation→journal append 与 HTTP/UI refusal；安全文案无全文/私有路径，原allowlist/symlink/redaction保留。
- 确认根因：旧undo无after-state校验，缺失和空文件hash相同；created/delete分支可能覆盖/删除后来事实。补可选existence＋hash条件与实际mutation边界复核，冲突不追加phantom row。维护债边界：跨进程/ABA/最终read后原生重入无原子CAS保证；不扩为一般遗忘或擦除。
- 真实隔离HTTP、实际journal/fs边界、mounted UI及原layer/auth回归与size/docs/types/lint的准确argv、pre/post源码hash、退出码、fixture状态在本轮私有证据目录；[验证说明](../verification/memory-journal-revert-conflict.md)列入口与限制。原夹具失败与修正保留，最终数字/提交由外部handoff绑定，待独立复审后才可串行集成。这里只完成本任务增量审查，不冒充全仓/每周总控审计。

## 2026-11-06：第二轮首次增量维护

- 触发：用户要求定期维护与经验沉淀；本轮接受前的首次专项。
- 只读审查范围：`c1aeda250..132bbf6aa`，5 个提交、16 个文件。维护角色只看该范围及必要上下文，没有审计未变化的全部代码或依赖。
- 实际动作：Git 元数据/差异、package/lockfile/install hook blob 对比、脚本与 workflow 的进程/环境/权限/外发/删除边界阅读。未执行可疑代码、产品脚本、安装或真实数据实验。
- 结果：本范围未发现足以确认恶意行为、新增隐蔽外发或权限扩大的证据；依赖和安装钩子未变。这不代表整个项目或后续提交已获安全证明。

| 项目 | 发现与处置 | 状态及证据边界 |
|---|---|---|
| M01 | 中文回合 e2e 启动失败或 close 抛错会跳过 scratch 清理。主控在目录创建后立即用 Vitest onTestFinished 登记删除，去掉对顺序 close 成功的依赖，并加注册结构契约 | 已关闭：`a633cbb0c` 正常服务 e2e 和完整门槛通过；实际导入该 e2e，分别注入 launcher 拒绝和 close 拒绝，两例均观察到预期失败且目录已删、零网络请求；探针源码与输出保存在第二轮 evidence，不冒充正常业务测试通过 |
| M02 | patch behavior runner 的 spawnSync 无独立 timeout，进程挂起时 finally 无法进入；CI 有 20/60 分钟 job 限制，但强制取消不证明所有后代已回收 | 待安排的可靠性维护项，未动态复现残留，不认定恶意驻留或安全阻断；已登记主控 OPT-009。需统一执行生命周期、限定截止与取消策略、合成挂起子进程/后代退出证据；不得只加 timeout 后就宣称清理完成 |

源码体积超限和重音词兼容性是既有审查事项，不重复算作维护新发现。其修复和后续增量已在下述 2026-11-07 收口中复审；最初只读报告仍只对应自己的范围。

经验入口：`AGENT_LESSONS.md` L14/L15。完整范围、命令和证据由主控第二轮结果文档归档。

## 2026-11-07：第二轮接受前收口

- 维护角色补审 `132bbf6aa..a633cbb0c` 的 15 个文件及必要上下文，没有新增安全或维护阻断项；未见限定增量新增外发、权限扩大、远端执行、危险删除、长期缓存或第二数据库的证据。这不是整仓无恶意证明。
- 独立功能复审 `a633cbb0c` 为 approve，两项单命中误计已修；独立执行同提交完整门槛为 30 结构契约、33 个 Vitest 文件/689 项、5 个 Node 文件/29 项通过，无 skip/todo。维护角色仅静态审查，未冒充亲自执行这些测试。
- 主控的最终 typecheck、定向 lint、源码体积守卫通过；module 抽取没有提高预算。M01 的两类失败探针及正常服务 e2e 支持关闭；M02 继续为 OPT-009 待安排，不宣称已新增独立截止或完整后代回收。
- 收口后仅更新经验和维护文档，不改变已验证的产品代码；最终应用提交及文档提交由主控结果文档分别记录。
- 已完成轮次为 2；下次集中审查在收口后再完成三轮，或下周首次开工时触发，以先到者为准。每轮轻量审查和上游/依赖/安装/权限边界变化的专项不因此跳过。

## 2026-11-07：第三轮 Data 独立交付，Runner 仍隔离

- 已审查的 Data 原提交 `ef0ede249` 及登记提交 `c890454b7` 独立接受，不包含 Runner 候选代码。实际交付完整门槛：30 结构、36 个 Vitest 文件/744 项、5 个 Node 文件/29 项通过，外部监督预算240秒，91.25秒正常退出，未触发终止信号。
- Data 独立验收另有3文件55项及1项时序 probe；源码 engine hash 与交付相同。它们不与完整门槛相加宣称独立总数，也不证明所有 bot Stop 或跨平台已验证。
- M02/M03 正常内部自建组确认链未关闭，候选保持隔离。局部外层组确认不能用作所有资源退出或实际 HOME 删除的依据；原通过和后续反例均保留，经验 L18 已加入主项目供后续 agent 阅读。
- 此次仅先交付已完成的独立 Data 组件，第三轮整体尚未结束，不重置集中审查的轮次计数。本机应用未打包/安装/重启；新 Runner 的最终代码、真实协议与维护验收继续进行。

## 2026-11-07：第三轮 Runner 收口

- 最终候选 `b6c2a7a84` 从已接受 Data HEAD 重建，按 `9c38040f3`、`9549a1630` 合入 Runner，再登记 `b6c2a7a84`；没有合回旧 combined 分支，也没有重复应用 Data。
- 完整组合门槛在 Darwin 实际通过：30 结构契约、41 个 Vitest 文件/822 项、5 个 Node 文件/29 项，无失败/skip/todo；外部监督 600 秒预算，131.73 秒 exit0，无强制终止。
- 独立执行验收另跑 8 个相关文件/133 项：Runner 5 文件 78 项、Data 3 文件 55 项全部通过；与主控完整门槛有重叠，不把两者相加。生产 spawnCli 的 awaited/unawaited/forced 三场景实际通过，forced 保留目录且内部心跳继续，未据外组 gone 删目录。
- 独立代码复审 approve；维护/安全审查未见本增量新增确认恶意、越权或必须阻断项。M03 的“局部外组确认冒充全部资源退出”缺口已关闭；M02 的执行截止/取消/自有组回收已实现，确认域仅限本次登记正常 fixture CLI 与自有外组。
- 保留边界：仅 Darwin 实测，Linux/BSD 未实测；Windows/未知平台在行为命令前 fail-closed；脱组后代、PID/PGID 观察窗口复用、同 UID 恶意测试代码、父被 SIGKILL/OS 硬停不在绝对保证内。真实 Keychain、安装包/签名升级、真实模型质量未验证。
- 收口后应用源码 `b6c2a7a84` 再仅追加经验/维护文档；本机应用未打包、安装或重启，未推送发布。第三轮完成，下一次集中审查在再完成三轮或下周首次开工时触发，以先到者为准。

## 2026-11-07：第四轮记忆投影与更新失败提示

- 最终候选 `1e8e00f4a`：记忆提示按整条 `line..end` 过滤 superseded/expired，先过滤后预算；capture 输入独立投影、仍读原始 notebook；原文/UI/archive/journal 保留。桌面手动更新把缺 tag/无效版本/HTTP/超时/坏 JSON 统一为固定脱敏、可重试失败，不再显示“已是最新”，重试清旧状态，timer/IPC 共享在途。
- 完整组合门槛：30 结构契约、43 个 Vitest 文件/853 项、5 个 Node 文件/29 项通过，无失败/skip/todo；137.65 秒 exit 0。独立验收另跑 15 文件/233 项全部通过，两组测试与主控完整门槛重叠，不相加。独立复审 approve，维护/安全审查无新增阻断。
- 范围边界：只证明笔记提示投影，不删除历史聊天、压缩摘要、memory/log、journal、备份或向量，不称彻底遗忘；真实 Electron IPC、系统安装、真实网络与模型行为未验证。
- 收口后应用源码再加经验/维护文档，产品/测试不变。第四轮完成；本机应用未打包/安装，未推送发布。下次集中审查在再完成三轮或下周首次开工时触发。

## 2026-11-07：第五轮长对话约束保留

- 最终候选 `e0ed9097d`：摘要投影加入有界活跃约束块（最多 12 条/1800 bytes），支持新增、纠正、完成/取消、过期；摘要输入先为块留空间，确定性/模型回退均保留。只从真实 compaction 记录的内部元数据读取旧块，且必须是末尾完整程序块；普通消息/引用/JSON 转义摘录不获得信任。空状态写 `- (none)` 尾块，避免取消后旧摘录复活；中文“编号”独立识别并按 ID 隔离；否定/未完成不误删；非法日历保守保留；URL/secret 脱敏；超限显式省略。
- 完整组合门槛：30 结构契约、44 个 Vitest 文件/875 项、5 个 Node 文件/29 项通过，无失败/skip/todo；142.8 秒 exit 0。独立验收 5 文件/103 项 + 11 组 probe 通过，与主控 gate 重叠不相加。独立复审 approve，维护复核无新增阻断。
- 过程边界：候选曾两次被复审/验收退回（旧转义块复活、伪块注入、CJK 否定、7319/8888 串扰、空状态与中文编号），每次先补红例再修；最终三项独立结论均绑定 `e0ed9097d`。真实模型是否服从约束、全部自然语言改写、Windows/Linux、Keychain/安装包未验证；约束上限和启发式 cue 是明确限制。
- 收口后产品/测试不变，只追加经验/维护文档。第五轮完成；本机应用未打包/安装，未推送发布。下次集中审查在再完成三轮或下周首次开工时触发。

## 2026-11-07：第六轮停止后迟到工具回执

- 结论：现有生产停止/回合隔离已经正确，本轮**不改产品代码**。新增真实 `launchVerificationServer` + 生产 OpenAI-compatible driver + 真实 stdio MCP + loopback 假工具的回归，覆盖审批未允许、未接受、已接受未回包、已完成未回执四阶段；旧副作用/回执不结束、污染或显示新 turn，不自动重发；已接受未知保留“可能已生效，重试前核实”。另修正过期测试契约：跨轮复用 call ID 允许一次，同批重复仍拒绝。
- 完整门槛：30 结构契约、46 个 Vitest 文件/1000 项、5 个 Node 文件/29 项通过，159.2 秒 exit0。独立验收 8 文件/217 项通过；独立复审 approve；维护/安全审查未发现新增阻断，但记录一条既有测试清理登记顺序的维护债，未在本轮改。
- 边界：真实模型/第三方服务取消与幂等、跨平台、全部队列交错未验；产品停止仍不是远端操作回滚。测试实际使用 loopback 网络、本地子进程和临时文件，不能称零网络/零进程。
- 收口后产品/测试不变，只追加经验/维护文档；本机应用未打包/安装，未推送发布。第六轮完成；停止/恢复地图中的真实跨服务回执仍是后续候选。

## 2026-11-07：0.2.5 发布前增量审查

- 触发：第六轮后凭证迁移与诊断/发布脚本变化，按凭证、安装发布与三轮集中增量规则补审。基线 `2905edd58`，本轮产品/测试集成 `f7634cc73`；A/B/C 分支各自隔离，主控串行集成。外层 `gorkbot/docs/release-0.2.5-readiness-round.md` 保存完整分工、提交和最终命令结果。
- A 的大小写夹具原先创建 `Entropybot` 却访问 `OPENENTROPYBOT`，已改为仅大小写变体并保留读/list/write 拒绝断言与真实目录身份检查，产品保护代码未改。新迁移测试追加进统一门槛，旧检查未删除/放宽。
- B 确认内部旧名 flag 可直接向管道输出可逆 base64 凭证；现读取前原生确认默认拒绝，明确用户授权不冒充父进程鉴权。await 后替换前重查源字节，失败不恢复陈旧副本覆盖并发写入；已启动子进程 error 进入取消/等待 close，退出未知保留 profile 和证据路径。
- C 确认选择性 interpose 无完整 Keychain 隔离保证，且按 NUL 读取带长度 service 有越界风险；入口无条件停用、C/JS 删除，旧绝对隔离/三组通过声明撤回。未确认实际真实凭证外泄或恶意行为，不把源码风险写成已发生事故；既有授权迁移和独立私有/mock 实验保留各自证据。
- 发布清单的生成 HEAD 不能冒充构建来源。新增独立正式签名准备入口，缺 identity/team/notary profile 时先失败；只消费既有证书不导入、不自动公证/发布。本地旧包 manifest 明确 source 未验证。正式 App/Mach-O/DMG 的身份、团队、时间戳、票据和 Gatekeeper 均为门槛。
- 复审退回与修正：平台 fixture 初始化/最终查询失败漏清理，超时只确认直接进程；现从资源取得即登记，使用自有 POSIX 组，未知保留 scratch，五项合成故障回归通过。纯清理测试改为自有临时根并在 Linux/macOS 执行。Node suite 原误命名导致 Vitest 空套件，已改 `.node-test.mjs` 并入 Node 门槛。正式 DMG 原继承 unsigned 配置，现显式签名并增加六组容器/嵌套代码失败检查。经验 L27–L29 记录根因和限制。
- D 对 A/B+cleanup、E 对签名准备修正分别只读 approve。主控 lint、typecheck、定向契约/体积、12 项签名 Node 测试及正常合成平台验收通过。产品/测试提交 `f7634cc73` 的最终统一门槛实际通过：30 结构契约、51 个 Vitest 文件/1051 项、7 个 Node 文件/42 项，无失败/skip/todo；Vitest 阶段 161.47 秒。首次 typecheck 因 60 秒工具预算中止，300 秒预算重跑 exit 0。更大范围全仓 Vitest/Node 回归由 A 路独立执行，结果与限制见外层日志，不把统一补丁门槛冒称全仓通过。后续收口只更新本文，不改变已验的产品/测试源码。
- 依赖/lockfile/安装钩子未变化；未新增用户数据外发、证书导入或发布动作。正式构建会复用既有固定来源资源准备，需在未来获授权的构建中再次审查执行证据。用户没有开发者会员与可用身份，正式签名/公证继续阻断。本轮没有替换/重启当前安装应用，只有用户授权的固定合成文本连接测试返回 1024 维。
- 限制：真实 Electron ACL Deny/lock、稳定签名升级/回滚、全部脱组后代、自有源码记录抵御同 UID 篡改、Windows 均未获本轮证明。旧版本 reader 只在 mock 中证明格式兼容，不能替代真实旧安装包回退验收。

## 2026-11-07：0.2.6 全仓失败修复增量

- 范围：`1f3e641db` 后的回归失败修复，独立 `release-completion-fixes` worktree。早期 13 组全仓未通过（39 失败、251 skip、3 todo，control-plane 启动失败）；不能以本轮定向结果追认早期全仓成功。
- 生命周期：测试使用受管 stop/restart 获取内部退出回执，附件启动故障通过私有 dataDir 真实阻塞而非跨进程模块 mock；仍保留日志、失败上传、修复后内容及资源回收断言。CLI 合成 checkout 补齐传递依赖，保留取消/超时/未知资源保留 HOME 的断言。
- 安装脚本审查：connector 名称、环境变量、挂载路径及 Docker entrypoint 与既有 `connector/src/settings.ts` 对齐；没有执行安装器、Docker 拉取或真实系统修改。权限仍为既有 Docker socket/root 能力，不新增权限；镜像由已有 digest 接口供应，未新增远程执行入口。旧部署容器/卷未做自动迁移，不能把名称对齐当真实 Linux 升级通过。
- 域名：control-plane 的真实部署旧域名/secret binding 保留，测试使用对应合成 token；companion 接受固定格式托管地址但不把旧地址静默转发到新域名。无真实配对码、凭证、用户记忆或云账号参与。
- 检查：UI/server typecheck、全仓 lint、体积守卫、安装 shell 语法、定向产品/夹具回归通过；control-plane 143 项通过。`lent` 从零残留 todo 提升实际禁词检查；另外两项 UI 命名 todo 与条件 skip 仍未关闭。最终组合全仓、补丁行为门槛与独立复审证据由外层 `docs/release-0.2.6-validation.md` 按最终 HEAD 记录，不能把此处定向记录当发布放行。
- 未改依赖版本、lockfile、包管理器安装钩子或真实应用数据；本轮确实修改了 connector 安装脚本。正式签名/公证仍缺 Developer ID/会员。本轮源码修复未代替实际构建安装，S6 生产背景归因、公网 TLS 与 Windows HOME 保持未验证。
- 独立复审 R1–R4 退回后：companion 补实际部署主域 `openmausbot.com`，主/次旧域各覆盖保留原地址、stored access、pair 精确调用和不安全/lookalike 地址零发送。connector e2e env、对象名、数据保留/回滚/secret 断言全部对齐；旧 home fixture 镜像仓库不符合现有协议，不能伪造同 digest 新仓库，改为要求两个可信、不同且按允许仓库固定 digest 的显式输入。Linux hook 对齐 `/opt/Entropybot`、新资源/策略、测试 env；卸载保留精确旧 launcher/policy 的受控清理，并保持 parser 拒绝时留策略文件。
- R2/R3 的源码/语法及 macOS 可运行定向检查与 Linux 实际执行分开记录。本机无 Docker/Linux VM，未执行 root 安装、内核策略或容器升级/回滚；缺两份可信镜像，connector e2e 仍是平台交付阻断。归档 workflow 检查只证明历史契约，未作为启用发布 gate 的运行证明。

## 2026-11-09：每周首次开工集中增量审查（工程分支）

- 触发：周一首次开工（AGENTS 每周/三轮先到者）。只读范围 `392f54255..6daad935d`，33 文件、+1559/−160：manual-routine 幂等回执抽取、context 协议、受保护路由、前端 intent 消费者、V1-R2 FIFO 修复。会话 `ses_e43e42f41ffegdbfKMlYPqBmmg`；未跑产品/测试/网络，V1 文件只盘点不审。
- 结论：无新增安全/架构阻断；回执抽取未产生第二 authority 或第二调度器，principal/authority 由 `manualAuthority`/`personKey` 共享，context 非 secret 只经 header 不经 URL/日志，ledger 32 条与 HTTP receipt 1000 条均有界，无依赖/lockfile/workflow/安装钩子变化。
- 新 P2（当轮发现，后续已关闭）：前端 `routine-run-intent.ts` 两处权威 metadata GET 未传 timeout/signal；api.ts 仅在给定 `timeoutMs` 时加截止。预检永不 settle 则操作停留 inFlight，同 routine 后续订阅并挂住，details 保持 busy，POST 的 30 秒超时根本到不了。当时为静态发现，未动态复现，与 coalescing/readback 不同根。后续已有 `MANUAL_ROUTINE_PREFLIGHT_TIMEOUT_MS=5000`、共享 AbortController/请求和body截止及finally回收；回归 `src/state/routine-run-intent.integration.test.ts` 的 stalled preflight 用例。2026-11-09 A1完整候选ac389fc3a和工程09abbd32a均包含该实现；关闭依据为既有交付/组合证据与本次源码核对，本次未重跑该回归，不重复派发。
- 当轮未验证：完整浏览器 reload、多标签、unmount-in-flight、原生后端端到端、远端 CI。后续reload及unmount隔离已有独立合成证据，多标签仍独立诊断；不追认本次旧审查亲验。F2 producer 仍被 Chrome HOME 隔离前置、发布候选 HEAD 与远端 CI 验证阻塞。审查墙钟与 model wait unknown。

## 2026-11-09：A1 多轮收口后的集中增量维护与安全审查

- 触发：连续多个产品切片已交付，按每三轮/每周先到者补充集中增量审查。只读范围 `a92388449..ac389fc3a` 及必要上下文，71文件、+2728/−126；审查会话 `ses_e426c4b03ffeSJJqmp978XQm78`。候选HEAD/tree和clean状态核对通过；工程09ab与候选分开记录，ff/ae未正式合入。
- 结论：未发现新的、证据充分的维护或安全阻断，不是整仓安全证明。复用此前独立审查/失败修正/回执，未跑测试、探针或浏览器，不将既有111文件1121通过/2todo、4browser写成本审查执行。
- 跨模块核对：版本化plan/manual-local-bot准入/run快照与原HTTP receipt身份一致；无第二authority/调度器。reader逐跳校验DNS并pin连接地址，保留Host/TLS、有限页/跳转/字节/截止、不读Cookie/应用凭证。合成host/port hook仅测试显式preload，没有生产旁路。
- 发布与文件：入队不等于发布，posted确认持久保存thread/message身份；取消/删除/缺失run阻止旧摘要。报告GET独立校验audience/receipt/plan/completion/root/普通单链接/no-follow/nonblock/替换/hash/schema，显示投影不授权文件读取。每次报告dispatch最多60秒，不保证无限繁忙后必达。
- 客户端：实际流字节先受限再解析JSON，取消/失败释放reader；exact-run和卸载隔离保留。候选公共摘要投影只改显示、不改持久对账字节；两个摘要解析器职责不同，未确认有必须删除的重复路径。
- Git差异证明本范围无依赖/lockfile、安装脚本/hook、workflow、许可证归属或上游来源替换变化，无merge commit；未发现确认恶意行为或隐蔽外发证据。
- 保留事项：pt-BR母语审核未完成，不能正式合并/发布放行；This computer/My Cloud两个copy TODO不算执行覆盖。多标签归独立诊断owner，不重复。真实TLS/站点、完整Team Cloud HTTP audience、断电一致性、内核I/O截止、native/package、全仓/远端CI均未补证，历史重启undefined根因仍unknown。
- 本条仅维护记录；未构建、安装、推送、调用真实模型或访问live数据/Keychain。
