import Foundation
import Security

enum KeychainToken {
    private static let service = "ai.cloudentropy.entropybot.phone"

    static func save(_ token: String, for connectionID: String) throws {
        #if targetEnvironment(simulator)
        UserDefaults.standard.set(token, forKey: "dev." + connectionID)
        return
        #endif
        let data = Data(token.utf8)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: connectionID]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        if status != errSecSuccess { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }

    static func read(for connectionID: String) -> String? {
        #if targetEnvironment(simulator)
        return UserDefaults.standard.string(forKey: "dev." + connectionID)
        #endif
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: connectionID, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func remove(for connectionID: String) {
        #if targetEnvironment(simulator)
        UserDefaults.standard.removeObject(forKey: "dev." + connectionID)
        return
        #endif
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: connectionID]
        SecItemDelete(query as CFDictionary)
    }
}
