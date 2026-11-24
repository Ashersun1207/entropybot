# Entropybot iPhone 自用原型

连接你自己的 Mac 或服务器工作区，在手机上查看既有 Bot 和历史对话，继续聊天。

## 现状

- 最小原生 SwiftUI 客户端：扫码/粘贴配对、Bot 列表、分页历史、发送消息、SSE 实时更新。
- 复用上游 `CompanionCore`（Apache-2.0，本目录保留 LICENSE 与 NOTICE），按 Entropybot 协议适配。
- 未含 Live Call、分享扩展、小组件、推送、WebRTC。
- 只用于个人自装；真机需 Apple Personal Team 免费签名，描述文件 7 天有效。

## 生成工程

XcodeGen（仅开发工具，不进手机包）：

```sh
xcodegen generate --spec native/iphone/project.yml
open native/iphone/EntropybotPhone.xcodeproj
```

`EntropybotPhone.xcodeproj` 由 XcodeGen 生成，已被 gitignore。

## 真机运行

1. Xcode → Settings → Accounts 登录你的 Apple 账户（免费）。
2. 目标选你的 iPhone，Team 选 Personal Team。
3. iPhone「设置 → 隐私与安全性 → 开发者模式」开启并重启设备。
4. 运行。在 Mac 的 Entropybot「远程访问」生成手机二维码，用本 App 扫描。

## 验证

- 模拟器构建：`xcodebuild -scheme EntropybotPhone -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`
- 模拟器配对：用隔离工作区生成 `http://127.0.0.1:<port>/pair#code=…`，`SIMCTL_CHILD_PAIR_LINK=… simctl launch`。
