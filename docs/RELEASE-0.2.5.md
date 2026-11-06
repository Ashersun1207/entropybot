# Entropybot 0.2.5

日期：2026-11-07。状态：本机安装并完成真实凭证迁移；未推送、未创建 tag、未公开发布。

## 修复

- macOS 品牌更名（`openmausbot` → `entropybot`）后，Safe Storage 密钥名称随应用名变化，旧 `credentials.bin` 无法用新密钥解密。
- 新增一次性旧名迁移：独立子进程在 ready 前设旧应用名读取旧库；父进程备份、用当前密钥重写、回读校验、原子替换。失败保留旧库和明文，不覆盖。
- 凭证读写集中到 `secure-credential-io.mjs`；`main.mjs` 体积不增（3215 行，预算 3245）。
- 标记记录迁移前后 hash；失败不反复弹授权；恢复旧备份可再次迁移；取消先 TERM→KILL，未确认退出不删临时 profile。

## 真实验收

- 从 0.2.4 升级安装 0.2.5；首次启动在用户授权后迁移 4 项凭证。
- `memoryEmbedding.storage` 由 `plaintext` 变为 `secure`，明文 Key 已移除。
- 旧库备份 595 字节保留；新库 643 字节；数据 436 条消息/13 个记忆文件/9 个向量不变。
- 同一构建重启不再弹钥匙串授权，`storage` 仍为 `secure`。

## 未验证

- 钥匙串拒绝/锁定、失败重试、回退旧版本、真实模型调用、Developer ID/公证、Windows/Linux。
- ad-hoc 重建会改变 cdhash，可能再次要求钥匙串授权；稳定签名仍未配置。

## 隔离门槛

- 64 项相关 Vitest、类型检查、lint、体积守卫通过。
- 打包服务冒烟 13 项通过；mock Electron 子进程读写与损坏密文失败路径通过。
- 基线 `8138dca42`，实现提交见本文件所在提交；`main.mjs` 3215 行。
