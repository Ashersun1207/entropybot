# 补丁门槛的进程生命周期

Node 24、安装既有依赖后，入口保持：

```sh
node scripts/check-patches.mjs
node scripts/check-patches.mjs --verify
```

默认只检查结构；`--verify` 的真实 CLI 与 `verifyPatchBehavior(root, options)` 都 await 异步执行和收尾。脚本所在 checkout 决定 CLI 根，入口及显式 root 解析真实路径，支持 `/var` 与 `/private/var`、符号链接等同目录别名；不支持其它 CLI 参数。环境白名单、临时 HOME、默认短 TMPDIR、显式 Vitest root/config/native loader 与登记 suite 的目标路径校验保持。不要为归档全局设置深层 TMPDIR；运行结束后复制日志。

`scripts/patch-gate-process.ts` 是唯一命令生命周期模块，以可执行文件和参数数组启动本地受信命令，不使用 shell。一次执行只允许一个命令，失败后拒绝后续命令。默认预算：

| 边界 | 预算 |
|---|---|
| 整个行为执行（结构预检后开始，包含命令间隙） | 15 分钟 |
| Vitest 命令 | 10 分钟，且不超过整体剩余时间 |
| 每个 Node test 文件 | 2 分钟，且不超过整体剩余时间 |
| 软终止宽限 | 3 秒 |
| 强杀后的组/管道观察 | 3 秒 |
| 正常父退出后的输出/后代排空宽限 | 250 毫秒，之后作为残留失败收尾 |

第二轮完整门槛在本机约一分钟量级；上述预算为 CI/较慢机器留出余量，并在现有 CI 20 分钟 job 限制前进入有限收尾，不以 job 截止充当回收。程序调用可用正整数毫秒覆盖 `commandTimeoutMs`、`overallTimeoutMs`、`graceMs`、`killWaitMs`，可传 AbortSignal；CLI 不增加预算/命令注入参数。整体截止不会逐 suite 刷新，每次 spawn 前再查取消和单调时钟截止。文件系统同步预检及删除本身不是可抢占的硬实时操作。

执行结果区分 `[exit]`（退出码/信号）、`[start]`（spawn 拒绝）、`[timeout]`（命令或整体截止）、`[cancelled]`（SIGINT/SIGTERM/调用方取消）、`[cleanup]`（父已退出仍有输出或组内后代）、`[unsupported]`（平台无法建立所需归属）。错误附带 `ownedGroupStopped`，它只确认本次受管外组，不包含正常 fixture 另建的 CLI 组。CLI 失败均退出 1，不打印成功。SIGINT/SIGTERM 在命令运行中和命令间隙都取消整体；重复信号只收口一次。取消到退出可以多用终止/观察宽限。

Unix 支持路径为本次 `spawn(detached: true)` 建立的独立进程组，仅探测/终止该 PGID。正常成功同时需要观察直接子进程退出、Node `close`（受管输出流结束）和组消失；父 exit 或 close 单独都不证明后代已停。TERM 后仍存活则升级 KILL，再在有限时间内观察；权限错误按仍在/不确定处理。组第一次确认消失后不再给该组发迟到信号。输出流错误会终止命令；内存捕获仅保留各流最后 4,194,304 个字符串字符，超出时返回 `outputTruncated`，转发模式另输出可见提示，转发本身继续。未排空的流在观察截止后关闭父端句柄，返回不确定失败。结果/错误的 `evidence` 分别记录直接子进程 exit、输出 close、组消失及 TERM/KILL 尝试的时间，不把发出信号当作停止证明。

目前仅 Darwin/Linux/FreeBSD/OpenBSD/NetBSD 进入 POSIX 实现。本轮真实证据为 macOS；Linux/BSD 尚未验证，特别是无法及时回收的孤儿 zombie 会保守返回不确定。**Windows 和其它平台在启动任何行为命令前明确失败**，不以 taskkill 裸 PID 或 mock 冒充 Job Object/树归属。Windows 完整门槛需后续独立实现并验收可靠树边界；结构模式仍可使用。本次没有更改 workflow 来绕过失败。

Gate 的异常、超时、取消或 unknown 一律保留本次 mkdtemp HOME、报告及 `lifecycle-failure.json`，即使外组已 gone 也不删除。正常删除必须原报告通过、每个登记测试文件有完成记录、所有本次 fixture lease 均已可信完成、且外组已停。摘要分别记录 `ownedGroupStopped` 与 `internalResourcesConfirmed`；后者只指已登记的验证 fixture spawnCli 资源域。删除失败同样使门槛失败且保留首因。runner 的信号/AbortSignal 监听、整体/命令/轮询计时器在结算时释放。

`verification-lifecycle.ts` 为受控工具创建私有能力描述文件和认证 lease。Node preload 把能力保存到受控 worker 生命周期内的状态；Vitest 4.1 过滤管理进程的普通 execArgv，因此门槛显式使用其 `--execArgv` worker 选项。每文件 setup 创建/结束文件 lease，即使隔离模块重载或 worker 更换，也不能因 env 已消费或没有 pending 记录就宣称完成。工作进程移除 bootstrap 参数，能力不进入产品环境、引擎/MCP argv 或配置；不用 NODE_OPTIONS。文件鉴别防止错绑、陈旧和意外伪记录，不是同 UID 恶意测试代码的沙箱；完成文件中的 PID 不成为 kill 来源。

`launchVerificationServer` 的 preload/专用 ChildProcess IPC 在产品入口前完成 INIT，绑定协议版本、gate/fixture/server nonce、generation、canonical dataDir 及真实服务器进程；INIT 缺失/错误/断线不能回退产品模式。环境继续使用同目录的短路径，协议单独使用 canonical 身份，避免 macOS socket 路径增长。普通产品不加载该 preload，资源 tracker 默认 noop。

验证模式的 `procs.spawnCli` 在真正 spawn 前检查 seal，再登记实际 ChildProcess 的 `killCliTree` 停止闭包；登记异常也接管已创建句柄并保持 unknown。直接 exit 不退休尚未确认的组。关闭开始先 seal，并行运行原 cleanup 与资源 drain，逐句柄结果均 true 才发 stopped；明确 spawn 拒绝且未产生 PID 才可按未执行的空资源确认。无需改 drivers，也不把 Claude `session.closed`、registry allSettled 或 server exit(0) 当作组停止证明。

新增 drain 默认 TERM 500ms、复用 killCliTree 的 KILL 后 1s 观察，并行总上限 2s；回执 flush 最多 250ms，均计入 graceful 原有 6s 总截止。已有停止任务若超过剩余预算即 unknown，不延长它伪装成功。index 既有退出日志 flush 不作停止证明；launcher 另以最多 8s 观察实际服务器 exit/close。外层 3s 升级可能先杀服务器，此时缺回执必须保留，不能用延长 grace 替代确认。

fixture 只有收到本次实际 ChildProcess 通道的匹配 stopped 回执，并观察成功 exit/close 后，才完成 lease 并删除真正 dataDir。启动各失败分支、意外退出、close/restart 共用该收口；失败写 `verification-stop-unknown.json`，重复 close 缓存原 Promise/错误。unknown lease 为终态；删除拒绝可将 stopped 降为 unknown。context restart 先停旧代、保留目录后再运行 beforeLaunch/新 spawn，分配新 nonce/generation；旧回执不能完成新代，关闭与新代启动竞争时禁止再 spawn。

能力边界：外组与正常 fixture 的 spawnCli 自建组是两层不同证明；本模块不新增全局进程扫描、不按名字 kill，内部停止复用既有 killCliTree 的归属机制。确认域不包含未登记的任意第三方/未来资源、主动 setsid 逃逸或 PID/PGID 观察间隙复用的绝对身份保证。SIGKILL/OS 硬停使父进程无法收尾时保留 unknown；不递归清扫调用方任意目录，不用删除成功反推已停。

定向验证（应用 checkout 根，Node 24，默认短 TMPDIR）：

```sh
node node_modules/vitest/vitest.mjs run --root "$PWD" --config "$PWD/vite.config.ts" --configLoader native scripts/testing/patch-gate-process.test.ts scripts/testing/patch-gate-cli.test.mjs server/verification-process-scope.test.ts scripts/testing/verification-lifecycle.test.ts scripts/testing/verification-boundary.e2e.test.ts scripts/testing/patch-contracts.test.ts scripts/testing/file-size-ratchet.test.ts
```

合成进程有 READY、心跳和独立监督/自退保险；保险退出不能算 runner 成功。除局部组、预算、信号与报告负例，还验证生产 spawnCli/createGracefulShutdown 的 awaited/unawaited/forced 三场景、同一 VM worker 的两个隔离文件、两个 fork worker、真实 fixture restart、INIT/身份/陈旧回执、登记/停止/flush/删除失败，以及真实 CLI 对 pending lease/缺文件确认的拒绝。测试监督者只根据自有进程或由本次创建者 IPC 绑定的实际 spawnCli 身份精确回收，不读取任意 PID 文件清扫。新增测试由主控登记 manifest/CI；全量产品门槛与平台验收另行记录。

## 本轮回归经验（由主控汇总到 AGENT_LESSONS）

- 外组 gone 不包含 fixture 的独立 spawnCli 组。真实 forced 探针证明外组退出后内部/MCP 心跳仍能推进；删除必须同时检查资源回执与认证 lease。回归：`verification-boundary.e2e.test.ts` 的生产三场景。
- Vitest 4.1 过滤管理进程普通 execArgv，且单 worker 的 forks 仍可能为不同文件创建不同 PID。显式传 worker bootstrap，并以 vmForks 验证同 PID 两隔离文件、forks 验证两个 worker；文件完成记录防止缺能力时空计数通过。回归：同文件 worker-isolation 与缺文件确认负例。
- INIT 不能抢在 preload 监听之前发送；先由实际 ChildProcess 发 awaiting-init，再交付绑定身份。Node 24 的 INIT 前 IPC disconnect 曾出现 exit/stderr close 而无 ChildProcess close，生产不得将其替换成已确认关闭。回归：managed entry 负例与 lifecycle INIT timeout。
- 不存在的可选 CLI 会明确 spawn 拒绝且无 PID，这与 INIT 后失败不同；仅前者可按未执行的空资源确认。登记异常须接管已产生的实际句柄，unknown 不可重新完成；旧代停止和 close 的交接也必须禁止并发新 spawn。回归：`verification-lifecycle.test.ts` 的实际登记失败、spawn 拒绝、旧代和 close 竞态。

这些经验由隔离 macOS/Node 24 实测支持；尚不构成 Windows、任意第三方逃逸资源或同 UID 恶意代码的验证。
