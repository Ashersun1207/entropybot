import CompanionCore
import SwiftUI

struct RosterView: View {
    @EnvironmentObject private var model: PhoneModel
    @State private var choosingDisconnect = false

    var body: some View {
        List {
            if !model.connected {
                Label(model.loading ? "正在连接…" : "正在重新连接…", systemImage: "wifi")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("connection-status")
            }
            ForEach(model.bots) { bot in
                Section(bot.name) {
                    let otherThreads = (bot.tasks ?? []).filter { $0.threadId != bot.threadId }
                    NavigationLink {
                        ChatView(botID: bot.id, title: bot.name, thread: bot.threadId)
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(otherThreads.isEmpty ? bot.name : "当前对话").font(.body.weight(.semibold))
                            let message = model.state.visibleTranscript(forThread: bot.threadId).last { $0.kind == .text }
                            Text(message?.text ?? bot.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    ForEach(otherThreads, id: \.threadId) { task in
                        NavigationLink {
                            ChatView(botID: bot.id, title: task.title, thread: task.threadId)
                        } label: {
                            Label(task.title.isEmpty ? "未命名对话" : task.title, systemImage: "bubble.left")
                        }
                    }
                }
            }
        }
        .navigationTitle(model.connection?.name ?? "Entropybot")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("重新连接", systemImage: "arrow.clockwise") { model.reconnect() }
                    Button("断开配对", systemImage: "link.badge.plus", role: .destructive) { choosingDisconnect = true }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .confirmationDialog("断开此手机与工作区的配对？", isPresented: $choosingDisconnect, titleVisibility: .visible) {
            Button("断开配对", role: .destructive) { model.unpair() }
        }
        .task { model.start() }
    }
}

struct ChatView: View {
    @EnvironmentObject private var model: PhoneModel
    let botID: String
    let title: String
    let thread: String
    @State private var draft = ""
    @State private var sending = false
    @State private var loadingOlder = false

    private var messages: [Message] {
        model.state.visibleTranscript(forThread: thread).filter { $0.kind == .text && !($0.text ?? "").isEmpty }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 10) {
                    if model.state.hasMore[thread] == true, let first = messages.first?.id {
                        Button(loadingOlder ? "正在加载…" : "加载更早的消息") {
                            loadingOlder = true
                            Task {
                                await model.load(thread: thread, before: first)
                                loadingOlder = false
                                proxy.scrollTo(first, anchor: .top)
                            }
                        }
                        .disabled(loadingOlder)
                    }
                    ForEach(messages) { message in
                        bubble(message).id(message.id)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .onChange(of: messages.last?.id, initial: true) { _, last in
                if let last { proxy.scrollTo(last, anchor: .bottom) }
            }
        }
        .safeAreaInset(edge: .bottom) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField("发消息", text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    .textFieldStyle(.roundedBorder)
                    .disabled(sending)
                    .accessibilityIdentifier("message-input")
                Button {
                    let text = draft
                    sending = true
                    Task {
                        if await model.send(text, to: botID, thread: thread) { draft = "" }
                        sending = false
                    }
                } label: {
                    if sending { ProgressView() } else { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                }
                .accessibilityLabel("发送")
                .accessibilityIdentifier("send-message")
                .disabled(sending || !model.connected || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(10)
            .background(.bar)
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: thread) { await model.load(thread: thread) }
    }

    private func bubble(_ message: Message) -> some View {
        let mine = message.role == .user
        return HStack {
            if mine { Spacer(minLength: 40) }
            Text(mine ? AttributedString(message.text ?? "") : rendered(message.text ?? ""))
                .font(.body)
                .textSelection(.enabled)
                .padding(.horizontal, 13)
                .padding(.vertical, 9)
                .background(mine ? Color.accentColor.opacity(0.18) : Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            if !mine { Spacer(minLength: 40) }
        }
    }

    private func rendered(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }
}
