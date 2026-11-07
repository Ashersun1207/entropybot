# 当前架构与边界

Entropybot 是本机优先的 TypeScript/React/Electron 应用。开发依赖 Node 24+ 与锁定的 pnpm；产品源码、外部引擎、模型服务与原生资源分别版本化。此页描述代码职责，不构成已安装或已发布状态；发布事实见主控交付记录。

| 层 | 入口与职责 | 必须保持的边界 |
|---|---|---|
| 界面 | `src/`：聊天、机器人、设置、记忆及任务展示；`src/state/store.tsx` 管理客户端状态 | UI 状态不替代后台任务结果；服务失败不能显示成功 |
| 桌面宿主 | `electron/main.mjs` 与 preload/IPC：窗口、系统能力、凭证与手动更新 | IPC 校验、凭证加密、bundle/profile 身份与已发行迁移契约不随品牌机械改写 |
| 本地服务 | `server/entropybot.ts` → `cli.ts`；`server/index.ts` 负责服务接线、API 与事件 | 按实际授权、bot/thread 与能力 scope 校验；loopback 本身不替代鉴权 |
| 回合与引擎 | `server/drivers/`：模型协议与 Claude/Codex/Pi/ACP 等引擎适配；host 控制派发与停止 | 保持流事件、工具调用、取消、错误与用量语义；不在 adapter 内再建主调度器 |
| 任务与自动化 | `server/runtime/runtime.ts`、`store.ts`：SQLite 任务树、事件与恢复；`server/routines.ts`：例行触发；saved steps：已记录步骤复用 | 任务身份、attempt/generation、权限与累计预算要明确；取消不等于外部副作用回滚，未知结果不能盲目重发 |
| 工具与 MCP | driver 的工具挂载/bridge、MCP 配置和 scope、审批及 ask_user | 协议客户端不等于宿主策略；复用连接必须匹配身份、凭证、工作区、版本与当前权限 |
| 记忆与数据 | Markdown 核心/主题记忆，SQLite 消息/索引、FTS、可选 embedding；`workspace.ts` 与 recall/upkeep 投影 | 原文、检索投影、模型提示、capture 输入分开；按来源/有效时间/修订过滤，凭证不落明文。云 embedding 会外发相关内容 |
| 可选能力 | 浏览器、电脑控制、DuckDB、语音、隧道与设备工具 | 进程、profile、权限、下载来源和关闭确认需有 owner；普通聊天不应隐式获得全部能力 |
| 验证与分发 | `scripts/check-patches.mjs --verify`、Vitest/Node suites、`evals/` 与自有 workflows | 合成/源码/平台/安装/发布证据分别记录；构建身份绑定真实提交与产物，不凭部分套件宣布发布 |

数据流：界面/CLI → API 与授权 → 本地任务/回合 → 引擎与受限工具 → 产物和持久记录 → 状态/事件回到界面。记忆按授权投影到回合，不成为第二套任务执行状态。

保持模块化单体；不因大文件行数直接拆成服务，不长期保留重复的浏览器 owner、agent loop、调度器或记忆真源。源码入口和调用关系是整理依据，行数只是职责集中线索。

测量分别报告：冷/热启动到可输入/发送、本地准备与模型网络等待、进程树 RSS/CPU、工具初始化/关闭、端到端任务成功率和人工补救、已知/未知费用。文件逻辑字节不是安装压缩大小或常驻内存；假模型结果不证明真实模型质量。

开发前读 [工程经验](AGENT_LESSONS.md)，验证遵循 [隔离规范](../verification/README.md)，门槛与收口遵循 [维护规范](MAINTENANCE.md)，技术替换遵循 [演进规则](TECH_EVOLUTION.md)。
