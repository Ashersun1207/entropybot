# 旧 Keychain 名称凭证迁移

适用 macOS 打包桌面。品牌从 `openmausbot` 改为 `entropybot` 后，Electron 的 Safe Storage 服务名随应用名改变，但 profile 仍是 `openmausbot`；旧 `credentials.bin` 由旧名称下的密钥加密，新名称读取会失败。此迁移在旧库可读时保留全部已保存凭证，而不是用明文配置重建。

证据与隔离复现见 [Keychain 隔离诊断](keychain-isolated-diagnosis.md) 和 `gorkbot/docs/release-0.2.4-validation.md`。

## 行为

1. 正常读取 `credentials.bin` 失败、文件存在、平台为 macOS 且为打包应用时，读取一次性标记 `credential-namespace-migration.json`。
2. 同一文件字节的失败尝试不自动重试，避免每次启动都弹钥匙串授权；文件变化后才重新尝试。成功标记同时记录迁移前字节和迁移后新库的 SHA256：新库本身不可读时不再用旧名读取；恢复旧备份导致旧字节重新出现时允许再迁移一次。
3. 子进程使用同一可执行文件，启动参数为 `--entropybot-legacy-credential-read`。它在 `ready` 前设置 `app.setName("openmausbot")`，因此 Electron 查询 `openmausbot Safe Storage` / `openmausbot Key`，与旧条目一致。子进程使用临时 userData，跳过单实例锁，不启动窗口或服务。
4. 子进程把凭证 JSON 以 `ENTROPYBOT_LEGACY_CREDENTIAL_RESULT <base64>` 输出到管道，父进程校验大小、base64、JSON 对象类型和危险键。
5. 父进程先把旧文件备份为 `credentials.bin.legacy-<sha256前12位>.bak`，再用当前密钥加密写入临时文件，回读并逐字段比较，通过后才原子替换。失败时恢复旧字节。
6. 成功后写入 `migrated` 标记；之后的明文配置迁移沿用既有流程，把 `memoryEmbeddingKey` 迁入新库并移除明文。

## 失败语义

- 钥匙串授权被拒、超时（120 秒）、子进程异常、输出无效：旧 `credentials.bin`、旧备份和 `config.json` 明文都不变；记录 `failed` 标记，本次启动按“凭证库不可读”继续，禁止保存新凭证。
- 超时或输出超限先 `SIGTERM`，5 秒后 `SIGKILL`；只有确认子进程退出后才删除临时 profile。15 秒仍无法确认时返回失败并保留该 profile，避免删除仍在写入的目录。启动临时目录或 spawn 同步失败按同一失败路径返回，不逃逸为启动崩溃。
- 加密、回读校验或原子替换失败：恢复旧字节；失败标记尽力写入，写入失败不掩盖原始错误。
- 替换成功但标记写入失败：仍按迁移成功返回，避免把有效新库误判为不可读。
- 备份已存在时不覆盖，保留第一次迁移前的原文件。

## 隔离验证

```sh
node node_modules/vitest/vitest.mjs run \
  electron/credential-namespace-migration.test.mjs \
  electron/credential-namespace-migration-runner.test.mjs \
  electron/secure-credential-io.test.mjs \
  electron/memory-credentials.test.mjs \
  electron/secure-credential-state.test.mjs \
  electron/workspace-credentials.test.mjs \
  --root . --configLoader native
python3 scripts/testing/legacy-credential-read.e2e.py
pnpm typecheck
pnpm lint
```

`credential-namespace-migration.test.mjs` 覆盖成功、回读不一致、加密失败、文件在决定后变化、备份不覆盖、标记写入失败、危险/超大/畸形输出和失败信息不含凭证值。Electron e2e 使用 `--use-mock-keychain` 与合成 JSON，验证子进程退出码、结果帧、stderr 不出现合成秘密，以及损坏密文返回非零且无结果帧。

## 真实平台验收（2026-11-07）

在用户明确同意下，本机从 0.2.4 升级到 0.2.5 并执行一次真实迁移；未删除旧库、旧 Keychain 条目或明文配置备份。

- 首次启动弹出两次系统钥匙串授权（当前新条目、旧名称条目），用户选择“始终允许”后继续；此前选择“允许一次”会在下次启动再次询问。
- 日志：`credential store may use the pre-rename keychain entry...` → `credential store migrated to the current keychain entry (4 saved item(s))`。
- 旧库备份：`credentials.bin.legacy-ac60d0f67fa8.bak`，595 字节，SHA256 `ac60d0f6…77d14`；迁移后新库 643 字节，标记 `migrated`。
- 明文配置迁移完成：`/api/config` 的 `memoryEmbedding.storage` 从 `plaintext` 变为 `secure`，`config.json` 中不再有明文 `key`。
- 数据只读计数保持 436 条消息、13 个记忆文件、9 个向量。
- 新条目 ACL 已写入当前 0.2.5 cdhash；随后一次完整退出/启动不再弹出授权框，`storage` 仍为 `secure`。

未验证：拒绝授权后的再次启动、锁定钥匙串、回退到旧版本后读取新库、真实模型/网络调用、Developer ID 公证。ad-hoc 构建每次重建 cdhash 会变化，仍可能触发新的钥匙串授权；发布前若要避免升级弹框，需要稳定签名身份。

## 尚未验证

- 真实 macOS 钥匙串拒绝/锁定路径；真实安装升级后的失败重试与回滚演练。
- 真实模型/网络调用、Developer ID/公证；非 macOS 平台不走此迁移。
- ad-hoc 重建后的签名变化与钥匙串授权复用；本次只验证了同一构建的重启。

真实迁移属于用户数据操作，应在保留备份、明文配置和旧文件的前提下，经用户确认后执行；不得为测试删除真实凭证或清空 Keychain。
