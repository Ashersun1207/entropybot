# Chrome engine minute regression：有界返工交接

状态：源码修复与指定回归完成，**交独立复审**。原 11 文件组合 126 项全通过；`server/browser` 目录默认套件 933 项通过、0 失败、111 项跳过，但辅助严格租约审计因本次整体跳过的 e2e 文件遗留 pending file lease 返回 1，未改判为全绿。目录结果不等于全仓或发布放行。

## 身份

- worktree：`/Users/sun/Desktop/Codex/gorkbot/.worktrees/release-chrome-close`；分支 `codex/release-chrome-close`。
- 基线：`8c6ba2ad3a22409226fb009d24ffe69dce9507ee`，tree `66d5713c80a4276e0d2965f87c22da7367f80de6`；与主控所述 integration `f00ae86` 的该范围 tree 一致。
- 源码提交：**`4abc5ccda`** — `fix: keep Chrome maintenance tasks independently scheduled`；源码 tree：**`7ec1bbba335b1fba60007060fe87fe7ff91ce884`**。
- 最终 HEAD / tree：源码提交之后另有一个只新增本交接文档的 docs 提交；包含该文档的准确最终 HEAD/tree 记录在持久 `delivery.json` 的 `finalHead` / `finalTree`。源码行为与上述源码 tree 一致。
- 仅改 3 文件：`server/browser/engines.ts`、`server/browser/engines.test.ts`、`docs/engineering/AGENT_LESSONS.md`。未修改 integration、fixes、live 或其他 task worktree。
- 持久证据：`/Users/sun/Desktop/Codex/gorkbot/private/release-completion-evidence/verification/engines-regression/`；`delivery.json` 绑定最终提交/tree、源码与日志 hash、三层运行结果和目录 skip/租约分类。

## 根因与最小修复

### fake time 与真实 OS sweep 未完成

旧 minute 用例只注入 `closeIdle` spy；`#tick` 仍同时启动原 sweep。sweep 内部调用 OS 进程枚举，fake timer 的 `advanceTimersByTimeAsync` 并不等待它完成。旧共享 `#maintenance` fence 因而在两个分钟 tick 间保持非空，后续 tick 直接 return：expected 3 实际 1。`server/browser/engines.test.ts` 位于旧 108 定向组合之外，所以未被发现。

### 产品独立任务饥饿（受控红例证实）

新增两个受控 promise 用例，分别让 sweep 和 idle close 保持 pending：

- sweep pending 时，原有 minute 仍只调用 closeIdle 1 次，而 sweep 1 次；释放后下一次分钟恢复。
- idle close pending 时，sweep 仍只有 1 次；释放后两者恢复。

这证明共享 fence 会把两个独立任务互相阻塞。最小产品修复将防重入改为**按任务名**持有：同一任务未完成时仍不会重入；`idle close` 与 `registry sweep` 可各自每 tick 运行；`close()` 等待调用时所有在途任务完成后再关闭 service。没有移除防重入、没有把 sweep 改 noop、没有吞维护错误。

## 回归隔离

`engines.test.ts` 保留 expected 3 和 inactive 资源存在/消失后不再维护的原断言，新增受控 pending 正反用例。维护测试使用原 sweep 算法，只注入 OS list/alive/kill 合成边界；旧 minute fixture 通过同一安全模式让真实 sweep 完成，而非等待真实 Chrome 或真实进程终止。

实际未执行真实 Chrome、个人账号、模型 CLI 或 Keychain；未安装或发布。

## 三层有界结果

Node 24.22.2、Vitest 4.1.11，复用 app/node_modules，无安装。所有运行使用合成 HOME/data，默认短 TMPDIR。

| 日志 | 实际结果 |
|---|---|
| `baseline-minute-red.log` | 基线 `engines.test.ts` + `engines-maintenance.test.ts`：2 文件/22 项，2 失败/20 通过；失败正是 minute 261/276 expected 3 actual 1 |
| `controlled-maintenance-red.log` | 加入双向 pending 用例后、修复前：2 文件/24 项，2 失败/22 通过 |
| `round-1-targeted.log` | 修复后同一 2 文件：**24 项全部通过** |
| **`focus-run.log`** | 受限监督器跑原 10 文件 + `engines.test.ts` 共 **11 文件/126 项通过，0 失败/跳过**；10.634 秒；禁止真实浏览器启动=0；自有进程组消失；租约审计 exit 0；运行前后源码一致 |
| **`directory-run.log` / `directory/summary.json`** | `server/browser` 目录默认套件：**62 文件，54 passed / 8 skipped；1044 项，933 passed / 0 failed / 111 skipped / 0 todo；exit 0，82.238 秒，无 timeout、无信号**。辅助严格租约审计 exit **1**（见下） |
| `typecheck.log` / `lint.log` / `size.log` | server typecheck、变更范围定向 lint、体积守卫通过；staged diff 检查通过，预算未改 |

目录监督器仅清理自有外层进程组中的残留，不按名称杀进程；使用真实合成默认环境而不是本机 Chrome 自动发现，显式隐藏系统 Chrome 路径并拒绝真实 Chrome/UI 启动。`forbiddenBrowserLaunches=[]`，`ownedGroupGone=true`，`sourceUnchanged=true`。

### 目录 skip 与严格租约审计

`directory/conditional-tests.json` 列出 111 个 skip 的实际名称；主要来自 8 个整体跳过的真实 Chrome/CDP e2e 文件：

- `checklist.e2e.test.ts` 16
- `passkey-wall.e2e.test.ts` 4
- `s4-actions.e2e.test.ts` 32
- `s4-identity.e2e.test.ts` 8
- `s4-pages.e2e.test.ts` 20
- `stream-v2.e2e.test.ts` 11
- `viewers.e2e.test.ts` 10
- `hostile-pages.e2e.test.ts`（本环境无 Chrome，跳过）
- 其余为单个平台/条件 skip（如 Linux 进程归属、Windows 进程、Windows 进程系统调用等）

**严格租约审计未通过的唯一原因**：上述整体跳过的 e2e 文件各自留下 `pending` 的 **file lease**；`lease-audit-classification.json` 已逐项核实全部属于跳过文件，**没有任何 fixture lease 处于 pending/unknown**。这是本轮“无真实 Chrome”合成运行的测试框架生命周期遗留，不是业务断言失败。没有修改 runner 去忽略 pending，也没有把 `ok:false` 改写成 `ok:true`；如需让目录组合租约审计全绿，应由主控决定新的验证工具/清理契约，而不是放宽本轮审计或删断言。

## 维护复核、限制与请求动作

已读 AGENTS、工程经验、维护规范；新增经验记录“维护共享 fence 会使独立任务饥饿”、旧 minute fixture 未覆盖及真实 OS sweep/fake time 关系，回归入口为 `engines.test.ts` 与 `engines-maintenance.test.ts`。

范围仅 Chrome engine 维护调度与测试隔离；无依赖、安装脚本、网络目的地、凭证、版本、workflow 或发布变化。未发现本范围确认的恶意行为；不作整仓安全保证。

限制：目录套件不是全仓；真实 Chrome/CDP、Windows/Linux、真实模型/账号/Keychain、安装升级签名发布未验证；进程组确认限自有 fixture，不是脱组后代或外部副作用的绝对保证；目录租约审计的 pending file lease 仍需主控解释/后续工具修正。

请求主控：独立复审最终 tree、本源码修复及测试隔离；确认目录 `933 pass/0 fail/111 skip` 与辅助租约审计 1 的准确含义后，再串行集成并冻结新最终 HEAD 跑全仓。保留旧 full run、f00/e5 证据及所有旧失败记录，不以本次局部结果追认。通知通过已授权 OpenCode CLI 单次发送，不轮询其他会话。

最终包含交接文档的 HEAD/tree 以 `delivery.json` 的 `finalHead` / `finalTree` 为准；源码 tree 为 `7ec1bbba335b1fba60007060fe87fe7ff91ce884`。
