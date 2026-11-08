# 本地验证回执 run / verify

入口：`python3 -B scripts/verification-receipt/cli.py`。Python标准库＋支持原生TypeScript的Node；复用 `GateCommandRunner` 的POSIX超时/取消/进程组退出确认，不安装依赖。默认不运行任何命令，必须选择注册检查。

```sh
python3 -B scripts/verification-receipt/cli.py run \
  --root "$PWD" --check release-signing-unit --out /absolute/external/evidence
python3 -B scripts/verification-receipt/cli.py verify \
  --root "$PWD" --receipt /absolute/external/evidence/<runId>/receipt.json
```

`run`返回独立run目录与状态，非passed退出1；`verify`不执行检查，只重算并输出 `executionValid/sourceMatches/artifactsValid/limitations/accepted`，拒绝退出1。stderr/stdout原样保存，不打印模型密钥或全量环境；检查必须是已审查、不接触真实用户数据的命令。自定义 `--registry` 是本地可信执行定义，不是从外部回执授权执行命令。

## 来源与完整性

- 使用Git NUL列表选tracked及非ignored untracked；绑定规范路径、当前类型/执行位/内容SHA256。删除tracked显式标记；symlink绑定目标、不跟随；祖先目录变成symlink时不读链接外文件。合并冲突与特殊文件拒绝。
- 内容digest不含HEAD、dirty或tracked/untracked身份，允许验证已测试内容后再提交相同字节；HEAD/tree/dirty仍独立记录。版本/锁/测试配置只要在被选文件内就参与快照。
- 每次全量快照保守失配，不能根据“只改文档”自动复用；这会增加验收成本，第一版不做等价推断。
- 证据须在源码之外，或位于无tracked文件的gitignored目录；不stash、不改ignore、不排除任意源码。
- 命令前发布running回执，结束原子替换版本化JSON。UUID隔离新报告，不使用旧run文件。日志、结构化报告、执行结果分别绑定内容hash；校验当前工具/Node身份与检查定义/argv/cwd。
- 环境是PATH、LANG和本run合成HOME/USERPROFILE/TMPDIR、OMB_EVAL_LIVE=0、PYTHONDONTWRITEBYTECODE白名单；不继承NODE_OPTIONS、provider Key、用户配置或账号环境。PATH仅保证Node/Git等工具可解析，不承诺PATH目录外部依赖已绑定。

## 检查注册和报告

`checks.json`含schemaVersion及checkId；每check声明正整数version、argv数组、cwd、正timeoutSeconds、adapter和显式allowSkipped/allowTodo。定义整体hash，变动需要新证据。默认只注册既有 `scripts/release-signing.node-test.mjs` 的轻量单元检查，不构建、不调用真实签名/Keychain。

- `counts-json`：必需独立报告，字段total/passed/failed/skipped/todo精确且非负整数，计数一致且非空，严格默认skip/todo为0。
- `node-junit`：Node原生JUnit结构化报告，逐testcase检查failure/error/skipped；以Node的 `skipped type="todo"` 分离待办，skip/todo策略独立。声明的suite/root总数与失败/跳过数、Node原生summary注释均须与实际testcase一致，矛盾或重复计数拒绝；严格默认跳过/todo为0。
- `exit`：显式无测试报告型检查（如lint/typecheck），仅退出及生命周期结果；counts为null。不得用它替代需要结构化报告的测试检查。

工具不把日志解析失败视作0失败，不解析所有工具通用正则。bridge只从已知GateCommandError元数据格式提取退出码/信号，不用它判断测试计数。

JSON输入（receipt、registry、counts与执行结果）通过共享loader非阻塞且不跟随叶symlink地打开，在fd上确认普通文件，拒绝目录/FIFO等类型；实际读取最多16MiB+1字节，超限拒绝，即使元数据低报也不能绕过。旧版只stat size后read_text会在无writer FIFO阻塞，原17项和96次比较不覆盖此场景；V1-R2新增公共CLI反例。该限制不等同远程/故障文件系统的内核操作墙钟截止；不支持所需POSIX flags时拒绝。

## 状态与限制

状态：running/passed/failed/timed_out/cancelled/invalidated/error。运行前后源码变化不得passed；命令成功但必需报告缺失/损坏为error；源码、定义、工具、运行时、日志或报告事后变化时verify拒绝。父进程被SIGKILL、异常崩溃或写盘失败可能留下running/不完整回执，不能接受。

本地JSON+hash可由同权限操作者重写，不是认证、恶意篡改防护或F2可信发布producer。前后快照无法发现中间修改后恢复；使用独占worktree降低风险。Gitignored依赖和用户数据不进入快照，Node二进制单独绑定，不证明整个OS/toolchain一致。合成HOME与假模型不是OS沙箱或网络封锁。

资源证据只涵盖既有runner登记的自有POSIX进程组；主动脱组后代、引擎内部资源/跨平台Windows未证明。仅注册无内部长生命周期fixture的轻量检查；未来接服务/浏览器/eval时必须另接既有lease回执再审查，不从组消失推导全资源结束。临时HOME/日志保留在run目录供复核，不自动清理未确认资源。

## 回归

```sh
python3 -B scripts/verification-receipt/test_receipts.py
```

15类验收和2项审查回归通过同一CLI与临时Git仓库测试，不复制验收器。审查新增反例包括suite/root计数矛盾、Node summary不完整，以及原生TODO在skip允许时仍必须按独立策略拒绝。真实项目接入与独立审查结果见外层 `docs/execution/V1-verification-receipts.md`。来源绑定规范和既有runner限制仍见MAINTENANCE/AGENT_LESSONS；旧B1/F1证据不追认成本工具产生。
