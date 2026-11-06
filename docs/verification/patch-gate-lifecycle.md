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

执行结果区分 `[exit]`（退出码/信号）、`[start]`（spawn 拒绝）、`[timeout]`（命令或整体截止）、`[cancelled]`（SIGINT/SIGTERM/调用方取消）、`[cleanup]`（父已退出仍有输出或组内后代）、`[unsupported]`（平台无法建立所需归属）。错误附带 `cleanupConfirmed`，执行原因与回收状态分别保留。CLI 失败均退出 1，不打印成功。SIGINT/SIGTERM 在命令运行中和命令间隙都取消整体；重复信号只收口一次。取消到退出可以多用终止/观察宽限。

Unix 支持路径为本次 `spawn(detached: true)` 建立的独立进程组，仅探测/终止该 PGID。正常成功同时需要观察直接子进程退出、Node `close`（受管输出流结束）和组消失；父 exit 或 close 单独都不证明后代已停。TERM 后仍存活则升级 KILL，再在有限时间内观察；权限错误按仍在/不确定处理。组第一次确认消失后不再给该组发迟到信号。输出流错误会终止命令；内存捕获仅保留各流最后 4,194,304 个字符串字符，超出时返回 `outputTruncated`，转发模式另输出可见提示，转发本身继续。未排空的流在观察截止后关闭父端句柄，返回不确定失败。结果/错误的 `evidence` 分别记录直接子进程 exit、输出 close、组消失及 TERM/KILL 尝试的时间，不把发出信号当作停止证明。

目前仅 Darwin/Linux/FreeBSD/OpenBSD/NetBSD 进入 POSIX 实现。本轮真实证据为 macOS；Linux/BSD 尚未验证，特别是无法及时回收的孤儿 zombie 会保守返回不确定。**Windows 和其它平台在启动任何行为命令前明确失败**，不以 taskkill 裸 PID 或 mock 冒充 Job Object/树归属。Windows 完整门槛需后续独立实现并验收可靠树边界；结构模式仍可使用。本次没有更改 workflow 来绕过失败。

临时目录只由该次调用 mkdtemp 取得。确认回收后才删除；未确认则保留目录、输出路径，并尝试写入仅含执行错误与回收状态的 `lifecycle-failure.json`。删除失败使门槛失败；已有执行错误保留为首因，另记录删除错误。无法写证据文件也会明确打印错误。runner 的信号/AbortSignal 监听、整体/命令/轮询计时器都在 close/结算时释放。

能力边界：不扫描全局进程列表，不按名字 kill，不处理主动 setsid/脱组后代，不承诺 PID/PGID 在观察间隙复用时的绝对身份保证。SIGKILL、OS 崩溃或宿主直接硬停使父进程无法运行收尾；POSIX 组内停止也不能证明逃逸后代消失。未知回收时保留证据并交人工核对，不递归清扫任意调用方目录，不以删目录成功反推进程已退。

定向验证（应用 checkout 根，Node 24，默认短 TMPDIR）：

```sh
node node_modules/vitest/vitest.mjs run --root "$PWD" --config "$PWD/vite.config.ts" --configLoader native scripts/testing/patch-gate-process.test.ts scripts/testing/patch-gate-cli.test.mjs scripts/testing/patch-contracts.test.ts scripts/testing/file-size-ratchet.test.ts
```

合成进程有 READY 握手、心跳和 8 秒自身保险，CLI 探针有独立 6 秒监督者；保险退出不能算 runner 成功。测试覆盖正常、非零、spawn 失败、命令/整体超时、预取消/命令间信号、重复信号、忽略 TERM、父先退且后代保留/关闭输出、旁边无关控制进程继续写心跳，以及回收拒绝、删除拒绝、缺损 JSON/TAP、空 suite、skip/todo/失败和真实 CLI 不启动后续 suite。CLI 使用临时 checkout 与明确合成本地测试程序，验证 runner 接线，不冒充全量产品门槛或真实用户服务验收。新增测试由主控登记 manifest/CI，最终组合完整门槛另行执行。
