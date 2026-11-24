import SwiftUI

extension Notification.Name {
    static let entropybotPairingURL = Notification.Name("entropybot.pairing.url")
}

@main
struct EntropybotPhoneApp: App {
    @StateObject private var model = PhoneModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .onChange(of: phase, initial: true) { _, current in
                    if current == .active { model.start() }
                    else if current == .background { model.stop() }
                }
                .onOpenURL { url in
                    NotificationCenter.default.post(name: .entropybotPairingURL, object: url)
                }
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var model: PhoneModel

    var body: some View {
        NavigationStack {
            Group {
                if model.isPaired {
                    RosterView()
                } else {
                    PairingView()
                }
            }
        }
        .alert("出错了", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("好", role: .cancel) { model.error = nil }
        } message: {
            Text(model.error ?? "")
        }
    }
}
