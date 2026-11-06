# macOS 正式签名与发布追溯准备

状态：仅源码准备。用户尚未开通 Apple Developer Program；本轮没有签名身份，没有创建/导入证书、修改 Keychain、运行真实打包、公证提交、安装或发布。本入口只处理 macOS arm64，保持现有本地 ad-hoc 入口不变。

## 两个入口与授权边界

- 原有 `pnpm package:entropybot:mac` 仍读 `electron-builder.yml`，使用 ad-hoc，`--publish never`。`node scripts/entropybot-release.mjs check|manifest` 仍供本地手动更新模式使用。
- 正式入口为 `node scripts/release-signing.mjs preflight|build|finalize`。它不创建 tag、不上传、不自动发布、不创建/导入证书、不提交公证、不保存公证密码。`build` 会运行原有构建准备脚本，其中包括按固定来源获取原生资源；仅在用户以后明确启动正式构建时发生。
- 配置缺失或身份/团队格式错误时，任何外部命令之前失败；证书导入变量 `CSC_LINK`、`CSC_INSTALLER_LINK` 存在时拒绝。配置有效后只查询现有代码签名身份，找不到精确 Developer ID Application 身份便停止，不能回退 ad-hoc。
- 没有自动 CI/release 接线。本流程目前是独立的手动准备入口，不应把已有 ad-hoc release workflow 称为正式签名发布流程。

## 最少的账号材料

以后由用户自己的有效 Apple Developer Program 团队提供：Team ID、该团队的 Developer ID Application 签名身份及匹配私钥，以及可用于公证的认证。当前不要向对话发送任何私钥、密码或 token。

签名身份由用户在受控环境中预先配置；此脚本只消费已有身份。公证认证可选 API key（私钥、Key ID，团队 key 对应 Issuer ID），或 Apple ID + App 专用密码 + Team ID。用户另行安全配置一个现有 notarytool Keychain profile，本入口仅接收 profile 名称，不读取其内容。

以下变量都是名称或公开身份元数据，不是私钥：

```text
ENTROPYBOT_SIGNING_IDENTITY=Developer ID Application: <account name> (<TEAMID>)
ENTROPYBOT_SIGNING_TEAM=<10-character TEAMID>
ENTROPYBOT_NOTARY_PROFILE=<existing-notarytool-profile-name>
```

离线 preflight 只能确认 profile 名称已配置，不能在不使用认证/联网的情况下证明该 profile 存在、权限有效或会员状态正常。这里没有这种证明；后续由人工提交公证与最终票据验证补足。

## 已提交版本之后构建

在独立 checkout 中安装已固定依赖，使用项目要求的 Node 24。先提交版本与全部源码；`git status --porcelain --untracked-files=all` 必须为空。`release/` 必须不存在或为空，脚本不会自动删除旧产物。

```sh
node scripts/release-signing.mjs preflight
node scripts/release-signing.mjs build
```

build 在构建前写入 `release/entropybot-build-record.json`：实际 `sourceCommit`、`sourceTree`、版本、lockfile SHA256、时间和 Node/平台/架构。生成的 `release/official-builder.json` 继承原配置，显式覆盖 Developer ID 身份、`forceCodeSigning: true`、hardened runtime；关闭 builder 内部公证并固定 `--publish never`。构建后再次检查源码清洁和 SHA/tree/lock 一致，验证 App，再记录构建时 DMG/ZIP hash；失败记录停留在 `building`，不能进入 finalize。

签名门槛要求：实际 bundle ID 为 `ai.entropybot.desktop`，版本匹配；`codesign --verify --deep --strict` 成功；实际 Authority 与 TeamIdentifier 精确匹配，具有 hardened runtime、secure Timestamp 和 CDHash。遍历 bundle 内真实文件的 Mach-O magic，逐项验证同一团队身份、runtime 和时间戳，包括原生模块及 helper；这可能暴露现有第三方 payload 的签名不兼容，必须按具体失败处理，不削弱门槛。

当前继承的 entitlements 尚未收紧，尤其 DYLD 环境变量和 library validation 例外需要在真实平台逐项验证必要性。本轮没有扩大它们，也没有声称正式 hardened runtime 配置已经平台验收。

## 人工公证之后再 finalize

这部分是未来获授权后的操作说明，本轮没有执行。用户在受控环境中使用既有 profile，将 build 生成的 ZIP 与 DMG 分别提交 `xcrun notarytool submit ... --keychain-profile ... --wait`，保留脱敏请求 ID/Accepted 记录。失败或拒绝时停止；不得继续制作正式清单。

Accepted 后分别向未压缩 App 和 DMG `xcrun stapler staple ...`。ZIP 不支持直接 staple；核对 build record 中旧 ZIP 的名称/hash，然后由操作者移走旧 ZIP，保留 build record。不要重签 App、替换 payload 或修改源码。

```sh
node scripts/release-signing.mjs finalize
```

finalize 要求同一干净源码、版本、lock、身份配置和成功 build record；重新验证签名并比对构建时 App CDHash。它将 DMG **只读挂载**至本次新建的 `release/dmg-check-*` 目录，对其中 App 执行相同签名和版本门槛、比对 CDHash，并在 finally 中卸载；卸载失败即停止并保留挂载点，不强制清理。它不启动挂载镜像内的应用或可执行文件。

App、DMG 都须通过 `stapler validate`，并通过对应的 `spctl --assess`。任何命令非零退出即停止。旧 ZIP 必须不存在，才由 ditto 从已验证、已 staple 的 App 新建 ZIP。最后再次核对源码，并对**最终字节**生成 `SHA256SUMS` 和 `entropybot-build.json`。manifest 分别记录 `sourceCommit` 与 `manifestGeneratedHead`、build record hash、真实签名元数据与最终 DMG/ZIP hash。该准备流程要求最终仍在同一 source HEAD，因此两字段通常相等，但意义不同。

公证/签名工具可能访问 Apple 服务，尤其 Gatekeeper 评估；仅应在今后用户授权的正式验收中运行。脚本不改变系统评估开关、默认 Keychain 或搜索列表。所有系统工具从 PATH/系统路径解析，操作者必须使用受控构建机与 PATH。

## 旧产物与证据限制

本地兼容 `manifest` 不再硬编码“ad-hoc，未公证”，也不再把运行时 HEAD 当作构建源码：`commit`/`sourceCommit` 为 null，`sourceStatus` 为 `unverified-source`，单独写 `manifestGeneratedHead`。能够检查本地解包 App 时，仅记录该 App 观察到的签名类别；没有验证 DMG/ZIP 与它一致，也不推断公证状态。存在正式 build record 时，本地 manifest 拒绝覆盖并要求走 finalize。

0.2.5 已有产物先构建、后提交版本/验收、再补诊断并重生成 manifest；原清单中的 `2905edd58` 是事后关联证据，不能证明来自该干净 checkout。旧备份未被本轮修改，不能仅靠重新生成清单追认真实构建 SHA。主控应在外层验收记录保留此限制。

build record 是本机可修改的审计记录，不是签名供应链证明，不能抵御同 UID 篡改记录/工具或构建期间修改后恢复源码；也不证明可重现构建。进程超时不保证所有构建后代已退出；失败后由操作者确认本次资源退出，再决定如何处理独立 checkout。DMG 挂载和真实 Apple 工具行为、所有 Mach-O 的实际签名兼容性、旧 ad-hoc 到 Developer ID 的 Keychain ACL 升级，以及公证/拒绝/回滚，仍待真实隔离平台验收。没有会员和证书时，不应启动这些路径。

## 本轮验证与来源

验证入口：`node --test scripts/release-signing.test.mjs`。测试使用临时 Git 仓库、合成 App/Mach-O/DMG/ZIP 与假命令；真实执行仅限本地 Git、Node 和本地兼容 manifest 对不存在 bundle 的签名查询。不执行构建、Keychain 故障、镜像挂载、公证或 Gatekeeper 操作。缺配置、错误身份/团队、脏源码、签名字段缺失、公证票据拒绝、旧 ZIP 未移走和最终 hash 关联均有负例或完整串联证据。

本路检查：Node `24.22.2` 的上述测试入口 11 项通过（无 skip/todo）；三个修改/新增脚本的 `oxlint --deny-warnings` 通过；本 worktree 的 `scripts/testing/file-size-ratchet.test.ts` 1 项通过，未提高预算。首次定向 lint 发现测试模板字符串中两个多余转义，已修正并重跑通过；不涉及产品行为失败。这些检查不等于全量应用回归。

原配置仍固定自有 GitHub 来源 `Ashersun1207/entropybot`、手动更新模式与 bundle ID；签名准备没有添加依赖、安装钩子、第三方代码或上传端点。配置字段依据本地 electron-builder schema；系统门槛依据 [Electron 签名说明](https://www.electronjs.org/docs/latest/tutorial/code-signing)、[Apple 公证工作流](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)。最终组合回归与真实进程退出状态由主控单独记录，本文不声称全量回归通过。
