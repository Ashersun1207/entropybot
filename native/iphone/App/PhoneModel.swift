import CompanionCore
import Foundation

@MainActor
final class PhoneModel: ObservableObject {
    @Published private(set) var connection: Connection?
    @Published private(set) var state = CompanionState()
    @Published private(set) var connected = false
    @Published private(set) var loading = false
    @Published private(set) var pairing = false
    @Published var error: String?

    private var client: CompanionClient?
    private var stream: Task<Void, Never>?
    private var viewedThread: String?
    private let savedKey = "entropybot.phone.connection"
    private let network = URLSession(configuration: .ephemeral, delegate: RejectRedirects(), delegateQueue: nil)

    init() {
        if let data = UserDefaults.standard.data(forKey: savedKey),
           let saved = try? JSONDecoder().decode(Connection.self, from: data),
           let token = KeychainToken.read(for: saved.id) {
            connection = saved
            client = CompanionClient(connection: saved, token: token, session: network)
        }
    }

    var bots: [Bot] { state.bots.filter { $0.hidden != true } }
    var isPaired: Bool { client != nil }

    func pair(_ invite: PairingInvite) async {
        guard !pairing, !isPaired else { return }
        pairing = true
        error = nil
        defer { pairing = false }
        do {
            let result: (Connection, String)
            if invite.credential.count == 12 {
                let anonymous = CompanionClient(connection: invite.connection, token: nil, session: network)
                let environment = try await anonymous.environment()
                let answer = try await CompanionClient.pairWithServer(connection: invite.connection, code: invite.credential, label: "Entropybot iPhone", session: network)
                let paired = CompanionClient(connection: invite.connection, token: answer.token, session: network)
                guard environment.environmentId == answer.environment.environmentId, answer.session.scopes.contains("client") else {
                    try? await paired.logout()
                    throw PairingFailure.unexpectedWorkspace
                }
                var target = invite.connection
                target.name = environment.label
                target.serverEnvironmentId = environment.environmentId
                target.serverScopes = answer.session.scopes
                result = (target, answer.token)
            } else {
                let answer = try await CompanionClient.pairFirstReachable(connection: invite.connection, credential: invite.credential, deviceName: "Entropybot iPhone", session: network)
                var target = answer.connection
                target.name = answer.response.serverName
                target.companionDeviceId = answer.response.device.id
                result = (target, answer.response.token)
            }
            let data = try JSONEncoder().encode(result.0)
            try KeychainToken.save(result.1, for: result.0.id)
            UserDefaults.standard.set(data, forKey: savedKey)
            connection = result.0
            client = CompanionClient(connection: result.0, token: result.1, session: network)
            start()
        } catch {
            self.error = error.localizedDescription
        }
    }

    static func invite(from raw: String) -> PairingInvite? {
        guard let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              let invite = PairingInvite.parse(url) else { return nil }
        if invite.credential.count == 12 && url.scheme?.lowercased() != "https" {
            #if targetEnvironment(simulator)
            guard url.scheme == "http", url.host == "127.0.0.1" else { return nil }
            #else
            return nil
            #endif
        }
        return invite
    }

    func start() {
        guard let client, let id = connection?.id, stream == nil else { return }
        loading = bots.isEmpty
        stream = Task {
            var delay: UInt64 = 500_000_000
            while !Task.isCancelled && connection?.id == id {
                do {
                    for try await frame in try client.events(since: state.cursor, streamingSession: network) {
                        try Task.checkCancellation()
                        if case let .hello(cursor, resumed) = frame.frame {
                            if !resumed {
                                let fleet = try await client.fleet(messages: 60)
                                let thread = viewedThread
                                let page = if let thread { try await client.messages(threadId: thread, limit: 60) } else { nil as ThreadPage? }
                                try Task.checkCancellation()
                                state.hydrate(fleet)
                                if thread == viewedThread, let thread, let page { state.merge(page, intoThread: thread) }
                            }
                            state.cursor = cursor
                            connected = true
                            loading = false
                            delay = 500_000_000
                        } else {
                            state.applyBatch([frame])
                        }
                    }
                } catch {
                    guard !Task.isCancelled else { break }
                    if (error as? APIError)?.isUnauthorized == true {
                        forget()
                        self.error = "此设备的配对已失效。请在 Entropybot 重新生成二维码。"
                        return
                    }
                }
                guard !Task.isCancelled else { break }
                connected = false
                loading = false
                try? await Task.sleep(nanoseconds: delay)
                delay = min(delay * 2, 8_000_000_000)
            }
        }
    }

    func stop() {
        stream?.cancel()
        stream = nil
        connected = false
        loading = false
    }

    func reconnect() {
        stop()
        start()
    }

    func load(thread: String, before: String? = nil) async {
        guard let client, let id = connection?.id else { return }
        viewedThread = thread
        do {
            let page = try await client.messages(threadId: thread, before: before, limit: 60)
            guard !Task.isCancelled, connection?.id == id else { return }
            if before != nil { state.prepend(page, toThread: thread) }
            else { state.merge(page, intoThread: thread) }
        } catch {
            guard !Task.isCancelled, connection?.id == id else { return }
            self.error = error.localizedDescription
        }
    }

    func send(_ text: String, to botID: String, thread: String) async -> Bool {
        guard let client, connected, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        do {
            _ = try await client.send(text: text, toBot: botID, threadId: thread)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func unpair() {
        if let client, connection?.pairedWithServer == true { Task { try? await client.logout() } }
        forget()
    }

    private func forget() {
        stop()
        if let connection { KeychainToken.remove(for: connection.id) }
        UserDefaults.standard.removeObject(forKey: savedKey)
        connection = nil
        client = nil
        state = CompanionState()
        viewedThread = nil
    }
}

private final class RejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private enum PairingFailure: LocalizedError {
    case unexpectedWorkspace

    var errorDescription: String? { "服务器身份或配对权限与邀请不一致。请重新生成配对码。" }
}
