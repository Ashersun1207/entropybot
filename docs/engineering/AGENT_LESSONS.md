# Agent 工程经验：避免重复犯错

适用 Entropybot 开发、审查、验收和上游集成。任务开始先读，针对本次改动选取相关条目；发现新失败模式后更新相应回归和本文。这里记录证据与经验，不把潜在风险直接称为已确认的恶意代码。

## F2：原始 archive 的 bin 不能当作 lifecycle hook

- 精确 registry archive SHA-512 同时匹配 lock SRI 与 metadata 后，Electron 43.7.9 原始 manifest 确认没有 scripts 字段；install-electron 仅是 bin 映射。原 manifest、install.js、checksums.json 与声明的本地 node_modules 路径三个文件逐字节相同，不能把缺 hook 推定成本地篡改，也不能自动补显式 provisioning。安装 policy 的旧 unknown 状态不在此审查候选中激活或改写。
- Node 24.22.2 的官方 darwin-arm64 archive 与官方 checksum 一致，独立 regular bin/node 字节已哈希，但 archive 的三个 symlink 仍按本轮 no-links 规则拒绝 provisioning。pnpm 10.33.0 原始 bin/dist 字节仅受 registry metadata SRI 绑定，不冒称 root-lock 依赖。已下载签名但未验证可信 key；bundled executable hash、独立审批、实际运行和完整历史分别记录。
- 原 collector 的 Node checksum parser 忽略合法 source/Windows 路径，首次退出1；保留原脚本/日志和未下载 Node archive 的事实，修正后完整解析 manifest，限制全部 gzip 展开字节，合成覆盖 SRI mismatch/traversal/oversize/duplicate/symlink。证据及限制见[原始工具链候选](../verification/pristine-toolchain.md)。仅 docs/data，无安装、下载代码执行、信任根/317 pins/77 dispositions/15 jobs/5 steps 改动，须独立审查与主控串行整合。

## F2：Actions 身份必须绑定完整提交和实际 lifecycle

- `scripts/full-gate.node-test.mjs` 的旧 active-workflow 合同明确接受 github-script 的 mutable tag，且不检查 checkout/setup/upload 的 action 身份。修改前八个真实 workflow 负例均因 missing expected exception 失败：四个 mutable refs、short SHA、未审仓库/提交与 lifecycle action 替换。固定40位 SHA 后，合同同时检查固定仓库/提交、步骤位置和源目录，不能仅把旧 tag 断言换成任意新字符串。
- `scripts/full-gate/action-sources.json` 保存 exact-commit action manifest 原始字节、runtime/main/post、相关源码/package/lock/dist/许可证元数据的 URL 与 SHA-256；经 public closure 纳入314个 review-only pins。测试实际解析四份 manifest，并检查 bundle 身份和重新计算 manifest hash 后的 lifecycle 替换。最初 catalog 生成器用 text read 归一化了 CRLF，正例 hash 检查失败；改为 bytes decode 保留原字节，保留失败回执，不将当次负例绿追认为有效证明。
- 有效 GitHub commit 签名只表明来源元数据。固定 action SHA 不冻结 hosted image、Node24范围、Corepack/pnpm、依赖 lifecycle 或 Electron/其他下载资产，也不证明巨大bundle的所有依赖安全。checkout删除/临时credential、setup下载、upload symlink和独立runtime token、github-script任意Node能力分别记录；本轮不执行下载代码、不安装、不激活信任根。独立审查、安装回执任务与主控串行组合验证仍分别需要。

## F2：安装收据不能由事后来源标签推定

- 独立来源审查发现 synthetic HOME exports 后 Corepack 仍继承整个 job 环境，record-install 未观测安装就写 sourceSha/frozen/lockHash，main/static 又不消费。旧字段不证明实际命令、工具来源、生命周期或安装成功；post-hoc hash 不能追认审批。修复身份以本条提交为准，详情见[安装资格边界](../verification/full-gate-installation.md)。
- 所有生产 lane 入口及 artifact/same-run 消费端加安装资格屏障，旧 writer 拒绝；locked-install 在启动 Node/installer 前退出。精确工具链、pre-JavaScript bootstrap 和 native lifecycle/network history 未批准，生产执行能力刻意不实现；不把调用者的 complete/frozen 字段变成证据，不填假审批或从 host bytes 批准。原结构解析合同单独检查，避免早期安装拒绝使历史负例失去覆盖。
- 新 TypeScript 合成记录器复用 supervisor，保留 actual exit/signal/close 和失败输出；始终 synthetic、frozen null、complete false。真实子进程验证 canary 环境、零/非零/timeout/spawnfail/exit-before-close；全部 main/static/platform 公开入口拒绝旧收据。初轮8通过/1失败是夹具误要求受控 npm registry 不存在；保留日志后改为父 canary 不得出现、固定 public registry 必须出现。Windows 仅合成路径/环境合同，不作真实平台证明。最终六套原 Node＋新 suite、guards/types/lint/pins 证据保存在外层 f2-install-receipt；真实安装、下载、Electron hook、用户工具链字节、模型/数据、Actions、发布均未验。新候选仍须独立审查与主控串行整合。
- 扩展组合首跑417通过/4失败：新增exact-env断言发现Darwin runtime注入__CF_USER_TEXT_ENCODING；三项旧CLI provenance拒绝被更早的job检查遮住。保留实际子进程完整输出和构造env，夹具仅允许该平台额外字段、不追认为审批；main入口先检查repo/event/attempt与HEAD身份，再拒绝安装，原错误断言保留。guards首跑7通过/1失败是新文档未进verification README，补索引、不放松守卫。后续冻结重跑结果见交接。

## F2 安装收据 R1：regular-file 校验必须覆盖 open 本身

- 独立审查 `ses_e3673e8a2ffeAF5rRYa61Ik79B` 对 `4a5577d79f029ae8cd00fae4c39fe5e62ed0b3e9` 返回 NEEDS-CHANGES/P2：consumer 用 O_RDONLY|O_NOFOLLOW 打开后才 fstat，owned FIFO 没有 writer 时阻塞在 open，大小上限和 fstat 都到不了。此前 V1 本地验证回执条目已经记录同类问题，现有 artifact loader 也使用 O_NONBLOCK；本轮自写 typed reader 时未复用这一完整不变量，原421绿例只检查字段与普通输入，漏了公开consumer的无writer FIFO。
- 修改产品前，公开 readInstallation 子进程在有效binding/canonical owned temp上打印 before-read 后实际挂住；外部2秒watchdog报告ETIMEDOUT、SIGKILL并确认reaped，五个symlink/目录/regular/oversized/empty控制按原逻辑拒绝。红例源码、输入/argv/env/time/outcome及最终冻结证据保存在外层 f2-install-receipt/review-r1，不把此前missing-module证明当本次实际hang证据。
- 修复身份以本条提交为准：保留原typed reader/大小/descriptor校验，加O_NONBLOCK并显式拒绝缺少nonblocking/no-follow能力的平台，不改通用artifact loader。回归 `scripts/full-gate-install.node-test.mjs` 的六个真实公开consumer子进程要求before-read、实际domain rejection或symlink ELOOP、截止前正常退出和reaped；watchdog在被测进程之外，startup failure不能冒充拒绝，未确认退出则保留fixture。Windows仍未资格化；nonblocking open不能保证远程/故障文件系统的任意内核I/O有墙钟硬截止。原bootstrap/lifecycle/安装和全部F2阻断不变，须独立复审。

## F2：字面 import 闭包漏掉进程入口与配置派生输入

- 独立供应链审查退回 `96817e8bd`：公开 producerClosure/verifyPins 在262 pins下接受 verification preload、message-search worker、Wrangler配置、migration和docs workspace manifest的实际篡改/删除，也接受额外生成worker。红例与前后SHA/tree/hash保存在外层私有 `engineering-foundation-evidence/f2-producer-closure/`；不追认旧绿例覆盖这些入口。
- 修复身份以本条提交为准：显式入口加字面URL及transitive imports、workspace manifest/config发现、Wrangler main与递归migration目录；路径逐组件拒绝symlink/nonregular/escape。源码producer拒绝生成worker.js，即使Git忽略且status clean；不修改产品fallback。默认ci-retry-runner仅作为配置输入纳入，实际执行仍显式strict runner、不启重试。新候选305 pins，map不自引用，生产trust/reviewer/assets仍空。
- 回归入口 `scripts/full-gate-closure.node-test.mjs`：修改父pin后再引入新URL/子import、配置main/migration、workspace/config，避免所有负例只在旧父hash处拒绝；同时覆盖缺失/多余/篡改、递归新文件、symlink目录/点点别名、特殊文件与ignored生成入口。第1轮定向通过，安全自审补全路径别名与特殊文件后冻结最终验证，精确计数见私有回执。静态受支持语法不证明任意计算导入或配置执行闭包；验证器pins与完整SHA绑定的受测应用须分别说明。独立复审、主控串行整合和安装/平台资格仍未完成。
- 冻结验证的首个守卫argv被Vitest 4.1.11以Unknown option --runner拒绝，尚未启动测试。私有guard配置改为通过test.runner指定原strict runner后8项守卫通过；未修改producer argv。现有producer相同CLI用法须主控另行资格验证/修复，不以fixture成功宣称生产执行可用；历史失败日志保留。

## F2 closure R1：pin verifier 拒绝不代表 source snapshot 已阻断

- 独立审查退回 `9277b1ab4`：生成worker策略只在closure发现执行，Git忽略的worker.js或dangling symlink仍能通过公开source(root,sha)；字面import的.js后缀又未映射到对应.ts/.tsx。修复前公开API红例39通过/4失败，保留在同一证据目录review-r1下；旧receipt的toolchain/probe哈希范围更窄，不补写追认。
- 修复身份以本条提交为准：独立filesystem-only source-policy模块同时供core.source和closure使用，无循环依赖；source每次快照只检查已知worker覆盖路径及server组件，不要求tiny synthetic repo存在完整应用，也不遍历全图。.js字面import只允许js/ts/tsx唯一regular候选，多个候选即使全pin也拒绝；mjs/cjs和执行URL无后缀替换。新增helper使候选306 pins；生产信任根仍空。
- 回归仍为 `scripts/full-gate-closure.node-test.mjs`，新增tiny repo正例、ignored文件/dangling/server symlink、恢复相同快照、repin父文件后的missing/unpinned/approved/tampered ts/tsx与纯js、歧义及nonregular候选。首轮组合382通过/1失败是fixture的server/ ignore pattern不匹配server symlink，先在status断言失败；仅改fixture为server pattern，保留失败回执，第二轮冻结验证。未改CLI owner的runner/platform/verdict等模块；静态闭包、真实平台/安装资格、最终串行整合与独立复审仍分别验收。

## 创建 toolScope：先核对实际请求和嵌套契约

- November 9 `probe-scope.mjs` 留存最终文件的两个创建调用均未传 toolScope，然后 PATCH deny；不能把它当成 POST 失败证据。当前创建契约是 `settings.toolScope` / `settings.computer`，PATCH 才是顶层 toolScope；owner 创建路径忽略顶层这两个字段，不能把不受支持字段的 ignored 行为称为权限修复或 bypass。客户端 create-configured-bot 已使用嵌套 scope，保持 legacy alias、defaults、useDefaults 和 null 语义，不自动扩字段或拒绝未知顶层 key。
- 隔离 HTTP 首轮健康库存、未 PATCH deny 首发和 owner 顶层对照已通过，随后测试误期望 client-only 顶层请求 201，实际通用鉴权正确返回 403；只改夹具预期，保留失败、零 bots.json 变更及独立重跑。检查同 fixture 真实模型请求的工具名、GET/raw bots.json、同 dataDir 重启后未发送 bot 的首发和健康控制；不能用工具挂载失败造成的空库存证明策略有效。
- 回归入口 `server/bot-create-tool-scope.e2e.test.ts`、`server/new-bot-defaults.test.ts` 与既有 OpenAI tools suite 的 restrictive allow/deny forged invocation；实际 dispatcher 必须拒绝并零 fixture write。验证范围、已有资源显式路径、关闭回执及历史证据限制见[创建 scope 验证](../verification/bot-create-tool-scope.md)。只交付 tests/docs；真实模型、浏览器导航、真实 companion transport、用户数据及安装发布未验，最终树仍需独立审查。

## Memory journal undo：必须核对记录的 after 状态与存在性

- R1 独立复审 `ses_e3a1e53a5ffeKGCfC8hqUgieNL` 对75fcbfaf2退回：持久NDJSON的TS类型不能替代runtime校验。旧206通过未覆盖unknown kind、缺失/null/wrong-type before、created矛盾before和beforeHash缺失/坏格式/不匹配；matching afterHash仍可授权清空/删除/错误恢复。修复前实际reader/revert与HTTP红例保留28失败/5通过/35过滤：direct21次成功并变更、3次TypeError、3项原已409仅安全文案不同，另HTTP200清空。原d76红例与206证据不追认、不覆盖。
- R1在canRevert=false原400拒绝之后、document读取/修改之前验证kind与before/beforeHash/afterHash关系；created须null/null，edited/deleted须STRING before与matching合法hash，deleted afterHash须null，其余合法hash。移除restore空串fallback，保留empty STRING控制及store实际mutation gate，坏row可读但undo固定409、不静默丢row变404、不修journal。负例核对exact bytes/rows、turn-boundary baseline、cache/vector，正例保留empty前态、create/edit/delete/core与undo-of-revert；import edited/redacted/overcap仍400。最终仍须相同17文件含guards、strict server/app/lint冻结验收与whole-tree对d76新独立复审；同步单进程限制不扩大为CAS/ABA/原生重入/物理擦除保证。

- 整文件 undo 只拿 before 写回会覆盖后来无关事实；created 分支无条件删除/清空、deleted 分支无条件恢复也一样。合成 journal 写入＋flush＋实际 revert 的修正基线为21失败/2通过，真实隔离 HTTP 旧项 undo 返回200而应409。hash(empty) 无法区分文件缺失与存在但为空；不能从当前状态反推缺失/坏 afterHash。
- journal 先核对 existence＋记录 afterHash，再把相同期望传到 store 实际同步 write/delete 边界；checked write 不调用会补种 MEMORY.md 的 ensureWorkspace，避免拒绝前写入缺失 core。保留旧调用者 expectedHash/无条件写兼容；冲突固定安全提示，无全文/路径，无 phantom revert row，缓存/向量保持。仅单进程同步边界，无跨进程原子CAS、ABA或最终read后原生重入保证。
- 原 core creation test 只 record(after=hello)＋ensureWorkspace，实际是seed；保留原失败证据，补写实际after字节后保留原全部断言。普通save会先seed core，真实created core测试须用journalTurnWrite包实际文件写，不能误把edited当created。首轮HTTP夹具假设新bot已有core导致ENOENT，已改由topic覆盖HTTP负例，core用实际journal wrapper；不放松产品检查。
- 回归：`server/memory-revert-conflict.test.ts`、`server/memory-routes.test.ts`、`src/components/bot-settings/MemorySection.revert.test.ts`，连同既有journal/store/route/layer回归；边界注入在自有fs mock，不加产品测试hook。维护/安全范围与最终独立验收要求见[验证记录](../verification/memory-journal-revert-conflict.md)。这是undo准确性，不是通用遗忘或物理擦除。

## Browser stop consumer R2：入口检查不能代替实际派发屏障

- whole-tree reviewer 对387返回NEEDS-CHANGES：stream enable的launch failure装入reset后，catch仍fallback status/open；另一个viewer进入launchReady后，同session新reset false也挡不住它之后的execute。上一轮477及两项真实browser关闭证明未覆盖这两个交错，不撤销已关闭的target/errorText/lateACK/close合同，也不追认whole-tree通过。
- 在修改产品前，实际导入committed387的BrowserLive，通过public entry+受控execute/close复现2失败/135过滤；源码/blob/hash与红源均保留。R2在唯一direct execute前、accepted command返回后检查pending和unconfirmed状态；enable catch用typed reset error结束当前attempt，不能凭安全message文本分类，也不能因快速true而恢复旧fallback。普通非reset enable失败保留原fallback。已接受command不可撤回，拒绝迟到结果不等于零副作用。
- 第二个consumer-root修复只写browser-live.ts及既有tests/docs，保留显式reconnect一次owned close、true后才继续的策略和失败屏障寿命。完整live156通过，包括新21项public-entry时序控制；首个冻结组合498通过/3平台skip留档。提交前自审补全同一派发边界的reject分支：accepted command在新barrier后timeout/launch error/普通reject也必须先查barrier，不能进入旧错误分类再发owned close。再加3项有界callback控制，明确不标settled=true；前135项及manual/input/takeover断言不删。source1000行，预算不变，不压空白/拆碎/改close产品。完成后重新冻结文档并按原13文件+完整rawprobe/真实stopped/4=4/exit0/childclose/fixtureclear和strict guards/types/lint验收；新unknown立即阻断，无第三轮shutdown修复。最终whole tree仍须新独立复审。

## Browser stop consumer R1：失败状态不能随 Promise finally 消失

- 主控仅扩权 browser-live.ts 及既有 tests/docs 后，在原 reset manager 中增加按 session 保留的 unconfirmed barrier；pending false 拒绝该 reconnect 的 probe/enable/open，下一次显式 reconnect 只重试一次 owned close，true 后才继续，false/throw/reject 仍保留。已有 finally 可移除 pending Promise，但不能把未知状态当作新浏览器启动授权。confirmed manual/input restart 才清状态；其他 session 不受影响，不新增 timeout/自动循环/close 产品改动。
- 原 public-entry 红例在第一轮修复转绿；完整 live suite135通过，包括14项新增 pending/settled/repeated false、eventual true、throw/reject、安全固定文案、其他session、关闭/owner abort/identity replacement 后迟到false/true、初始stale及manual确认恢复。旧 pending-false test 的拒绝/两次close断言保留，第二次close改由新显式reconnect触发，并加零probe断言。原红源/日志及脏基线保留，不复写追认。
- 等待 shared reset 与 idle settle 后、准备浏览器前复核 viewer currentness；旧 viewer 关闭或身份替换不能让迟到 true 自动发 open。局部135与types通过不是最终组合验收；需冻结docs，重跑原13文件含真实direct/redirect完整rawprobe和实际stopped/registered=confirmed/exit0/childclose/fixtureclear，以及既有size/docs/types/lint。获批close三份产品字节和原cancel产品字节保持；完整最终树仍待独立复审。

## Browser stop controlled composition：standalone close approval 不代替调用者合同

- 新 checkout 以获独立 APPROVE 的 `fe486a958` 为起点，冻结输入前后 hash，原取消 source/tests 精确复制、README/lessons 保留双方条目；三份 close 产品源码和其他非共享获批路径保持原字节。原完整 direct/redirect pair 在组合树通过，包含 raw target lifecycle、同 profile control、真实 next-turn /ok 与 await teardown；历史 unknown fixture 不删除、不追认为已通过。
- 所需 recovery consumer 核对发现额外阻断：BrowserLive 的 reset Promise 返回 false 后 connect 只 await、不检查 false；独立 execute 路径在 disconnected status 下发送 open，不受 browser-engine 的 pending command fence 自动保护。真实导入 public-entry 合成红例实际记录 stream/stream/open，原120项过滤不能算通过。产品修复须触及本轮范围外 browser-live.ts；本轮仅保留现有 test 文件中的失败合同，不改获批 close，不扩权限、不提交最终候选。agent/human restart 的 false/error 处理不能外推为 reconnect 分支已受保护；新组合完整树仍需独立复审。

## Browser stop：目标身份与迟到 CDP 回执

- URL 唯一性不是页签身份：A 从 U 跳到 V、B 成为唯一 U 时，旧 helper 会附着 B。取消必须从可信 legacy engine/session 边界取得稳定 targetId，并确认该边界不在目标消失后静默收养另一页。0.37.0 本地资源与隔离协议探针支持 `tab list --pin-tab`；不得把 native TabRegistry 的能力直接假定为 legacy 能力，也不另建 manager。
- `Page.navigate` Promise resolved 仍可能含 `errorText`。停止 ACK 后也须重新检查操作 fence、原 RPC settlement、takeover、budget 与关闭状态；不能让迟到 ACK 无条件触发 about:blank。失败/断线/timeout 保留 unknown 与原 lane/recovery 语义，不能杀浏览器或关闭其他页凑可用性。回归：`server/browser-navigation-cancel.test.ts`、`server/browser-runtime.test.ts`；真实同 profile 双页及 fake provider 调度的后续动作见 `server/browser-navigation-stop.e2e.test.ts` 和 [验证边界](../verification/browser-stop-owned-target.md)。本候选仍待独立复审，不追认旧 pair 已接受。
- 真实 target-gone 探针在关闭 engine pinned active page 后，组合门曾出现 shutdown deadline exceeded/resource unknown；保留失败 fixture，不把辅助页 target-gone 通过当作集成 active-target-loss 关闭恢复已验。最终改为独立自有 background 页并确认 Target.getTargets 中已消失后，两个 e2e 的全部行为断言通过，但 teardown 仍 unknown：final-behavior-r2 为184通过/2失败/1 Linux-only skip，达到本原因两轮修复上限，阻断交回、不作最终提交。关闭路径/回执边界根因 unknown，未扩写 browser-engine 或验证生命周期，不抬 timeout、删目录或杀无关页凑绿。
- 测试负例也要查夹具：Vitest `it.each` 的数组行会按列展开，`ids.map` 抛错被 helper 的保守 catch 吞掉可让负例假绿。改为 `{ ids }` 行并通过 strict types 与行为门。fake provider 不能对整个增强后的 user message 做 includes 匹配：合成历史召回中的 SEED 曾让 follow-up 返回 56 却没有浏览器动作；实际 `/ok` 请求断言抓到了此缺口。两次既有 list-during-human-hold 失败也必须保留，dispatch guard 仅作用 tools/call；见本轮失败回执，不降低既有断言或预算。

## 重启提示：先区分错误行与真实恢复活动

- 当前 `fe504fb03` 基线的普通 direct root 已在实际恢复派发时写入 `resumingAfterRestart`；旧发现的 `oldThreadHasError=false` 不能证明旧线程没有恢复提示。真实 SIGKILL/SIGTERM、同 data/旧线程、持久 running root 和受控恢复 gate 验证应先于产品修改。排队恢复尚未派发时不要求活动行；needs_input 继续等待用户，不能伪装执行中。保留原 T5 的 C-RERUN、twice-cut 和 outward-action 合同，不引入新持久终态或改变恢复策略。
- 新控制夹具首轮误把普通 provider failure 当作无后续动作：现有 Chief incident 自动 retry/report 产生额外 root，按数组位置检查因此失败。只给该组合控制使用合成 Chief 身份避免无关上报，不修改产品策略；原失败保留。严格类型探针另发现 server e2e 引入 renderer TSX/alias 和未标类型的 HTTP JSON；把 React 投影留在既有组件 suite，服务测试使用 server records 与 typed API，不放宽 strict/JSX 配置。回归入口 `server/restart-notice.e2e.test.ts`、原样 `server/runtime-roots.e2e.test.ts` 和 `src/components/ToolActivity.notice.test.ts`；详见[验证说明](../verification/restart-notices.md)。此次未复现缺提示，建议只交付回归/文档，独立审查后再集成。

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

## Legacy browser close 调用者总预算

- 排队后才建立截止、native close 用完全部预算后再给 fallback 独立 grace，会让局部超时失去调用者意义。基线 `98b25c17` 的合成回归为 2 红/1 绿；enqueue 起固定截止传入 list/discovery/native/disappearance/fallback，owned tree 保留 fallback 时间，closeAll 首次 list 也扣时。到期、进程表失败和未确认 command close 均保守 false；旧命令 close 未确认时保留 session fence，不留独立五秒 KILL timer。不得用根 PID gone 或计数代替 tree/stdio 确认。
- 首轮产品检查 114 通过/3 失败/2 平台跳过：半预算产生小数 `execFile.timeout`，Node 同步拒绝，先创建的 timer 又访问未初始化 child。整数截断并处理同步拒绝；新增近截止和悬挂 ps 回归。第二轮 136 通过/1 失败/2 跳过剩新 fake-clock fixture 只推进 0ms，后续零延时枚举尚未执行；修正夹具推进 1ms，不改产品、既有断言或预算。类型检查另发现 mock 把可选 deadline 误写必需，修正测试类型；20 秒工具超时的首次 types 无 post receipt，保留 incomplete。
- 回归入口 `server/browser-close-budget.test.ts`、`server/browser-process-budget.test.ts` 与既有 engine/process/lifecycle suites；真实 owned Node 子进程覆盖非零/timeout/exit 先于 stdio close。一次既有 packaged 0.37 独立 close 边界捕获 5 成员/2 组，224.3ms 返回 true，随后 tree absent 与空 inventory 才删本次目录。未含冻结 cancellation candidate；direct/redirect＋完整 shared raw probe 必须在获审组合上另验，原 native false 原因/inner fallback wait 仍 unknown。无真实模型、用户 Chrome、Keychain、依赖或安装动作。检查与维护/安全审查限制见 [验证说明](../verification/browser-close-budget.md)，集成前仍须独立产品安全复审；阻塞 I/O、墙钟调整、Windows/Linux 平台不在本次保证内。

## Legacy close R1：阶段预算与真实 pid 删除的订阅契约

- 独立复审 `ses_e3b4091e6ffe63cAf8qw69FW0L` 对 `3190a92ec` 退回两项：循环入口检查 nativeDeadline 不代表内部 process query 受同阶段约束；把 total deadline 传下去会吃掉 fallback reserve。另一个旧并发测试没实际删 pid 文件，漏掉 prior true 后订阅者得到 false。基线实际函数回归 `r1-red` 为17通过/3失败，明确重现 query 收到160ms总预算而非80ms阶段预算，以及删文件后的 `[true,false]`；旧255通过和fast native probe不能替代这些失败合同。
- R1 把消失查询限制在 native phase，阶段到期直接转 fallback，保留原总截止。排队记录同时携带原身份和结果；只有同捕获身份的 prior confirmed success、重新受截止约束的空 inventory 与最终仍无 pid 文件才允许继承成功，false/unknown、身份变化、重新列出与订阅者到期均拒绝。回归保留160ms的 confirmed/unknown两种fallback结果、实际unlink、初始无pid时prior false、确认前/中/结果后替换和挂起inventory；不增加服务器预算、不从absence单独推成功。完整证据入口仍为 `server/browser-close-budget.test.ts` 和 [验证说明](../verification/browser-close-budget.md) 的R1节。
- 本轮仅修这两个已授权合同，旧轮次失败和probe留档，不重跑packaged Chrome凑绿；源码/文档冻结后执行原8文件、size/docs/types/lint。无新的供给链、凭证或授权变更；进程表失败拒绝signal、command close fence、start-time/group guards保持。最终树仍须针对工程98基线独立产品/安全复审，原取消组合对与内核I/O/墙钟/跨平台限制继续开放。

## Pipe Chrome：合成 HOME 不能被账户数据库默认值覆盖

- 触发：supervisor/测试 setup 已设置合成 HOME，但 `chromeLaunchEnv` 默认读取 `userInfo().homedir`，把 Chrome 子进程改回真实账户目录。旧测试还把该行为当正确合同。新合同在产品修改前为7失败/3通过；实际 owned Chrome 的 exec 环境记录也确认 HOME 与 synthetic 不同，profile 在 tmpdir，原 mock-keychain 和 deny-all gate 均保留。不把独立 profile 或纯函数绿例当作 HOME 隔离，更不声称审计过真实 Keychain 访问。
- 修复仅让 pipe helper 默认读取传入 env.HOME（win32 为 USERPROFILE），不再回退账户 home；保留显式第三参数、flags/profile/gate。回归 `server/testing/chrome-pipe.test.ts` 覆盖默认参数、两种变量、缺失/空值、显式 known-home override。实际 smoke 记录 exec HOME/argv/PID、Chrome/CDP 与关闭后 profile/process 状态。初始两次 probe 因 ps 不提供预期 HOME 而失败，保留日志，证据改用 exec 边界原样继承环境；只完成两轮 probe 修正，不改产品凑绿。
- 修复身份以本条所属提交为准；[验证说明](../verification/chrome-pipe-home-isolation.md) 列全调用者与未修改的 flags/accountHome、ChromeLauncher、opt-in Muse live helper。生产默认值与显式隔离 fixture 需分别审查，不扩改生产 home 政策。Windows/Linux 仅函数合同验证，真实平台 smoke 仅 Darwin；仍须独立审查和主控最终集成回归，F2 producer/trust-map/完整回归未完成。

## Fixture server：必须覆盖 launcher 与 backend 的显式 HOME

- Pipe helper 修复不能外推到服务器的全局 ChromeLauncher。full Chrome 的 fixture-server 启动会进入实际校准、生成 wrapper 和 `--version` 检查；无显式 home 时 Darwin account-home 默认覆盖 synthetic HOME。新服务子进程 recorder 红例实际记录这两个阶段 HOME 为账户目录，argv 仍有 mock-keychain；这不是原生 Keychain 访问证据。生产默认及既有 flags/launcher 的 deliberate stand-in policy tests 不改。
- 修复由 `verificationServerEnvironment` 生成 owned `OMB_TEST_BROWSER_HOME`，全局 launcher 和 host ChromeEngine 通过已有 home 参数接收，后者继续传给 LocalBackend。新增 `scripts/testing/fixture-server-browser-home.test.ts` 运行真实 server、失败校准 stand-in 与缓存身份后的实际 wrapper 子进程，验证 HOME/USERPROFILE/parent PID/credential flags 和 restart；`server/host/browser-fixture-home.test.ts` 覆盖有/无 override 的 launcher/backend 构造。原 `browser-fixture-home.test.ts` 保持完整，不能用新增同名文件覆盖旧覆盖。
- 批准的本地打包资源只有 headless-shell，该路径在 resolver 直接 legacy，不能将 browser-evidence/navigation-stop 通过宣称 full-Chrome 校准已跑。新增 full-Chrome recorder case 需显式 `OMB_FIXTURE_HOME_CHROME`，本轮未执行，不拿系统 Chrome 替代自有资产。详见 [验证说明](../verification/chrome-pipe-home-isolation.md)；完整回归/producer/trust map/签名、原生 Keychain、Windows/Linux 和 native backend 实际子进程仍各需相应证据。修复身份以本条所属提交为准。
- 首轮冻结门槛只有 docs citation 失败：说明中的裸测试文件名也会被 guard 当仓库根路径，补齐实际 `scripts/testing/` 前缀后重新冻结；不改 guard。外部 scoped types 配置首次因相对解析找不到 Node type library，在配置中明确已有依赖的 typeRoots 后重跑，保持 strict。随后类型检查指出新增 host fixture 的 store mock 应返回 null 而非 undefined，按真实 Store 契约修正后重跑；不以强制 unknown cast 绕过。不把这些 harness/docs/test 失败算产品根因或抹去原回执。

## Chrome 子进程关闭边界

- Node 24 的额外 stdio pipe 是 Duplex；`exit` 只证明根进程已退出，`end()` 只结束写半边，均不等于 `ChildProcess.close`。CDP launch 的 close/kill 和握手失败收尾必须回收本端 fd3/4 并有界等待实际 close，registry 在 close 后才移除；超时抛错、保留 profile/registry 证据。回归 `server/browser/chrome/launch.test.ts` 使用真实 Node 假 Chrome 和短暂继承 fd3/4 的辅助进程制造 exit 先于 close，另用 mock 验证 close 永不到及握手失败清理未知；`server/browser/cdp/connection.test.ts` 验证两端完整销毁。根进程 close 不证明所有 Chrome helper 或外部资源已消失，需单独进程审计。原 S4-actions 功能 32 pass 但缺 close 的 `ok:false` 记录不得被补验覆盖。

- Chrome-close 复审 C1–C3：launch 局部等待 close 不足以保证 profile 保留。`ChromeCleanupError.cleanup` 明确区分 closed/unknown/cleanup-failed；service、校准和手动 CLI 的实际目录 owner 都必须传播该状态，unknown 不擦除、不释放控制句柄，独立 loopback 仍关闭。sweep 对活 owner 的记录不能按 root PID gone 回收；dead-owner 也须确认根进程已消失才恢复。实际 close 的事件 Promise 不执行 registry I/O，I/O 失败经调用方报告为 cleanup-failed 并可安全重试，不能从事件抛出或误报没有 close。回归 `close-retention.test.ts`、`calibrate-cleanup.test.ts`、`omb-browser-cleanup.test.ts` 及 launch/processes 测试；不以先前真实 happy-path 替代这些失败路径。

- Chrome 启动阶段必须在真正调用 launch 的位置记录：binary/profile/downgrade/egress/screen 及参数构造阶段失败未取得 Chrome，可结构化报告 closed 并释放本次 reservation；调用 launch 后的普通 Error 仍是 unknown，只有显式 closed 或 cleanup retry 确认后才释放。成功释放 reservation 后，实际 registry ownership 继续保护 profile。回归 `backends.test.ts` 与 `close-retention.test.ts`。
- Registry 非 ENOENT 读取失败、损坏 JSON/记录不能退回空表。ChromeEngine 的实际 timer、sweep、erase 要受控报告并保守保留目录；按故障周期去重诊断，恢复后继续维护，即使修复后的 registry 为空。回归 `engines-maintenance.test.ts` 使用实际定时入口、真实本地文件和原 sweep 算法，仅替换 OS 进程枚举/终止边界；不以旧真实 Chrome happy-path 证明本轮失败恢复。

- 维护防重入改动需同时运行既有 `engines.test.ts` minute 调用方与新增维护测试；只跑新增 108 项遗漏了该文件。fake time 推进两分钟不代表真实 OS sweep 已完成，分钟夹具应执行原 sweep 算法并注入受控 list/alive/kill，明确等待本轮完成。受控 pending promise 又证明整批共享 fence 会让 idle close 与 OS sweep 互相阻塞：按任务保留防重入，未完成的同类任务仍只有一个，独立任务继续每分钟执行，close 等待全部在途任务。回归 `engines.test.ts` 的两个原 expected3/inactive 断言及双向 pending 用例，不靠降次数或把 sweep 改 noop 过关。

## 活跃 CI 契约与有效配置

- 归档上游 workflow 的契约通过，不能证明实际启用的 Entropybot CI 有 lint 或离线行为门。新增回归 `scripts/entropybot-ci-workflow.test.ts` 读取 active workflow；先保留原CI的失败记录，再接线，删除必需step的变异必须失败。
- 只比较 `run` 字符串会漏掉 `shell: true {0}`、继承 defaults 或工作目录导致的空执行；只看顶层permissions会漏job覆盖；秘密引用还可能在env/action输入、括号访问或函数包装里。复审两轮补齐同一验证器的负例，禁止通过忽略失败/改基线凑绿。本回归用于约束已知配置退化，不是任意恶意workflow的形式证明。
- `OMB_EVAL_LIVE=0` 与假引擎表示不主动调用真实模型，不等于OS网络沙箱。现有eval runner会吞close异常；评估通过不能单独证明子进程、后代与临时目录均已回收。保留这一限制，不拿CI job截止代替资源回执。

## V1：本地验证回执

- B1旧manifest记录前后hash但不自动拒绝，且缺untracked内容、执行位、symlink和artifact绑定；不是自动质量门。`scripts/verification-receipt/cli.py run/verify` 将命令执行与回执接受分开：source/定义/日志/报告失配均拒绝，只有HEAD变化且内容不变允许匹配。回归入口 `scripts/verification-receipt/test_receipts.py`；15类合成负例覆盖源码变更、旧/坏报告、超时/取消、篡改、skip/todo和未知定义。复用GateCommandRunner，不能将POSIX自有组退出等同全部内部资源回收；快照看不到修改后恢复，本地hash不替代F2权威producer，旧执行不得事后补hash追认。
- 独立审查实际发现：只数JUnit testcase会忽略套件声明的缺项/skip；只从skipped文字猜TODO会漏Node原生 `type="todo"`。两个反例在原候选确实错误接受，新增公共CLI回归先红后绿；现在核对套件/root和Node summary计数，按结构化type分别执行skip/todo策略。不能只因原15类通过就省略真实报告格式的独立审查。
- JSON路径先stat(size)再read_text仍会在无writer FIFO阻塞，命令runner截止覆盖不到加载阶段。V1-R2通过真实CLI分别复现receipt/registry阻塞，探针有界终止并reap根进程后清理。共享loader改为O_NONBLOCK|O_NOFOLLOW打开、对fd fstat确认regular，并只读上限+1字节，实际长度超限拒绝；不靠文件打开前size保证读取有界。公共回归还覆盖symlink/目录/坏/超限输入和元数据低报时实际字节超限。POSIX能力缺失拒绝，不宣称对远程/故障文件系统的内核I/O提供墙钟硬截止。

## D2：关键工具类型门

- 应用/服务typecheck不能证明所有scripts工具均已编译。tsconfig.tools.json显式覆盖进程门、回执bridge、验证生命周期/外部停止/preload，继承strict/noEmit/原生TS约束；实际tsc在隔离源副本正常通过，注入两个独立TS2322错误必须拒绝。Node回归还保护入口覆盖与strict选项，active CI契约保护普通typecheck接线及类型门在patches之前。仅覆盖这些工具及传递依赖，不冒充全scripts类型覆盖或远端Actions通过；失败路径更早拒绝不等于绿色流水线提速。回归：scripts/testing/tooling-types.node-test.mjs、scripts/entropybot-ci-workflow.test.ts。

## CI 根退出后的有界清理

- Ubuntu CI run `42506798776` 在 Vitest 51 文件/1055 项通过并写报告后，因根退出 250ms 后后代/输出流仍活动而失败；固定窗口应触发自有 detached 组 TERM→既有 grace→KILL 清理，不能直接把可确认回收的 code 0 命令标为失败。成功仍须组消失且实际 child close；非零退出、取消、超时保留原失败，预算内未确认则 cleanup 失败并保留证据，不代表内部独立组全部回收。回归 `scripts/testing/patch-gate-process.test.ts`：真实持管道后代分别 TERM/KILL 回收、非零根退出、EPERM 未确认及无关 control；原代码 3 红/16 绿，修复后 process/CLI/size 共 41 项通过，工具类型与相关 lint 通过（macOS Node 24.22.2）。回执与后续 `check-patches --verify` 记录在外层 `private/engineering-foundation-evidence/ci-gate-cleanup/`；Ubuntu 修复后实跑待主控推送复核。修复身份以本条所属提交为准。

## 小范围行为回归补充

- 地址栏检测外层协议时，不能把路径、查询或 fragment 中的 `://` 当作外层协议。回归入口为 `src/lib/browser-address.test.ts`。修复必须同时保留非 Web 协议拒绝行为；本次第一版只匹配 HTTP(S) 曾让 FTP 被补成 HTTPS，既有负例立即捕获，最终改为匹配开头的完整协议结构。该证据覆盖公开解析函数及调用者静态接线，未覆盖真实浏览器导航。

## D3：CI重试观测

- 旧retry-summary对空/坏/缺日志都输出空摘要，缺环境和outcome时仍能输出“0重试”，且坏JSON行被静默丢弃。现在只读producer开始/结束标记、run/batch身份和结构化retry记录，缺任一必要证据即incomplete，不把无日志当零重试。回归入口 `scripts/testing/ci-retry-observation.node-test.mjs` 与 `scripts/testing/ci-retry-list.test.ts`；runner新增start/finish/counts，retry行带runId/batchId，CI契约保护`--init`、per-step日志和`if: always()`汇总。
- 测试失败或取消不能因汇总成功被冲淡；原退出码由检查步骤决定，汇总只报告。补丁门环境白名单需显式透传重试日志/run/batch，否则内部Vitest拿不到，记录不完整。retrySummary不再宣称零重试；旧“legacy行”可见但不构成完整观测。缺少命令outcome、manifest或某个step日志均为unknown。
- CI契约测试不能断言 GitHub 不支持的 context：job级`env:`里 `${{ runner.temp }}` 被 GitHub 判为 “Unrecognized named-value: 'runner'”，整条 workflow 解析失败、0 个 job、0 个 check-run，而契约测试却因断言了同一错误值而“通过”。远端 run 42549674304 因此 failure。修复：目录改用 github 上下文 `/tmp/entropybot-retry-${{ github.run_id }}-${{ github.run_attempt }}`；契约测试补“所有 env 值里的 `${{ }}` 表达式不得含 `runner.` 前缀”的负例（runner 上下文在 env 位置不可用），防止再次盲区。回归 `scripts/entropybot-ci-workflow.test.ts`。

## 可选 Connected Apps 故障隔离

- 触发：Composio bridge 的 initialize 或 tools/list 返回 RPC error。实际根因是 `mountChatTools` 按 built-in/custom 分组，把可选 `composio`/`own_apps` 与必需 agents 一起直接抛错；准备成功不代表挂载成功，聊天因此在模型请求前失败。修复只让这两个可选 bridge 的挂载拒绝走现有 skipped notice，关闭失败 client、整组省略其工具，通知使用固定文本，不带上游错误、URL 或凭证；取消、必需服务失败、schema 校验与 toolScope 错误继续拒绝。修复身份以本条所属提交为准。
- 准备路径已核实：`appsIntegrations` → `mcpIntegration` 的 connectorTools 清单读取经过 `connectedServiceSlugs`，库存网络失败已有降级，原 allowlist 保留；不应为猜测的准备失败新增宽泛 catch，策略/序列化等异常仍上抛。回归入口：`server/drivers/openai-chat-tools.test.ts` 的 optional connected-app outages（真实 stdio MCP + loopback 假 Chat Completions，四个失败阶段先红后绿、健康工具实际执行、通知脱敏、取消与必需 agents/policy 拒绝）；`chat-mcp-tools.test.ts` 检查失败进程关闭、健康内置工具与选择/审批边界；`composio.test.ts`、`host/team-connections-host.test.ts` 检查准备流程。测试首轮因合成 broker token 不符合既有 64 位 hex 契约失败，修正 fixture 后重跑，不修改产品校验。
- 边界：只覆盖已有 Chat Completions runtime；没有调用真实 Magpie、Composio 或用户数据，不能宣称云端服务恢复、安装包或 UI 实测通过。已有启动等待预算保持原样；执行中失败仍走原不确定结果/关闭语义，不自动重试外部动作。
- 文档漏检：`398e32e2d` 新增验证文档但未接入 README，原 359 项行为/体积回归未包含文档守卫。主控 04:27 运行 `scripts/testing/verification-docs.test.ts` 时 6 通过/1 失败，`are all reachable from README.md` 在第 102 行实际得到 `["optional-connectors-isolation.md"]`，期望 `[]`；本 worktree 原提交重现同一失败，证据 `optional-connectors-evidence/docs-index-red.{json,log}`。根因是新增文档时未把索引与文档守卫纳入变更范围检查。修复补 README 链接；以后新增/移动验证文档均运行该守卫，行为/类型检查不能替代文档可达性验证。此次文档修复不改生产代码，不重跑未变的 359 项；修复身份及文档守卫绿例见后续单独提交与交接。

## F2 前置回归：浏览器 UUID、原生文案与 locale 范围

- renderer 的手动运行身份必须复用 `src/lib/random-uuid.ts`，不能直接调用可能缺失的 `crypto.randomUUID`。`src/state/routine-run-intent.test.ts` 新增缺失该 API 时实际保存 v4 key、发送请求和新 owner Retry 复用原 key 的回归；native Web Locks 的拒绝策略不变，fallback 不代表普通 HTTP 已支持锁。
- 产品文案提交修改共享 `place.local` / `rail.thisComputer` 后，原生菜单与切换器的旧英文、葡语测试 pin 也须核对；本次按既有目录采用 Your computer / Seu computador，保留角色、排序、无 Forget 和回调断言。入口为 `electron/menu.test.mjs`、`electron/environments.node-test.mjs`、`electron/native-text.node-test.mjs`。
- locale import-graph 守卫新增指出 `server/routine-manual-request.e2e.test.ts` 的传递目录依赖，以及 `scripts/entropybot-ci-workflow.test.ts` 中 workflow 命令的保守文本命中。两者加入 `scripts/ci-scope.mjs` 的 locale 子集；不增加豁免或放宽图守卫。后者自身不解析翻译，额外运行短契约测试以保留守卫的保守边界。第一轮图守卫转绿但精确子集清单断言未同步（343 通过/1 失败）；第二轮同步清单测试，不改原图断言。此修复仅为前置回归，不能据此声称完整 F2 回归或发布通过；集成前仍须独立审查。

## F2 Vitest CLI：配置字段不等于受支持的 CLI flag

- 实际 Vitest 4.1.11 在执行前拒绝 `--runner`；类型检查、argv 字符串测试和原本不带该 flag 的 guards 通过均不能证明 producer 命令可运行。通过固定 full-gate 配置适配器覆盖 `test.runner`，发现与执行共用配置，保留原项目 plugins/setup/include/exclude/sequence 和十个 main shard。`--execArgv=--import=…` 在实际 worker 中验证能力存在，不依赖 manager import 自动继承。
- 回归 `scripts/full-gate-cli.node-test.mjs` 将生产命令 builder、适配器与 strict runner 复制到自有合成项目，用已装 4.1.11 实跑 main/broker/control-plane/platform 形态。retry sentinel 在 strict runner 拒绝，在 default/CI retry runner 对照成功；另测 config retry、name filter 和 passWithNoTests 拒绝。夹具首轮误以为 mergeConfig 会替换 include 数组，第二次缺复制 CI runner 及依赖，均保留失败后修正夹具，不改发现政策。原 main/broker 实际发现集合分别 2442/4，适配器集合相同。
- 这只资格化所列 CLI 子集，控制面 Cloudflare plugin/实际 Linux/Windows/Actions、完整 producer、资产与全资源确认仍未资格化。命令收据仅增加三个固定配置路径白名单，原 entry/env/bootstrap 限制保持；既有允许的历史命令形式不追认为实际已执行。闭包/source 边界由独立 owner 修复，主控串行组合并重算 pins；详见[发布门限定验证](../verification/release-full-gate.md)。

- CLI 与 approved closure 组合时，合成 config 的 runner literal 也必须遵守相同源码边界。`b12cfeccf` 的组合门实际为398通过/1失败；新 checkout 原样重现 `unsafe config dependency: vite.config.ts`，发生在 hashes→producerClosure，尚未启动内层 Vitest。夹具把 runner 绝对值转换为相对各自项目 root/config 目录的本地 literal，保留 root/broker/control-plane 正确解析、完整闭包 hashes、17次真实CLI及原负例，不放松 localPath 或生产代码。每次 run 的原始 JSON report 在删除自有 fixture 前复制并记录 hash，默认/CI retry 对照和严格 sentinel 均保留。修复仅测试/文档，313个生产 pins 不变；最终组合与独立审查记录见[发布门说明](../verification/release-full-gate.md)。

## F2 POSIX 独立资源观察：明确确认域并保留总阻断

- `scripts/full-gate/resource-audit.mjs` 复用现有进程枚举、startTime 与 profile 参数识别及 ProcessRegistry 数据格式，实际 public producer 写 source/run/attempt/group 绑定 artifact；不另建生命周期 manager、不发 signal、不按进程表差集或 PID gone 宣称全清理。显式 registry 缺失/坏格式/身份 stale、未知或超时枚举、source drift 均 unknown；最终存活为 residual，局部清空最多 clear-observed-domain，completeCleanup 固定 false。
- 首次真实 Node fixture 发现 macOS `/var` 临时根与 canonical `/private/var` home 不同，导致 detached profile 漏检为 clear，并使 registry 路径拒绝。保留该轮 6 通过/5 失败及源码 hash；fixture 使用 realpath，入口拒绝 noncanonical home，回归仍覆盖 canonical 边界外 control。进程自身 argv 使用其他别名仍是明示盲区，不能扩大保证。原缺模块红源仅证明此前没有 public audit，实际 false-clear 证据来自随后真实 public producer 运行。
- 回归 `scripts/full-gate-resource-audit.node-test.mjs` 含实际 owned detached Node 活过根退出、对真实 live PID 的 stale startTime、正常退出与空保留 registry、无关 control、unknown/hang/source/binding/Windows；不强行制造系统 PID 复用。主 runner/platform 的 finally 保留 artifact，verdict 检查原始 hash/绑定；现有 fixture scope 没有 durable 内部 CLI start-identity 库存，生产默认空 declared registry，故完整资源阻断保持。详见[确认域与限制](../verification/release-full-gate.md)。bounded async deadline 不覆盖阻塞内核 I/O；MJS strict、跨平台、全仓/Actions、真实用户数据与 Keychain 未验。仅本范围维护/安全复核，无依赖/安装/权限/外发或未知进程清理变更；最终验证和主控独立审查不能被局部通过替代。

## F2 disposition 合同：skip 身份和执行证据不能互相代替

- `a08fc3727` 的新 consumer 合同要求 verdict 恰好五步，第二步为 `Strict totals: no failures or todos`。测试 skip 只有逐条 group/file/fullName 对账、唯一 class、具体原因、同源 target 证据及 controller 审阅后才可 accepted with dispositions；skip 不变为 pass。普通 pending、todo、重复/额外/缺失声明、错源/错run和未解决证据仍阻断。旧零 skip 保护是历史合同，不覆盖新决定。
- Node 24 实际 structured events 先发送没有 entryFile 的外层 file enqueue，再发送带 entryFile 的 worker enqueue；两者可共用 testId=1。嵌套全名解析须用 entryFile 命名空间，不能把外层 wrapper 当重复 assertion 或凭 TAP 汇总猜文件。首次 171 项中 1 项失败来自 macOS 临时根 `/var` 与实际 `/private/var` 别名；规范 fixture 根后第二次 176 项中 1 项指出 wrapper 身份重用。保留两轮失败和独立原始 event probe，不降低重复断言检查。回归入口 `scripts/full-gate-dispositions.node-test.mjs` 包含真实有界 Node 合成文件、signed/unsigned disposition 及 archive 负例。
- 资产存在、配置开关和历史分类均不是 target 执行证明。producer 保留 73 条 class-A 加 4 条 class-C 历史未解决声明，未配置 controller 公钥或资产 hashes；邮件夹具/CA、独立 detached 资源审计和 Windows containment 仍明确阻断，不因新 skip 合同自动关闭。验证边界与格式见 [发布门说明](../verification/release-full-gate.md)。

## F2 producer 候选：格式检查与阻断必须分别验收

- 新 producer 的首次合成检查 111 项中 9 失败：TAP exclusion 正则把 `# todo 0` 汇总误判为 TODO 指令；workflow 的 run scalar 含冒号却未使用 block，导致 YAML 无法解析并连带 8 个契约测试失败。修复分别限定 TAP directive 所在结果行、采用 YAML block scalar；原日志保留，不能把解析失败当作负例合同成功。
- 读取已装 Vitest 4.1 的实际格式确认 `list --filesOnly --json` 返回 `{file}` 对象、JSON reporter 不提供 `numRuntimeErrorTestSuites`；producer 不得拿自造字符串列表或不存在字段建立“实际格式已验”的结论。新增 argv 检查只检查选项，避免把合法 `ci-retry-*.node-test.mjs` 文件名当 retry flag。
- Vitest 4.1 的 runtime deprecation 提示不能替代实际类型出口核对：将 runner class 从 `vitest/runners` 改由 `vitest` 导入后，scoped tsc 实际报 TS2689 等 6 项错误（根出口是 interface）；恢复可编译的 runtime class 入口并保留类型失败回执，不以 skipLibCheck 或删除 override 绕过。
- 候选 producer 保留空 production trust map；平台、独立资源审计、邮件/资产预检未实现时明确拒绝。源码合同通过不等于完整 producer 可用；启用前仍须独立审查、补齐执行边界及最终 SHA 的真实 Actions attempt-1。回归入口 `scripts/full-gate.node-test.mjs`、`scripts/entropybot-release-gate.node-test.mjs`，边界见 [发布门说明](../verification/release-full-gate.md)。

## A1：手动运行在 reload 后恢复

- 触发：confirmed setItem 成功而紧随的 getItem 抛错。旧 provider 的 uncertain map 保留原 key，但 reload/更换 provider 丢失该 map；原有同 provider 重试通过并不能证明 reload 安全。基线 `a92388449` 的新增红例实际发出两个不同 key，真实 Chrome 夹具在故障、原服务器同 dataDir 重启及 Page.reload 后缺少 Retry。修复身份见本条所属提交：新 owner 对任何既有 marker 先以原 key/context 对账，confirmed phase 不单独授权旋转或驱逐；本 owner 的成功回执有界保存，显式 Retry 即使在同 provider 重开详情后也强制复用原操作，提前替换仍须原确认。回归入口 `src/state/routine-run-intent.test.ts`、`src/state/routine-run-intent.integration.test.ts`、`scripts/testing/routine-run-reload-ui.e2e.test.ts`；含实际 browser reload、同目录 server restart、真实合成认证 context 变更前置拒绝、unmount 后迟到响应和替换身份 fence、32 条容量保留/可确认驱逐。边界：reload 后即使先前成功也保守要求再对账；32 条未对账会阻止新 routine；无多 tab 仲裁、真实账号/模型/Keychain 或安装包验收。证据与测试入口见 [验证说明](../verification/routine-run-reload-recovery.md)。
- 本轮测试入口失败分别保留：默认 server setup 在 happy-dom 引入 node:sqlite、Vitest it.each 脱离 receiver、外部配置 .ts 被按 CJS 载入、EventDetails 实为 aside 而不是 dialog。另一个 browser 探针在 Page.reload 返回后读到旧文档控件；修正为先观察新文档标记消失与 readyState，再断言 Retry。fixture-only 类型配置首版还漏带既有 app/Vite 声明与 DOM.AsyncIterable，补齐外部检查配置后通过，没有改产品类型或 strict。只有修正后的真实断言红例才算产品复现，setup 失败、provider remount 与旧文档 DOM 都不能替代 browser reload 证据。

## A1：多标签页手动运行协调

- 触发：真实同源双页同时 Run now，单 provider maps 和 await 后重读不能提供跨进程原子性。修复前真实回归分别得到同 routine 两个 key/两个服务端 run、不同 routine 丢一个 marker、31 条 pending 加两个新任务实际派发两次但仅留一个新 marker；readback 相等也不是 localStorage CAS。修复以本条所属提交为准：一个 native Web Lock 保护全 ledger 的同步选身份/容量/保存/读回/map 更新，响应身份核对与 confirmed 保存也在同一短事务；settings/metadata/HTTP 不持锁，重叠同 key 请求由原服务回执归并。
- 显式 Retry 要在动作开始捕获原 key/context，等待期间缺失或替换就拒绝，不因驱逐或另一页写入生成新 key。锁获取独立五秒截止、abort 与回调入口单调时间/已结束 fence；缺/null/抛错/拒绝的 native API 明确提示并零写入/零 POST，无锁降级。新错误 reason 不能沿用“非 blocked 就未知”的旧 UI 判断：首轮 browser 9 通过/1 失败实际看到无 marker 的锁超时显示 Retry；修复仅 unknown/changed 或真实存储 marker 进入恢复态。类型首轮仅测试 LockGrantedCallback 缺泛型参数，补 unknown，不放松 strict。
- 回归入口：`src/state/manual-run-coordination.test.ts`、两份 routine-run-intent unit/provider suite、`scripts/testing/routine-run-multitab-ui.e2e.test.ts`，并保留原三项真实 reload/server restart 兼容回归。happy-dom 的 locks 是 null，测试显式注入共享 fake，但不把 fake 当多进程证明；真实 Chrome 仍用原生锁、原组件/Store/settings/preflight 与隔离服务。证据、失败及限制见 [跨页验证](../verification/routine-run-multitab.md)。不同 origin/端口/别名/profile/旧客户端、真实安装主进程与公开 TLS 不在保证内；无 native Web Locks 的普通 HTTP 页面拒绝受保护运行，查看/编辑/取消继续可用。无依赖/server/schema/安装/发布变更；pt-BR 人审仍待完成。

## A1 多标签页 R1：合并订阅也必须核对恢复身份

- 独立复审 `1bf8913b6` 发现 pending 快捷分支只校验 scope 就返回在途 promise，绕过 execute 的显式 Retry 身份检查。实际红例：存 A、ack=true 替换阻塞在 settings、同 provider 的 ack=false Retry 捕获 A 后加入替换，最终错误收到 B 的 run/onStarted；只有一条获授权替换 POST，不是额外派发。另有 joined Retry 的 preflight 等待期间 A 消失或 key/context/environment 被改，旧快捷分支仍报告成功。前次 112/14/35 不能证明此交错安全。
- R1 修复以本条所属提交为准：私有在途结果携带真实保留的 marker 与 run，公共接口仍返回 RoutineRun；显式 joined Retry 在交付成功前同时匹配捕获 marker、实际 operation marker 和当前 ledger，缺失/变化只拒绝该订阅者，不覆写 ledger、不额外 POST。不能仅从当前 ledger 推断在途操作身份；额外控制在 B 完成后恢复 A，仍须拒绝把 B 认作 A。
- 回归入口仍为两份 `routine-run-intent` unit/provider suite：R1 修复前 6 个真实断言失败；新增 9 例覆盖替换/settings、joined preflight 迟到/缺失/三类身份替换、同身份正常合并和实际 Store 回调/UI 不确定态。并按修复提交重跑 14 项真实 browser 兼容及相关 size/docs/types/lint/locale；最终 SHA/命令/计数见私有 R1 交接。不改 schema/auth/cancel/native API/短锁事务或预算，真实安装/跨 origin/profile/pt-BR 人审边界保留。

## A1：生产采集派发与报告确认

- `report.state: pending` 只表示报告排队，不能让采集 host 的发布回调成功。生产接线必须保留每个 run 的版本化计划和原 HTTP request receipt；重启只恢复同一手动身份，未知读取 reservation 不重发，不能读取后来修改的 routine 计划。报告使用现有 Store/commands SQLite 的稳定消息命令，在目标聊天实际消息存在后才确认；繁忙时保持未确认，取消后不得靠后续 flush 发布旧摘要。
- 本轮新适配器的真实红例：目标报告已 append 落库，确认路径抛错，run 却变成 failed（`publication-red`：3 通过/1 失败）。根因是把回调异常直接等同未发布；修复先验证同一 run/目标/文本的持久消息，已提交即确认，不重发消息、不重读页面。回归 `server/routine-collection-publication.test.ts`；真实进程窗口由 `server/routine-collection-dispatch.e2e.test.ts` 在 append 返回后 SIGKILL，再核对重启后的原 message ID、单产物和读取次数。原通用 host 无本地幂等 reconciliation 的调用仍保持 unknown/no-resend，不能把此修复外推为外部服务 exactly-once。
- 新采集检查还曾额外调用一次 listRoutines，既有 context 回归实际得到 6 次而期望 3 次（`correction1-behavior`：370 通过/1 失败）。修复复用一次只读存在查询，保持原鉴权/context/mutation 顺序；`server/routine-manual-context.test.ts` 与原 manual HTTP e2e 共同回归。首轮另有测试查询消息使用错误路由的夹具失败，改用现有 threads/messages 路径；不将其称为产品红例。
- 本轮还出现文档验证竞态：组合套件运行期间写新验证文档及其 README 链接，文档测试先缓存了旧 README，最后实际报新文档不可达（`correction2-behavior`：378 通过/1 失败）。根因是只冻结 TypeScript、证据脚本未 hash Markdown；以后文档/索引先一次完成，再冻结运行文档门，回执同时纳入 Markdown。最终 runner 已补 Markdown、Node binary hash 和依赖根记录，旧回执保留且不追认文档冻结。
- 收尾取消边界补审：`removeForBot` 原本只打断模型回合，新增 collection 也必须中止自己的 AbortController；且 run 历史随 bot 删除后，报告队列不能把“找不到当前 run”当成可继续发布。新增回归在 removeForBot 后立即同步 flush，实际出现一条旧摘要（`followup-behavior`：9 通过/1 失败）。修复同时取消 collection，并拒绝缺失或 cancelled/failed 的当前 run；回归 `server/routine-collection-publication.test.ts`。该用例验证报告阶段的删除/取消边界，不冒充读取阶段的进程取消测试。
- P2 独立复审退回：append 已提交后抛错，`confirmed()` 只认消息存在便成功，`write()` 没执行 posted 保存，finally 又删了等待项，导致 run.report 永久 pending、缺 thread/message ID，只有重启才偶然修复。旧回归只数消息和检查重启，不断言发布成功当时的状态，380 通过未覆盖此缺口。R1 红例 `p2-r1-red` 在 append 和首次 posted 保存异常两种注入下均实际得到 pending（2 失败，另 4 项按名称过滤）。修复在确认消息/文本后检查取消与当前 run，再调用现有 noteReport 持久保存精确 posted/threadId/messageId，保存失败不确认 host publication；不重发消息或读取。回归在完成后立即检查内存和 routines.json，额外 flush 后仍检查同一身份，并覆盖持续保存失败不得产生 host completed receipt。保持取消、删除和 stale 防线。修复与精确最终证据见单独 P2 R1 交接提交，原提交证据不外推到修复后。
- 证据与精确命令见 `docs/verification/web-collection-production.md` 和本轮交接 SHA。仅有合成 DNS/loopback、进程重启与既有 SQLite 持久语义；真实站点/TLS、断电一致性、桌面 UI/安装未验证。报告等待每次派发独立限制为 60 秒，不能宣称无限繁忙恢复；持久采集读取预算和截止不因恢复清零。

## 组合验证的临时目录与显式浏览器开关

- 工程组合 `ddc1bcfe6` 首跑继承 macOS `TMPDIR=/var/folders/...` 别名，`collectWeb` 的 `realpath(outputRoot) === resolve(outputRoot)` 私有目录检查在读取前拒绝，出现45失败/337通过；同时漏传 `OMB_UI_E2E=1`，3个浏览器用例被跳过。修正调用环境为交付所用的合成HOME、规范化短路径 `/private/tmp` 和显式浏览器开关后，同一源码/同一13文件选择385项通过且无跳过；两次前后源码哈希一致。不能因测试目录别名放宽产品路径校验，也不能将 `it.runIf` 跳过记成浏览器验证。原失败与规范环境绿例保留在外层 `private/engineering-foundation-evidence/a1-combination-ddc1bcfe6/`；这是本地组合证据，不是V1/F2回执。

## A1：摘要显示与持久回执分离

- 真实采集 UI 已在详情隐藏路径，但原聊天与侧栏仍展示 durable summary 的 `Path:`；只验详情/报告不能证明公共显示面已覆盖。最小红例在真实 ChatView 挂载与 sidebar preview 各失败一项；同批原词汇门仍有两项失败，不能用新功能通过掩盖。修复以 manual automation 元数据及完整已知摘要结构、正整数计数和 hash 共同识别，只在前端显示固定标题与计数；原持久消息和 host 发布文本参与 exact-content reconciliation，禁止为脱敏改写 durable bytes。普通用户仿写与非法结构保持原样。
- 回归入口为 `collection-summary-display.test.ts`、`ChatView.automation.test.ts`、`sidebar-preview.test.ts` 和真实 `collection-ui.e2e.test.ts`；同时检查聊天正文、侧栏、回复引用及原消息/产物不变。ChatView 已有体积上限，应复用现有 `botLineText` 显示入口，不增加并行渲染职责或抬高预算。最终 SHA/精确计数见 [验证说明](../verification/web-collection-ui.md) 与 source-bound 回执。此投影不是授权或任意文本脱敏器；原导出/搜索/存储及独立报告读取器的大小边界不在本切片验收内。
- 文案变更后，reload 浏览器回归的旧英文整句断言仍停留在 account/workspace，首轮实际三项失败；更新为新产品整句后仍须保留所有原身份、Retry 和未额外发 POST 的断言。扩大语言检查还暴露未改动的 `i18n.test.ts` 两项 Node 24 默认 navigator `en-US` 与期望 `en` 的失败，精确基线模块探针同样 34 通过/2 失败；这是新增发现的范围外门槛限制，不能吞掉或修改词汇断言来称整体通过。
- 后续独立审查明确测试夹具契约：`intlLocale(system = navigator?.language)` 的显式 undefined 也触发默认参数，不能代表 navigator 缺席。受控 en-US 环境先复现 34 通过/2 失败，再仅在 intlLocale 测试组为缺席场景 stub navigator=undefined、每例结束恢复全局，并新增 en-US/en-GB 的无参/undefined 及 pt-BR app 控制，原 en 期望与非法 tag 检查不变；同受控环境修复后 38 通过。生产代码与 locale 行为未改，不全局禁用 navigator；最终与已批准 bounded-fetch 依赖组合重跑。pt-BR glossary 的模型检查不能替代合并前巴西葡语使用者的真人签署。

## Collection report access

- 新增 GET 路由经过已有鉴权，不代表 paired client 可达：CLIENT_ALLOW 默认 admin-only，实际 HTTP paired-client 负例发现报告 GET 漏加白名单。只添加精确 method/path，再验证隐藏 bot、错误 routine/run 与 thread audience；不能以 owner loopback 成功代替成员授权。报告必须通过原始手动 request receipt、run 快照、计划 binding 与完成 hash 验证，发布摘要 path/hash 和 pending/posted 均不授权。回归 `server/collection-report-access*.test.ts`，证据与边界见 `docs/verification/collection-report-access.md`。
- 既有 owner-loopback 鉴权会忽略非 session bearer；新增敏感读接口不能把 bot/internal/未知 token 静默回退成本机 owner。真实 HTTP bot-like bearer 探针得到 200（应 401）后，报告路由显式拒绝未被中央 gate 验为 session 的 Authorization header；不改通用鉴权与其他接口。回归保留 paired-client 正例、未知 bearer/错误 session/foreign-origin 拒绝及 service-loopback 负例。
- 合成 fixture 的计划对象也必须使用持久化规范字段顺序：collector 的绑定基于 JSON 字节顺序，手写 limits 顺序和规范 schema 顺序不同会造成合法读正例失败；不能让所有负例因同一个早期 binding mismatch 而假通过。保留真实 collector 正例、hash-matching schema 负例和 fd 读取期间的替换探针。第二轮 HTTP 夹具还把 foreign-origin 既有 403 误期望为 401，保留失败回执并修正断言，不改产品鉴权。完成前冻结文档/索引与源码一起运行体积、文档、类型和范围 lint。

- 本切片两轮后最终行为门仍为 199 通过/2 失败，明确阻断交回：新 HTTP fixture 最后 bot DELETE 得到 409（不是预期 200，后续删除授权断言未执行）；既有 dispatch restart fixture 的 `runs()[0].collection` 得到 undefined（前一次组合通过，原因未定）。不删断言、不称为 flake、不用报告文件存在冒充通过；后续须先核对实际 bot 删除协议和按 run ID 选取的快照，再由主控授权下一轮。详情在 `docs/verification/collection-report-access.md` 与私有 final-verified 回执。

## A1：有界产品验收补充（测试与证据）

- 默认 bot 的 `defaultBot` 与 `chiefOfStaff` 是独立保护条件；清除后者仍应 DELETE 409。原访问测试选了 `bots[0]`，在组合基线再次得到 409，不能放宽产品删除权限来满足夹具。改为 HTTP 新建普通 bot（201），保留默认 bot 拒绝及明确保护文案，验证 routine 创建/采集完成、报告 GET 200、routine 删除后同一响应、普通 bot 删除后 404 `collection_report_not_found`；全过程源读取 1 次且 artifact 字节不变。两页去重仍由原 dispatch 正例覆盖。
- `listRuns()` 按全局 `scheduledFor` 降序，等待 admitted ID 结束不授权用首行代表该 run。补充在停止的合成 fixture 中注入已取消、无 collection、未来 scheduledFor 的独立 routine run，加载后先确认它占首行，再按 admitted ID 同时检查 API 与 routines.json 原计划；采集前后及 SIGKILL 后保留 ID、首行 ID、全部 ID、状态和磁盘记录。原 HTTP receipt、重试同 ID、修改计划/旧 key 409、unknown 不重发和无 provider 调用均须保留。该排序控制只证明首行断言在此条件下错误；历史 199/2 中 undefined 的具体原因仍 unknown，不声称已完全解释。
- 新有界验收首轮为 5 通过/1 失败：新增 retry 断言误期望 200，现有路由实际对首次和相同身份 retry 都返回 201（`scope1-fixtures`）。第二轮仅修正测试预期为既有协议；生产访问代码字节不变，批准的 backend `3c6dc3a` 仅作为显式 bootstrap 组合依赖。最终计数、排序 selector 负例和 SHA/hash 回执见私有 `collection-access-qualification` 交接；历史日志保持不变。此任务不是质量优化，不建台账案例。

## A1：采集 UI 的验证边界

- 新类型接入原编辑器时，包装原 EventEditor 会改变既有直接捕获控件的测试边界；本轮实际 3 项失败、77 项通过。修复在真实调用入口分流采集编辑，保留原普通编辑器导出/行为，不改既有断言。新增采集组件通过实际 DOM 挂载测试输入、payload 和错误。回归入口 `src/components/routines/CollectionUI.test.ts` 与完整 `RoutineCalendarPage.simple.test.ts`。
- 真实 App 同时有 sidebar 和 Routine details 两个 aside。浏览器测试必须按 `aria-label="Routine details"` 精确选择；泛选第一个 aside 得到侧栏预览，不能当运行详情或报告正文。新浏览器夹具还修正了旧导航位置和把 SVG 加号当文本的选择器错误，这些不算产品红例。
- 后端 durable summary 的 `Path:` 行是私有元数据。采集详情只显示验证过的计数/hash 对应状态，报告正文只在显式动作后从受权路由读取并以有界、折叠 pre 显示。详情脱敏不能证明原聊天/侧栏预览也脱敏；本轮真实浏览器已看到该共享显示缺口，完整接受须由主控分配共享投影修复；报告接口获批后，本 owner 已导入共享类型，并用真实 route 的403/404/完整性409/200验证前端，不以合成 report fetch 单测冒充端到端。集成证据与限制见 [验证说明](../verification/web-collection-ui.md)。

## A1 UI P2 R1：先限制响应字节，再解析报告

- 独立审查发现 `4085f0478` 的报告先走通用 api/res.json，再做结构和显示截断；后两项不限制解析前的分配。完整 CollectionUI 红例为23通过/1失败，声明超限的响应仍实际调用一次 JSON parser。修复身份以本条提交为准：原 API 传输新增显式可选字节上限，报告固定62,000,000字节（服务端61 MB产物上限加封装余量），原认证/desktop headers/credentials、拒绝处理、15秒超时与 exact-run fence 均保留。
- 流式字节累计不能相信 Content-Length；无/低报长度仍限制实际字节，超限立即取消并释放 reader，不先 text/json。缓冲区按需增长且封顶，完整有界输入才进行 fatal UTF-8 decode/JSON.parse；分块不能切坏多字节字符，来源不能默默截断。超时和卸载信号也必须覆盖 pending body read；取消 producer promise 不结束时不无限等待它。回归 `src/lib/bounded-json.test.ts`、`src/state/api-bounded.test.ts`、`src/state/api-background.test.ts`、`src/components/routines/CollectionUI.test.ts`；覆盖真实62 MB流超限、JSON.parse未调用、Content-Length误导、UTF-8、取消/timeout、释放锁及普通API兼容。新测试的首次类型检查只因HeadersInit推断失败，修正测试注解，未改strict。
- 浏览器夹具另注入“真实200报告＋超限长度头”，要求固定错误且正文隐藏，再正常重试；与原真实403/404/篡改409及reload回归一起在最终修复提交重跑。此长度头是明确合成故障，不当成服务器真实超限响应或旧证据延伸。源码/回执/限制见 [采集UI验证](../verification/web-collection-ui.md)。本轮不改语言文件及其他owner的私有路径/copy polish，不改服务端产物上限或安全策略。

## F2：catalog 参数更改必须同步验证两套 wire golden

- `6c5d55812` 的 About me core B 有意新增 `memory_update` 选择器，但定向 call/proxy 验证未运行 catalog/bridge wire 门槛，遗留旧 golden。`48ab1be6094e3ae31038eea682ac35a7708f00d8` 上两份 wire suite 实际为29通过/59失败（catalog 31失败、bridge 28失败）；这是本地协议验证遗漏，不能回退已批准参数或归因上游。修复身份以本条所属提交为准。
- 用测试头约定的 `UPDATE_AGENTS_CATALOG_GOLDENS=1` 同时刷新两份 suite；完整 JSON 仅改变 `memory_update.description`，新增 `inputSchema.properties.old_about_me_text` 和 `about_me_text`（各含 string type/description），无移除字段。27个普通 profile 及27个 bridged twin 均增加1,102个 UTF-8 wire字节，工具名/顺序/数量不变；将这三处还原后，全部54个旧 manifest SHA-256精确匹配，才确认无其他漂移。既有 compaction 继续省略 generous bounds，不新增 wire 上限字段。
- 人工将两份 `BUDGET_BASELINE` 固定到各 profile 新实测字节，保持上下2%断言和 bridge saving/Entropybot门槛原样；旧基线本有容差偏移，因此基线数值差不能当本轮语义字节差。回归入口为 `server/drivers/agents-catalog-wire.test.ts`、`server/drivers/agents-bridge-wire.test.ts`，并重跑 proxy/call、体积/文档守卫及strict server types/范围lint。原始失败、刷新时仍有55项预算失败、逐profile字节/哈希差异和最终回执保存在主控私有 `engineering-foundation-evidence/f2-catalog-goldens/`；此修复仅关闭这项F2失败，完整13组回归仍须主控串行集成后执行，候选须独立复审。

## M1：About me 更正必须验证真实输入关系与协议边界

- 初版夹具将 notes/profile 都设成同一句英文，只证明完整字面匹配；原始发现实际是中文笔记与英文 profile。独立复审 needs-changes 后，使用完全相同的三条原句复现 1 失败/13 通过（新用例五个 absence 断言失败）：notes 已 supersede，英文旧值仍进模型提示，后续学习又追加新值。不能拿同语言绿例或 notes 正确冒充跨表述关联。原始无选择器红例的源码/patch/回执先冻结为只读证据，历史提交不改。
- 后续获批 B 协议刻意收窄：bot 从现有授权提示选择完整 exact profile 原行，传显式 old_about_me_text/about_me_text；权限仍由 owner/person 上下文决定，选择器不需要新增人工审批。旧无选择器请求改为 notes-only/not_checked，交付测试断言真实未处理状态；单独显式参数测试才证明同样中英文原句的 current-item 更正，不能宣称原请求自动修复。原 P1 的自动/持久语义关联仍 open。部分短语、compound/negated facts 不做自动匹配；整个明确选择的复合行替换需保留其他事实。
- 真实 HTTP/MCP 夹具首跑 1 通过/1 失败：把旧中文原句用作首条消息，自动标题使 source label 和正文各含一次 oldText，既有唯一性校验正确拒绝。只换夹具首条消息/标题，工具原始事实不变；一轮修正后通过，不改产品唯一性规则。strict types 首跑拒绝 driver 读取 unknown outcome.status，用已有 jsonRecord 收窄；不降低 strict。首次最终组合 630 通过/1 失败则是新 proxy 断言误要求 advertised schema 包含 maxLength；既有 compaction 会省略 generous bounds。修正为检查实际参数与说明，保留 fullInputSchema 的上限断言，并通过真实 MCP 发送超限 pair 验证 HTTP 前拒绝；不改生产压缩/上限。历史文档守卫也曾因否定句引用不存在的测试文件名失败，仍保留失败与文档冻结规则。
- Desktop 卡片同步 exact text/line 时保留 id/作者/时间，否则 remove 无法定位更正后行。notes→profile→card 非原子，profile/card/通知失败须如实区分，不能自动重放 supersede 或恢复陈旧整文件。Team checked save 拒绝静默截断；全局 removed/forgotten 不可冒充成员范围更正策略。
- Capture 入队/缓冲就记录 per-person 进程内 fence，helper 后写入前检查整个批次；dream 单独检查，别只守 outdated 行号而漏 learned。其他 bot 的同一成员共享 fence，另一成员不受影响。新 helper 读取旧来源仍可能重学，未引入持久 suppression/journal/schema。回归 `server/memory-forget.test.ts`、`server/memory-upkeep.test.ts`、`server/memory-layer.e2e.test.ts`、driver call/proxy；[验证边界](../verification/memory-aboutme-correction.md) 与私有最终回执记录精确计数。
- R1 独立复审退回 `568b71e83` 两处 provenance 漏洞，旧 631 通过不代表已覆盖：start 从真实 pending 文件恢复 turn 时直接入 buffer，flush 才取 revision，能把同进程更正前的旧 turn 重新盖成新工作；null person fence 又恒真，将 unresolved 与明确 room/team 混为一类。修改产品前复现 3 失败/71 通过（八个失败断言），保留红例源码/patch/回执。修复是在恢复加载时采样并保留 restored 标记，不在 flush 重采样；无中途更正仍可按既有策略运行，但报告标明先前进程 provenance unverified。有更正或 scope 不可信时零写入并在 lastCapture 报 deferral。不能将 prior-process 未验证当作 same-process 恢复后更正也无需保护。
- R1 内部 scope 区分 person(key)/no-person/unresolved，来源只用既有服务端 layer/audience；unknown 样本立即无效，后续解析为 Ada 也不能转正。检查 fence 时复核 person key，明确无个人目标的 room 笔记仍可运行且不受 Ada 更正影响；不能用 null 恒真或全局暂停掩盖范围混淆。首版 74/74，补全恢复/排队/缓冲/await/dream/真实 room 控制后定向 83/83；原 selector/partial-save 断言保留。新的 NEW-source 重学、先前进程修订历史、持久语义纠正仍未覆盖，原 P1 OPEN，修复候选须重新独立复审。

## P2：provider 错误在共享边界脱敏

- 原体验夹具配置 `fixture-only`、401 文案却回显未知短值 `sk-LEAK`；不能把它误诊为已知 key 的 turn-final scrub 失效。合成生产 driver 红例 13 失败/36 通过，真实隔离 server 的持久 activity 红例确认：已知 `q7!` 已脱敏，未知短值仍出现；helper 的已知 key 则确实未被既有 turn scrub 覆盖。修复身份以本条所属提交为准，详细证据/限制见 [验证说明](../verification/provider-error-redaction.md)。
- 在共享 HTTP/JSON/SSE 错误入口使用 owner-local 精确值遮蔽（无长度/前缀门槛），401/403 及识别的 auth/permission 错误改固定文案，保留状态；不要降低普通文本全局 regex 的精度或注册无 owner 生命周期的全局 secret。先遮蔽再截断，保留安全 machine-code suffix；原始 body 仍供分类。Responses 两类失败事件、chat completion errors、helper 与实际持久化/restart 必须一并覆盖，不能只验 helper。未知、编码或部分回显不承诺通用识别。
- 首轮修复五项失败：DOMException 的 message 是只读 getter，不能无条件赋值；组合后统一截断吞掉 machine code；旧 auth 文案断言需明确更新契约而保留 key-rejected/取消检查。修改后 focused 50 项通过；后续相关组合另发现一处旧401文案断言，保留334通过/1失败记录再更新。最初测试还把非流 helper 当 SSE 消费者，产品修改前已纠正并保留两次红例。HTTP200 的 JSON.parse 源码预览可能只回显长 key 的前缀，因此 malformed JSON 必须固定错误而非事后匹配完整 key。最终门槛见交接，不把中间通过冒充最终验收。
- 扩展到 optional-tools 套件的首次提交门槛481通过/1失败暴露真实回归：HTTP400同时含 invalid key 与 tools unsupported 时，新固定文案不再匹配 retry auth 分类，从而触发降级重发。保留原有一次请求断言；固定文案包含既有分类词 `Authentication required`，不扩张 retry 实现或降低工具负例。固定安全文案也属于行为协议，必须验证下游分类消费者。

### P2 R1：安全 message 不代表安全 refusal，固定文案也不能承担分类协议

- 独立安全审查 `ses_e3d5e0593ffeDzKVrErItYReAo` 对 `1c42bc68f` 退回 NEEDS-CHANGES，暂停集成。真实 driver＋owned loopback 新红例8失败/17通过，隔离生产 server 的持久 activity 红例2失败/1通过；修正证据 runner 后冻结原红例复跑合计10失败/18通过，属于重叠口径，不能相加。历史482通过未覆盖这两个漏洞，不能延伸为R1验收。
- 根因一：completion/HTTP 构造安全 message 却在 RejectedToolCallError 留 raw refusal，后续 fallback 重读 message 并先截200字；认证 body 可绕回显未知 `sk-LEAK`，完整已知长 key 在195字后变为 `fixtu`，实际持久化。修复在共享构造入口保留脱敏后的 metadata，所有投影先遮蔽再截断/抽 tool 名；auth 不进入 tool-refusal 重试展示，普通 non-auth 保留3次与原完整、安全日志字段。full-key→截断泄漏不是“未知部分 key”限制。
- 根因二：key=`a` 重写固定认证文案及 `[redacted]`，旧 retry 分类依赖文案，从1次请求变2次。修复用 error 上只含分类结果的 provenance，将原始状态/分类与呈现分开；固定 safe message 不再被后续完整 key scrub 改写。局部精确匹配转义、最长优先一次替换，保护完整本地及共享 redaction marker 的幂等性；不注册全局 secret，不改全局精度门槛。回归必须同时保留 `q7!` 与 `a` 的1次请求断言。
- R1 首轮修复又引入两个真实回归（249通过/2失败）：丢失普通 refusal log metadata、抢先 auth 分支阻断既有 Responses missing-scope route fallback。保留原断言，恢复已脱敏字段与显式 route 优先级后251通过；扩展截断/code/metadata/cause/marker 用例两文件35通过，最终同21文件选择见R1交接，不累计重复用例。原证据 runner 漏 hash tracked server e2e，保留旧回执，private新runner覆盖server/scripts/依赖entry；重跑红例而非事后补hash追认。修复身份以本条所属提交为准，仍需独立复审。
- 首次提交R1最终门槛499通过/1失败是独立夹具断言错误：旧单字符 `x` 用例检查整段 event JSON，随机生成 eventId 含 `x`，而 message 已正确遮蔽。改为必须得到真实 runtime.error 并只检查其用户可见 message，保留同一 `x` 输入及 code suffix 断言；不换无冲突字符、不改产品源码。生成元数据的偶然字符命中与真正上游值回显/重遮蔽行为须分别判断。

## 安装证据与启动验收边界（2026-11-11）

- 触发：品牌交接曾把后补文档的 09:57 当作 d075 安装时间，原始 preinstall 元数据却记录 09:30，09:41 旁证已包含当前 ASAR。先比较原始回执和实际包体，再判断哪个候选先安装；同一个恢复 hash 不能被标成未含品牌修复的旧版。完整历史时序与完整产物不可变来源尚未证明，当前字节匹配不能追认历史。
- 安装器冻结 a49 来源只证明匹配该批准版本，不检查后来接受修复的闭包；目标更新前须明确最终候选及应保留修复的内容/行为证据。open 返回 0 的 `installed-awaiting-startup-validation` 不是产品可用，启动后可能写数据时也不能盲目自动回退。当前缺少通用的修复包含门槛及窗口/health 验收接线，本轮仅记录缺口，未实现新发布放行。
- 隐藏渲染的首轮截图只有背景和关闭按钮，PNG非空与DOM文案正确仍不能证明实际文字已绘制。原回执和图保留在 hidden-attempt1；夹具补字体/图片就绪及有界文本区域像素检查，原4场景重测后人工确认中文图。等待和像素检查只修自有夹具，不修改产品。
- 回归与限制：外层 private/delivery-gap-check-20261111/ 中保留来源审计、4 种语言隐藏 Electron 渲染、132 项聊天/迟到回执检查及安装复制 ENOSPC/EACCES 子例。隐藏渲染只加载打包模块，不等于完整主程序启动；安装器首轮 4 子例因自有 phase 预期错误失败，修正后同 4 子例通过，原日志保留。真实安装、Keychain、TCC、完整窗口交接和发布未验，不据此关闭这些边界。

## F2：verdict 名称与精确集合是消费端协议

- 平台处置契约要求零 failed/todo，skip 逐条显式处置且永不计通过；producer 负责原报告与 artifact 一对一对账及主控审阅，consumer 只验证可信来源与 verdict steps。第二步固定为 `Strict totals: no failures or todos`，不能继续接受旧的零 skip 名称或据改名宣称 producer 已实现。
- 本次聚焦负例发现仅逐项 `count === 1` 会接受额外绿色 verdict；补精确长度约束，保留五项各一次检查。回归入口 `scripts/entropybot-release-gate.node-test.mjs` 固定五个名字，覆盖每项 missing/duplicate/同长度替换、旧名替换及 extra。原 consumer 的新增测试为77通过/3失败，其中旧名替换用例因尚无新名而在夹具修改处 TypeError，不能把该项算实际拒绝漏洞；两项 extra 实际缺少预期拒绝。证据在外层 private/engineering-foundation-evidence/f2-gate-disposition-contract/。信任映射保持空，未实现 producer 或变更 workflow；最终仍需独立审查后主控串行集成。

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

## M1b：过期条目的检索投影

- 触发：带 `until` 的主题条目含缩进续文/闭合代码围栏。`withoutExpired` 只删 `entry.line`，续文失去首行身份后仍进入 SQLite 索引、召回和 embedding 请求；prompt/capture 已正确并不证明检索路径正确。修复按既有 `[line, end)` 整段过滤，`hidden` 仍按条目计数，不改原始 Markdown、解析语法或历史/日志/备份。修复提交见 M1b 交付 SHA；回归入口 `server/memory-entries.test.ts`、`server/memory-expiry-retrieval.test.ts`，先保留 4 个断言失败的红例，再验证实际索引、file search、`buildRecall(threadIds: [])` 与无 FTS 命中的主题别名、假 embedding 输入、无文件编辑的跨日重投影及 await 后 stale hash 拒绝。真实模型质量、provider 副本删除、跨聊天遗忘和物理擦除未验证。
- 本轮验证再次触发 L17：证据 runner 显式使用深层 `TMPDIR`，fake-engine workflow 在 memory 验证前因 permission socket `listen EINVAL` 失败。保留原 suite/server 日志，移除 runner 的 TMPDIR 覆写后仅重跑受影响 workflow；不修改产品、不降低断言。此环境失误与本轮产品修复分别记录，详见 `docs/verification/memory-expiry-retrieval.md`。

## M1：tidy 必须归档和删除完整条目

- 触发：过期条目带缩进续文和闭合代码围栏。`applyTidy` 只删 `entry.line`、只归档 `entry.raw`，续文失去过期首行后进入实际 prompt、SQLite 索引与 file search；旧投影过滤正确也挡不住身份已被 tidy 删除的孤立内容。修复使用解析器 `[line, end)` 整段删除并完整归档，来源、until、续文与围栏保留，过期标记仍在首行。修复身份以本条所属提交为准，证据见 [验证说明](../verification/memory-tidy-spans.md)。
- 仅凭首行 `factIdentity(entry.body)` 不能判定多行重复：同标题不同续文会被合并。此修复保守保留所有多行条目（完全相同者也保留），单行归一化、日期优先和正负数区分保持原样。回归 `server/memory-tidy.test.ts` 覆盖真实 plan/apply 后的投影以及 core/topic 的生产 upkeep 持久归档与第二次 no-op；修正夹具后的基线为 7 失败/1 通过，修复后定向 8 项通过，相关套件计数见交接，不能叠加重复用例。
- 首轮夹具误把 `readMemoryTopic` 的 string 当 `{text}`，且误以为 parser 支持 CRLF 日期首行；保留原失败并在修改产品前修正。CRLF 控制仅证明未识别文本不被修改；单 token recall 基线本已因准入返回 null，不冒充 recall 泄漏红例。archive 仍按既有政策可检索，不称彻底遗忘。多行 contradiction/remainder 的续文归属是另一个范围，本轮未改；真实数据、模型、Keychain、安装与跨平台未验证。

## M1：多行条目暂不参加自动 supersession

- 触发：contradiction helper 只读取多行条目的首行，而 `applyTidy` 将 dated remainder 插入旧首行与续文之间。合成红例实际把唯一续文 canary 的 owner 从已划掉原条目移到活跃 remainder，并经 core/topic 的生产 `createMemoryUpkeep().tidy()` 持久化；原投影按完整 span 过滤也无法恢复旧归属。基线红例 6 失败/6 通过；最小修复后定向 12 项通过，最终相关门槛与 SHA 见 [验证说明](../verification/memory-tidy-supersession.md) 及私有 source-bound 回执。
- 修复在共享 `contradictionCandidates` 排除 `[line, end)` 超过一行的条目，prompt 和 `planTidy` 复用同一候选顺序；不能只隐藏 prompt 而保留 planner 的旧索引。完整多行原文继续保留、活跃、未解决。旧两项候选长度由 2 改为 0，同时保留 duplicates 为空和 apply 后原文字节不变的检查。修复身份以本条所属提交为准。
- 回归入口 `server/memory-tidy.test.ts`：真实 helper 输入/返回索引/计划及 core/topic 持久化、prompt/index、第二次 tidy；交错 multiline/single-line、正负数、remainder、默认 live-count budget 和 `minimumBudget`。十条 live 中仅五条 eligible 仍须有 budget 2，不能无意改为按过滤后的候选数计费。既有完整段 expiry/dedupe 和相关 retrieval/upkeep/projection 套件继续执行。
- 公共 `applyTidy` 仅验证同源 `planTidy` 生成的有效计划，不声称防御外部伪造多行 plan 或陈旧 source。未发明全文纠正语义，不扩张 parser/历史/日志/备份/遗忘政策。真实模型、用户数据、Keychain、UI、安装与跨平台未验证。runner 在 subprocess 返回后立即捕获单调时长，不能把 after-snapshot 开销计作命令耗时，也不改名追认旧计时。
