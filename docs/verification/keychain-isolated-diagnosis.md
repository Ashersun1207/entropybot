# macOS Keychain 诊断与证据边界：OPT-011

日期：2026-11-07。基线 `8138dca42`，负责人：当前主控诊断会话；工作分支 `codex/keychain-isolated-diagnosis`。仅增加诊断 fixture 和经验，不改产品，不构建或安装 Entropybot，不迁移真实凭证。

## 两类实验与证据边界

原生实验使用 Security.framework 对独立 `fixture.keychain` 的显式句柄读写合成密码，禁用用户交互。每次查询均指定该句柄；不调用设置默认 Keychain、搜索列表、解锁真实 Keychain 或读取真实密码的 API。Apple Security `StorageManager.cpp` 的 `shouldAddToSearchList` 对普通私有文件不自动添加搜索列表；本机实验前后另外比较 user domain 的默认条目与搜索列表，均未变化。

```sh
python3 scripts/testing/keychain-isolation-probe.py
```

该探针目前为本机诊断脚本，临时目录固定为本会话获准访问的 `/private/var/folders/3_/4wcgrlpj1cx98_dychpdms240000gn/T/opencode`，不是跨机器 CI 门槛。它编译本仓库 Swift fixture，签名仅作用于临时可执行文件，合成密码仅写入临时 Keychain。实验结束删除本次临时目录。结果：

| 场景 | 结果 |
|---|---|
| 创建两个服务名下的合成密码 | 均可读；缺失服务返回 `-25300` |
| 相同签名、新进程重读 | 两个密码均匹配 |
| 两个密码均可读，分别解同一 v10 合成密文 | 原密码成功，另一密码失败，原密文未改 |
| 同一路径改 ad-hoc 签名 identity 后读取 | 两个条目均返回 `-25293`，未弹授权框 |
| 恢复原签名可执行文件 | 两个条目恢复可读 |
| 锁定本次临时 Keychain 后读取 | `-25293` |
| 环境及清理 | user default/search list 未变；临时目录已删除 |

原生实验的密码派生与 CBC 调用只验证机制；它不证明 Electron 实际选择了哪个服务名，也不证明某个真实文件由特定密码加密。

第二类实验实际运行 Electron `43.7.9`，使用命令行 `--use-mock-keychain`。Electron DEPS 固定 Chromium `150.0.7871.250`；该版本异步 provider 和 Electron 恢复的同步 backend 均支持 mock switch，假密码固定为 `mock_password`。不替换真实 Keychain，不修改 Electron 依赖安装目录。

本机开发依赖缺少 `dist` 运行时，首次启动报 FileNotFoundError；随后使用已有缓存 `electron-v43.7.9-darwin-arm64.zip`，解压前与依赖中的 checksums.json 比较 SHA256：`dcf13726bbf45646c968bb67f48d24ecfb941af1b3c01217f84edaf50fee632a`。未运行依赖安装脚本或下载新运行时。

在获准临时目录中创建 `safe-storage-mock-*` 根目录及 `profile`、`session`、`logs`、`home` 子目录，解压运行时后，以隔离 HOME 启动：

```sh
ENTROPYBOT_KEYCHAIN_FIXTURE="$fixture_root" HOME="$fixture_root/home" \
  "$fixture_root/runtime/Electron.app/Contents/MacOS/Electron" \
  --use-mock-keychain scripts/testing/safe-storage-mock-probe.mjs
```

实际本轮由 Python supervisor 启动，限制子进程环境，设置 20 秒超时，比较实验前后 user default/search list，退出后删除本次目录。该命令中的 fixture_root 是新建的临时目录，不是真实 profile。

| Electron 43.7.9 场景 | 结果 |
|---|---|
| `isAsyncEncryptionAvailable()` | true |
| `mock_password` 派生的合成 v10 密文 | 异步解密得到预期合成 JSON |
| 另一合成密码派生的 v10 密文 | `Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.` |
| async 加密→async 解密 | 成功 |
| sync 加密→async 解密 | 成功，排除这组 fixture 中仅换 API 就必然失败的假设 |
| 初始化后 `app.setName` 再读旧密文 | 成功；只说明该初始化 mock 进程内改名后仍可解密，不能区分缓存与重新取得相同假密码 |
| 环境及清理 | user default/search list 未变；临时目录已删除 |

mock 不检验真实服务查找或 ACL；进程内初始化后改名，也不能代替更名后冷启动。因此不把最后一行当成品牌更名无影响的证据。

## 测试夹具故障与修正

第一次 Electron fixture 在 ES module 顶层 `await app.whenReady()`，40 秒超时。移除顶层等待、改成 `app.whenReady().then(...)` 后同一二进制与探针通过；符合 Electron ESM 加载等待 ready 的死锁模式。失败进程已退出，未遗留测试进程，搜索列表未变。超时结果不能算产品解密失败，也不能算验收通过。

## 应用名选择探针（证据已撤回，入口停用）

2026-11-07 独立只读审查 C 指出，`keychain-service-interpose.c` 的选择性 hook 不能保证不访问真实 Keychain，并且有长度字符串越界读取风险。`scripts/testing/keychain-service-probe.py` 已替换为无条件非零退出的停用入口，在任何运行时、编译器、文件解压、子进程或 Keychain 操作前拒绝执行；没有开关可绕过。C interposer 与 Electron JS 探针已删除，原始源码保留在 Git 历史中。本次更正未运行该探针。

撤回旧记录中“因此不读取也不创建真实条目”及“服务名三组通过”的结论。旧文曾记录默认服务名、`openmausbot` 服务名和任意测试服务名，以及 `available=true`；这些仅为未经完整验收的历史观察，不能当作三组成功、绝对隔离或迁移设计已验证的证据。默认 Keychain 和搜索列表不变也不能证明没有读取或写入条目；“没有新增条目”缺少覆盖全部 API 的证据，同样撤回。

任何后续服务名研究只能在没有真实凭证的一次性 macOS 用户账户或 VM 中重新设计验证；不得恢复选择性 hook 后在用户账户绕过停用入口。上述显式私有 Keychain 原生实验和 `--use-mock-keychain` 实验的证据独立保留，各自边界不由本探针补强，也不因本探针的撤回而合并为失败。

## 当前结论及后续

显式私有 Keychain 的合成实验表明：密钥不匹配即使条目可读仍会解密失败；ad-hoc 身份变化也可以独立触发读取拒绝。mock 实验的 availability 与解密结果不能判定真实 ACL 或真实密钥来源。服务名探针不再支持任何验收结论。旧记录关于真实环境文件时间与服务名的线索不是本次新增或重新核实的证据；本次未读取真实凭证，不据此宣称已确认根因。

产品迁移仍应独立验证：旧库不可读不得覆盖；新库写入并确认可重读前不得清理旧文件或明文；失败应保留可重试状态。不能仅靠改 app.name、availability 或稳定签名就假定旧密文可恢复。此诊断记录不替代 0.2.5 迁移回归、用户授权或发布验收，不解除发布阻断。

原生和 mock fixture 的既有复核记录独立保留：最终偏好查询/断言失败曾跳过清理、负例只断言非零不够精确、mock 改名结果曾误称缓存机制。既有修正包括清理顺序、双条目精确 `-25293` 断言和结果措辞；旧记录的原生全路径重跑及合成最终查询异常探针均不作为服务名 interposer 通过证据。本次不重跑这些平台实验。

## 附录：撤回依据与历史失败

源码基准为 `2905edd583cc18f47ed5bab99ad0f24fddcd9e6f`（本次停用前）；可用 `git show <基准>:scripts/testing/<文件名>` 只读检查，不能据此恢复执行。

| 文件及原位置 | 源码事实 / 失败 | 影响与限制 |
|---|---|---|
| `keychain-service-interpose.c:38–87` | 仅 interpose `SecKeychainFindGenericPassword`、`SecKeychainAddGenericPassword`、`SecItemCopyMatching`、`SecItemAdd`；服务名包含 `Safe Storage` 才拒绝，其他分支经 `dlsym(RTLD_NEXT, ...)` 调用真实 API | 无 service、其他服务及未覆盖的 API 仍可能访问真实 Keychain；HOME/profile 临时化与偏好未变不能封闭该边界。未证明发生真实访问，也不能保证未发生 |
| `keychain-service-interpose.c:19–20,38–49` | `is_safe_storage` 用 `strstr` 读取 `const char *service`，legacy API 同时提供 `service_len`，不保证 NUL 终止 | 忽略长度可能越界读取；日志中的 `%.*s` 不修复此前的 `strstr`。本次删除而不继续运行/修补该隔离方案 |
| `keychain-service-probe.py:49–68` | 每组读取结果后先要求 `result['available'] is False`，再记录三组服务名、设置 `passed=True`；旧文却记录 `available=true` | true 与已提交断言相矛盾；对应执行应在三组验收完成前触发 AssertionError。缺少一致的完整成功记录，因此不报告三组通过，也不将此前失败改写为成功 |
| `keychain-service-probe.mjs:12–27` | 调用真实 Electron safeStorage availability 并写入结果；本身没有显式私有 Keychain 句柄 | 依赖不完整的 interposer，不能从 JS 的临时目录证明后端隔离；该入口已删除 |

以上来自源码和已有记录的矛盾核实，不是重新执行的结果，也不是已确认真实凭证读取或恶意行为的定性。原始失败、早期顶层 await 超时和各实验限制均保留，不以本次停用掩盖旧失败。

## 来源

- [Electron v43.7.9 DEPS](https://github.com/electron/electron/blob/v43.7.9/DEPS)
- [Electron restored sync backend](https://github.com/electron/electron/blob/v43.7.9/patches/chromium/revert_oscrypt_remove_sync_backend.patch)
- [Chromium 150 async keychain provider](https://github.com/chromium/chromium/blob/150.0.7871.250/components/os_crypt/async/browser/keychain_key_provider.mm)
- [Chromium 150 FakeKeychainV2](https://github.com/chromium/chromium/blob/150.0.7871.250/crypto/apple/fake_keychain_v2.mm)
- [Apple private-keychain search-list behavior](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_keychain/lib/StorageManager.cpp)
