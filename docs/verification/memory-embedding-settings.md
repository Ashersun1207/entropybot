# 语义记忆设置与安全凭证验收

设置 → 记忆：配置语义检索开关、完整 embeddings endpoint、模型、维度和超时；API Key 只经桌面凭证桥保存、替换或移除。测试连接发送固定合成文本，不读取记忆，也不衡量真实召回准确率。测试使用已保存的参数，修改后需先保存。

## 安全边界

打包桌面沿用 safeStorage 加密的 credentials.bin。在 macOS，Keychain 保护加密秘密，API Key 不作为独立 provider 条目直接保存在钥匙串。凭证库不可读时禁止覆盖；旧配置先成功保存加密凭证，再移除明文。

记忆凭证 slot 为 memoryEmbeddingKey，专属服务环境变量为 OMB_MEMORY_EMBEDDING_KEY。清除保存显式空值，禁止旧 DASHSCOPE_API_KEY 重新回落；不修改用户的父进程环境。非打包/dev 路径拒绝此 slot 的不安全保存。没有桌面安全桥的页面不能把 Key 退回 HTTP 明文配置。

配置状态仅返回 enabled/configured/storage/url/model/dimensions/timeoutMs。storage 区分 secure、plaintext、environment、unavailable、none。secure 才表示由桌面安全凭证库提供；迁移失败的明文、环境注入和不可读状态不能显示为钥匙串保护成功。

关闭语义检索保留本地 FTS/bigram。开启后相关记忆及查询会发送到配置服务，可能产生费用。endpoint、model、dimensions 共同定义向量索引身份；变化后旧索引不再复用。

## 隔离自动验证

先按 [验证总则](README.md) 使用 Node 24 和隔离 fixture。禁止修改真实配置、读取真实记忆、调用真实模型或用真实 Keychain 验收失败场景。

```sh
pnpm exec vitest run \
  electron/memory-credentials.test.mjs \
  electron/workspace-credentials.test.mjs \
  electron/secure-credential-state.test.mjs \
  server/memory-embedding-config.test.ts \
  server/memory-embedding-client.test.ts \
  server/memory-embedding-index.test.ts \
  server/memory-embedding-auth.test.ts \
  server/memory-embedding-settings.e2e.test.ts \
  server/memory-embeddings.test.ts \
  server/recall.test.ts \
  server/workspace-backup-policy.test.ts \
  src/components/MemorySettings.test.ts \
  src/components/SettingsModal.simple.test.ts \
  src/state/memory-status.test.ts
node --test electron/workspace-credentials-save.node-test.mjs electron/credential-patch.node-test.mjs
pnpm typecheck
```

Worktree 复用 node_modules 链接时，使用该 worktree 的 Node24 执行 `node node_modules/vitest/vitest.mjs run --root . --configLoader native`，再列出相同测试路径，避免 realpath 解析到其他 checkout。

服务 e2e 使用 launchVerificationServer 及共享 doctor 显式 URL，向一次性 loopback embedding provider 发送固定探针，覆盖配置保存、外置凭证更新与清除、错误脱敏；所有进程由 fixture 关闭。鉴权单测另覆盖桌面 token 与跨站请求，不能把普通 loopback fixture 成功当作完整打包桌面授权验收。

## 界面及平台验收

真实 React 组件测试覆盖安全桥、无桥拒绝、状态、参数与测试请求；Settings 导航测试确认入口可达。`src/testing/memory-settings-preview.tsx` 是合成协议预览，不能作为实际后端或真实 Keychain 的证据。

组合验收需分别记录后端真实 fixture、renderer 使用真实/合成协议的范围、测试路径与提交。真实 macOS Keychain 的锁定/拒绝、签名身份与重启后的解密，以及 packaged 安装升级，应在专门的可丢弃平台环境验证；mock 只证明事务控制流。未执行这些检查时明确标注，不能宣称平台验收已完成。

品牌更名后旧凭证库由旧 Keychain 名称加密时，打包桌面会尝试一次性读取旧名称并迁移，见 [旧 Keychain 名称凭证迁移](credential-namespace-migration.md)。迁移失败必须保留旧库与明文配置；不得用删除凭证库来“修复”。
