# 0.2.5 凭证迁移失败与回滚隔离验收

2026-11-07；负责人：独立对话 B。基线 `2905edd583cc18f47ed5bab99ad0f24fddcd9e6f`，本地分支 `verify/credential-rollback-b`。应用仓库独立 worktree：

`/private/var/folders/3_/4wcgrlpj1cx98_dychpdms240000gn/T/opencode/credential-rollback-b`

Node `v24.22.2`；`node_modules` 仅链接主 checkout 已有依赖，没有安装。只修改 credential-namespace-migration 系列源码、测试与本页；未修改 shared-computer-access、签名设置、工程经验文档、本机应用或真实资料。

## 确认问题、修复和回归

| 问题 | 根因与影响 | 本轮处置 | 回归入口 |
|---|---|---|---|
| 内部 CLI 可无授权导出解密结果 | child 只检查 flag，文件路径来自调用者环境；base64 可逆，stdout 是明文传输，原有 Keychain 授权也不等于本次导出授权。通过源码确认，未探测真实库 | 在任何凭证文件读取、Safe Storage 调用之前要求原生确认框明确授权；默认/关闭均取消，确认框失败也拒绝。没有环境变量绕过 | `electron/credential-namespace-migration-child.test.mjs`；acceptance fixture 的 child-denied / child-authorized |
| await 期间源库变化会被覆盖 | 只在 encrypt/decrypt 之前检查源 hash；成功路径会覆盖较新写入，catch 还会恢复陈旧 original。正常启动的单实例锁不能约束外部写入；旧名 child 分支主动绕过正常实例锁 | await 完成后、rename 前同步重读源字节；变化即失败；catch 只删除本事务临时文件，绝不把 original 写回目标。原子 rename 前目标未被本事务修改 | `credential-namespace-migration.test.mjs` 的 encrypt/decrypt 并发写入与 encryption rejection 三项 |
| 子进程 error 被误当退出 | spawn 成功后 kill/control 仍可能触发 error，原来无条件 finish 并删除 profile | 有 PID 的 error 进入 TERM→KILL→等待 close；信号同步抛错也继续回收策略；无法确认退出时保留 profile，返回路径并记录日志 | `credential-namespace-migration-runner.test.mjs` 的 kill errors、post-spawn error、retained evidence；rollback suite 的真实 Node 子进程 |

原生确认是用户授权边界，不是调用进程身份鉴权。明确授权之后仍通过父子 pipe 传递可逆 base64；本轮没有把它宣称为加密传输或抵御同一 OS 用户的恶意进程。原生确认框的实际点击交互未人工演练，fixture 替换了 dialog 返回值；产品源码没有测试绕过开关。取消会记录 failed marker，同一源字节下次启动不再反复请求迁移；再次尝试需明确恢复流程，不能假装自动重试成功。

## 执行入口与结果

在本 worktree，使用 Node 24 的 PATH：

```sh
export PATH=/Users/sun/.nvm/versions/node/v24.22.2/bin:$PATH
node node_modules/vitest/vitest.mjs run electron/credential-namespace-migration.test.mjs electron/credential-namespace-migration-runner.test.mjs electron/credential-namespace-migration-child.test.mjs electron/credential-namespace-migration-rollback.test.mjs electron/secure-credential-io.test.mjs
python3 electron/credential-namespace-migration-acceptance-fixture.py
node node_modules/oxlint/bin/oxlint --deny-warnings electron/credential-namespace-migration*.mjs electron/secure-credential-io*.mjs
node node_modules/vitest/vitest.mjs run scripts/testing/file-size-ratchet.test.ts electron/secure-credentials.test.mjs electron/secure-credential-state.test.mjs
node node_modules/typescript/bin/tsc -b
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node scripts/check-patches.mjs --verify
```

- 定向 Vitest：5 文件 / 46 项通过，无跳过。覆盖合成 denied/locked 后保存被拒、旧密文字节和独立合成配置不变、重建 IO 后不重复尝试、迁移成功后重启、恢复旧备份后二次迁移、备份保留。
- 反向证据：把 pinned 基线 `2905edd58` 的四个模块提取到 evidence 内独立 sandbox，运行本轮 migration/runner/child 三个 suite；26 项通过、10 项按预期失败。失败覆盖无授权读取、await 并发写覆盖、异常恢复覆盖、kill error 删 profile 和缺少保留路径报告。部分失败检查新增返回字段，因此不把 10 项全部计为独立产品缺陷；完整 JSON 和日志保留。
- 生命周期：真实合成 Node 子进程忽略 TERM，实际收到 TERM 后被 KILL；close 后 PID 不存在且 profile 删除。mock 的存活/控制失败子进程在未 close 时不删 profile；abandon 后即使迟到 close 也保留证据目录，这是保守保留策略，不是已回收的声明。确认域只覆盖直接子进程，没有验证 Electron 的全部后代进程。
- 补充守卫：3 文件 / 18 项通过；源码体积预算未变。定向 oxlint 无警告；客户端和服务端 typecheck 通过。
- 统一补丁门槛：30 项结构契约；46 个 Vitest 文件 / 1000 项，以及 5 个 Node 文件 / 29 项通过。完整结果见 `patch-gate.log`；这不替代本轮新增的定向 46 项与平台 fixture。

## Electron mock 与原生私有 Keychain 的不同证据

acceptance fixture 只从已存在的 Electron `v43.7.9` 缓存解压到自有临时目录，先按已安装依赖 checksums 核对 SHA-256，没有下载。它给 Electron 设置隔离 HOME / userData，所有 Electron 调用均带源码支持的 `--use-mock-keychain`，只读取合成 credentials.bin，不启动本机 app。

实际结果：未授权没有结果帧且源库不变；明确授权后合成字段 round-trip；迁移后独立 Electron 进程重读成功；恢复旧备份后二次迁移成功。没有把明文/base64结果保存到证据日志。

旧版本兼容采用 `8138dca42`（0.2.4）的原始 `electron/secure-credentials.mjs`，由 `git show` 提取到隔离目录。其 SHA-256 为 `52a58a567b70ebb3906fdac2cf258a84c3c3f440dce527401ac8678da05121c2`。在 Electron mock-keychain 中，该 reader 能读迁移生成的 0.2.5 credentials.bin。这个结果证明文件/JSON reader 格式兼容，不证明真实旧安装包的服务名、签名或 ACL 能解密新密钥生成的文件。

首次平台 fixture 在恢复备份后二次迁移处失败：mock keychain 对新旧 app name 使用相同密钥，紧凑 JSON 输入会产生完全相同的源/结果密文字节，marker 因此正确抑制重复迁移。fixture 修正为种子使用带缩进 JSON、迁移使用紧凑 JSON，以构造可区分的合成源/结果字节；产品规则未放宽。首次失败日志与后续通过记录均保留。

真实 Security.framework 验收复用已审读的 `scripts/testing/keychain-isolation-fixture.swift`，仅用显式文件参数创建/打开一次性 `fixture.keychain`，关闭用户交互，不更改用户搜索列表。只执行 seed/read/lock，无签名变更命令：

| 状态 | old 合成项 | new 合成项 |
|---|---|---|
| seed | status 0，值匹配 | status 0，值匹配 |
| 独立进程 read | status 0，值匹配 | status 0，值匹配 |
| 锁定后 read | `-25293`，未取出值 | `-25293`，未取出值 |

缺失合成项为 `-25300`。前后只读比较用户 default-keychain 和 list-keychains，均完全相同；自有 scratch 已清理。这证明显式私有 Keychain 的锁定失败，不等同真实 Electron ACL 拒绝演练；本轮未操作真实 ACL、真实 profile、真实凭证、配置、记忆或用户 Keychain。

## 证据与剩余边界

证据目录：

`/private/var/folders/3_/4wcgrlpj1cx98_dychpdms240000gn/T/opencode/credential-rollback-b-evidence`

| 文件 | 内容 |
|---|---|
| `vitest.log` | 最终定向 46 项 |
| `platform.json` / `platform.stderr` | 最终 Electron mock + 私有 Keychain 通过；stderr 为空 |
| `platform-initial.json` / `platform-initial.stderr` | 首次 mock 字节相同导致的 fixture 失败 |
| `guards.log` / `lint.log` | 体积与安全凭证补充回归、无警告 lint |
| `typecheck-client.log` / `typecheck-server.log` | 两项类型检查，成功时为空 |
| `patch-gate.log` / `patch-gate-final.log` | 首次及本地提交后统一补丁契约/行为门槛 |
| `baseline-regression.log` / `baseline-regression.json` | pinned 基线套用新增回归的失败证据 |

每轮收尾已审查本次新增的凭证读取、stdout、进程启动/取消、文件覆盖/删除与 fixture 边界。未新增依赖、安装钩子、网络请求或下载执行；未改签名、发布、打包或安装设置。新失败模式集中记录在本页，由主控在集成后维护工程经验真源，本分支遵守不改经验文档的范围限制。

还未证明：真实 Electron 的 ACL Deny/Allow 与锁定端到端迁移；稳定签名升级/回滚；旧安装包在真实新命名空间读取；原生确认框实际 UI；Electron 全部后代进程退出。最终同步源检查到 rename 之间仍不是跨进程原子 compare-and-swap，无法阻止不受协调的外部进程恰在该短窗口覆盖文件；本次修复覆盖 await 期间变化和失败恢复覆盖。旧 `scripts/testing/legacy-credential-read.e2e.py` 按无确认时代的协议编写，本轮不应无人值守运行它；应使用本页的新 fixture。没有构建、安装或发布产物。
