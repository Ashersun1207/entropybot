// swift-tools-version: 5.9
import PackageDescription

// Vendored binary of Google's WebRTC (BSD), pinned at M153.0.0. Xcode 27's
// SPM drops the Info.plist when extracting this package's remote binary
// artifact, so the XCFramework is kept locally instead.
let package = Package(
    name: "WebRTC",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "WebRTC", targets: ["WebRTC"])],
    targets: [.binaryTarget(name: "WebRTC", path: "WebRTC.xcframework")]
)
