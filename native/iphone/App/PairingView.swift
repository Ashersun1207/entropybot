import CompanionCore
import SwiftUI

struct PairingView: View {
    @EnvironmentObject private var model: PhoneModel
    @State private var link = ""
    @State private var scanning = false
    @State private var pending: PairingInvite?

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "link.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(.tint)
            Text("连接你的 Entropybot")
                .font(.title2.weight(.semibold))
            Text("在 Mac 或服务器的 Entropybot 里打开「远程访问」，扫描配对二维码，或粘贴配对链接。")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button {
                scanning = true
            } label: {
                Label("扫描二维码", systemImage: "qrcode.viewfinder")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.pairing)

            VStack(alignment: .leading, spacing: 8) {
                Text("或粘贴配对链接").font(.footnote).foregroundStyle(.secondary)
                SecureField("entropybot://pair?…", text: $link)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button {
                    prepare(link)
                } label: {
                    if model.pairing { ProgressView() } else { Text("继续").frame(maxWidth: .infinity) }
                }
                .buttonStyle(.bordered)
                .disabled(model.pairing || link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            Spacer()
        }
        .padding(24)
        .onAppear {
            #if DEBUG
            if let link = ProcessInfo.processInfo.environment["PAIR_LINK"], !link.isEmpty, let invite = PhoneModel.invite(from: link) {
                Task { await model.pair(invite) }
            }
            #endif
        }
        .sheet(isPresented: $scanning, onDismiss: presentScannedInvite) {
            VStack(spacing: 0) {
                HStack {
                    Text("扫描配对二维码").font(.headline)
                    Spacer()
                    Button("关闭") { scanning = false }
                }
                .padding()
                QRScanner { value in
                    scannedLink = value
                    scanning = false
                }
                .ignoresSafeArea(edges: .bottom)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .entropybotPairingURL)) { note in
            if let url = note.object as? URL { prepare(url.absoluteString) }
        }
        .confirmationDialog("连接工作区", isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }), titleVisibility: .visible, presenting: pending) { invite in
            Button("连接") {
                pending = nil
                Task { await model.pair(invite) }
            }
            Button("取消", role: .cancel) { pending = nil }
        } message: { invite in
            Text(invite.connection.baseURL?.absoluteString ?? invite.connection.host)
        }
    }

    @State private var scannedLink: String?

    private func presentScannedInvite() {
        if let scannedLink {
            self.scannedLink = nil
            prepare(scannedLink)
        }
    }

    private func prepare(_ value: String) {
        link = ""
        guard !model.pairing else { return }
        guard let invite = PhoneModel.invite(from: value) else {
            model.error = "配对链接无效。请在 Entropybot 的「远程访问」重新生成二维码；自托管服务请使用 HTTPS 地址。"
            return
        }
        pending = invite
    }
}
