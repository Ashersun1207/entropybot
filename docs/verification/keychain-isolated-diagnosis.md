# macOS Keychain 隔离诊断：OPT-011

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

## 应用名选择探针（迁移设计依据）

`scripts/testing/keychain-service-probe.py` 用 `keychain-service-interpose.c` 拦截 Security.framework 的 Safe Storage 查找/创建：只记录服务名和账户名，查找返回 not found，创建被拒绝，因此不读取也不创建真实条目。运行时取自校验过的 Electron 缓存，复制后临时 ad-hoc 重签以允许注入，结束删除。

结果：

- 未设置应用名时查询 `Electron Safe Storage`；`app.setName("openmausbot")` 后查询 `openmausbot Safe Storage` / `openmausbot Key`；任意测试名同样生效。
- 即使查找返回 not found、创建被拒，`isAsyncEncryptionAvailable()` 仍返回 true。availability 只表示加密后端初始化，不证明指定密文可解密。
- 实验前后用户 Keychain 默认项和搜索列表不变，没有新增条目，临时目录已删除。

这证明迁移可以在 ready 前用子进程选择旧名称；不证明真实旧条目 ACL 会放行，后者由 0.2.5 本机真实迁移中的用户授权验证。

## 当前结论及后续

实验分别证明：密钥不匹配即使条目可读仍会失败；ad-hoc 身份变化也可以独立触发读取拒绝；通用 decrypt 错误加 availability=true 不能独自区分二者。真实环境的旧文件时间早于新名条目，且旧名条目仍存在，因此品牌更名导致密钥命名空间变化仍是最强线索，但未用真实密钥验证，不宣称已确认根因。

后续产品修复应先验证固定凭证身份与旧身份读取的迁移设计：旧库不可读不得覆盖；新库写入并确认可重读前不得清理旧文件或明文；失败应保留可重试状态。不能盲目将 app.name 改回旧名，也不能仅靠稳定签名就假定旧密文可恢复。本轮未实现迁移，不解除发布阻断。

维护/安全复核范围：三个 fixture 文件只运行系统编译器、codesign、openssl、显式合成 Keychain API 和 mock Electron；无网络调用、真实密码读取、安装钩子、权限扩张或产品接线。源码检查与原生/macOS 实验结果分别记录；未声称完整 Entropybot 安装迁移通过。

独立复核发现诊断夹具的最终偏好查询/断言失败会跳过清理、负例只断言非零不够精确，以及 mock 改名结果误称缓存机制。已修正清理顺序、双条目精确 `-25293` 断言和结果措辞。修正后原生全路径重跑通过；另注入最终偏好查询异常，确认临时目录仍删除、JSON 仍输出、失败仍传播。该异常是合成查询失败，不是实际偏好变化。

## 来源

- [Electron v43.7.9 DEPS](https://github.com/electron/electron/blob/v43.7.9/DEPS)
- [Electron restored sync backend](https://github.com/electron/electron/blob/v43.7.9/patches/chromium/revert_oscrypt_remove_sync_backend.patch)
- [Chromium 150 async keychain provider](https://github.com/chromium/chromium/blob/150.0.7871.250/components/os_crypt/async/browser/keychain_key_provider.mm)
- [Chromium 150 FakeKeychainV2](https://github.com/chromium/chromium/blob/150.0.7871.250/crypto/apple/fake_keychain_v2.mm)
- [Apple private-keychain search-list behavior](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_keychain/lib/StorageManager.cpp)
