import Foundation
import Security

// Security.framework's private keychain API accepts an explicit file and never needs the user's search list.
let args = CommandLine.arguments
func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}
func require(_ status: OSStatus, _ operation: String) {
    if status != errSecSuccess {
        emit(["operation": operation, "status": status])
        exit(1)
    }
}
guard args.count == 3, ["seed", "read", "lock"].contains(args[1]),
      args[2].hasPrefix("/private/var/folders/"), args[2].hasSuffix("/fixture.keychain") else {
    emit(["error": "Expected seed/read/lock and an absolute disposable fixture.keychain path"])
    exit(2)
}
require(SecKeychainSetUserInteractionAllowed(false), "disable interaction")
let password = "synthetic-disposable-keychain-password"
let oldSecret = "synthetic-old-service-password"
let newSecret = "synthetic-new-service-password"
var keychain: SecKeychain?
if args[1] == "seed" {
    require(password.withCString { SecKeychainCreate(args[2], UInt32(password.utf8.count), $0, false, nil, &keychain) }, "create fixture")
} else {
    require(SecKeychainOpen(args[2], &keychain), "open fixture")
}
guard let keychain else { exit(1) }
if args[1] == "lock" {
    require(SecKeychainLock(keychain), "lock fixture")
    emit(["locked": true])
    exit(0)
}
if args[1] == "seed" {
    for (service, account, secret) in [("fixture-old Safe Storage", "fixture-old Key", oldSecret), ("fixture-new Safe Storage", "fixture-new Key", newSecret)] {
        let status = service.withCString { servicePtr in
            account.withCString { accountPtr in
                secret.withCString { secretPtr in
                    SecKeychainAddGenericPassword(keychain, UInt32(service.utf8.count), servicePtr, UInt32(account.utf8.count), accountPtr, UInt32(secret.utf8.count), secretPtr, nil)
                }
            }
        }
        require(status, "add synthetic item")
    }
}
func read(_ service: String, _ account: String, _ expected: String) -> [String: Any] {
    var length: UInt32 = 0
    var bytes: UnsafeMutableRawPointer?
    let status = service.withCString { servicePtr in
        account.withCString { accountPtr in
            SecKeychainFindGenericPassword(keychain, UInt32(service.utf8.count), servicePtr, UInt32(account.utf8.count), accountPtr, &length, &bytes, nil)
        }
    }
    defer { if let bytes { SecKeychainItemFreeContent(nil, bytes) } }
    let matches = status == errSecSuccess && bytes.map { Data(bytes: $0, count: Int(length)) == Data(expected.utf8) } == true
    return ["status": status, "matchesSyntheticValue": matches]
}
emit([
    "old": read("fixture-old Safe Storage", "fixture-old Key", oldSecret),
    "new": read("fixture-new Safe Storage", "fixture-new Key", newSecret),
    "missing": read("fixture-missing Safe Storage", "fixture-missing Key", "")
])
