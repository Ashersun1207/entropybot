import Foundation
import Security

/// Pairing tokens for the standalone app.
///
/// The upstream build shares tokens with a Share extension and home-screen
/// widgets through an App Group, which free Personal Team signing cannot
/// provision. This fork keeps only the app, so tokens stay in the app's
/// private keychain group: every operation omits `kSecAttrAccessGroup`.
enum OpenMausSharedKeychain {
    private static let service = "ai.cloudentropy.entropybot.companion.token"

    static func save(_ token: String, for connectionID: String) throws {
        try save(Data(token.utf8), for: connectionID, accessGroup: nil)
    }

    /// The stored token: nil only when there genuinely is not one.
    /// Locked or misconfigured keychains throw so callers never turn a
    /// temporary inability to read protected data into an accidental unpair.
    static func token(for connectionID: String) throws -> String? {
        try readToken(for: connectionID, accessGroup: nil)
    }

    @discardableResult
    static func remove(_ connectionID: String) -> Bool {
        remove(connectionID, accessGroup: nil)
    }

    /// No legacy shared-group item exists in this standalone fork.
    static func tokenMigratingLegacyItem(for connectionID: String) throws -> String? {
        try token(for: connectionID)
    }

    @discardableResult
    static func removeIncludingLegacyItem(_ connectionID: String) -> Bool {
        remove(connectionID)
    }

    private static func identity(for connectionID: String, accessGroup: String?) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: connectionID,
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        return query
    }

    private static func save(_ data: Data, for connectionID: String, accessGroup: String?) throws {
        let itemIdentity = identity(for: connectionID, accessGroup: accessGroup)
        var query = itemIdentity
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        // Add first, then atomically update a duplicate. Delete-then-add can
        // lose the working credential when the second operation is denied.
        var status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecDuplicateItem {
            status = SecItemUpdate(
                itemIdentity as CFDictionary,
                [
                    kSecValueData as String: data,
                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
                ] as CFDictionary
            )
            if status == errSecItemNotFound {
                status = SecItemAdd(query as CFDictionary, nil)
            }
        }
        guard status == errSecSuccess else {
            throw OpenMausSharedKeychainError.security(status)
        }
    }

    private static func readToken(for connectionID: String, accessGroup: String?) throws -> String? {
        var query = identity(for: connectionID, accessGroup: accessGroup)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw OpenMausSharedKeychainError.security(status)
        }
        guard let data = item as? Data,
              let token = String(data: data, encoding: .utf8) else {
            throw OpenMausSharedKeychainError.security(errSecDecode)
        }
        return token
    }

    private static func remove(_ connectionID: String, accessGroup: String?) -> Bool {
        let status = SecItemDelete(
            identity(for: connectionID, accessGroup: accessGroup) as CFDictionary
        )
        return status == errSecSuccess || status == errSecItemNotFound
    }
}

enum OpenMausSharedKeychainError: LocalizedError {
    case security(OSStatus)

    var errorDescription: String? {
        if case let .security(status) = self {
            let detail = SecCopyErrorMessageString(status, nil) as String? ?? "status \(status)"
            return "Couldn't access the pairing securely: \(detail)"
        }
        return "Couldn't access the pairing securely."
    }

    /// The keychain is unavailable *yet* rather than missing this token.
    var isLocked: Bool {
        if case let .security(status) = self {
            return status == errSecInteractionNotAllowed
        }
        return false
    }
}
