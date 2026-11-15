import SwiftUI
import UIKit
import QuickLook

/// Small "source" link that opens the WhatsApp message an item came from.
struct SourceButton: View {
    let messageId: String?
    @State private var showing = false

    var body: some View {
        if let messageId {
            Button("source") { showing = true }
                .font(.caption)
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
                .underline()
                .sheet(isPresented: $showing) {
                    SourceSheet(messageId: messageId)
                        .presentationDetents([.medium, .large])
                }
        }
    }
}

struct SourceSheet: View {
    let messageId: String
    @EnvironmentObject private var model: AppModel
    @State private var message: ChatMessage?
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if let message {
                    MessageBubble(message: message).padding()
                } else if failed {
                    ContentUnavailableView("Message not found", systemImage: "questionmark.bubble")
                } else {
                    ProgressView().padding(40)
                }
            }
            .navigationTitle("Original message")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            guard let api = model.api,
                  let ids = messageId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else { return }
            let rows: [ChatMessage]? = try? await api.get("/api/messages?ids=\(ids)")
            message = rows?.first
            failed = message == nil
        }
    }
}

struct MessageBubble: View {
    let message: ChatMessage
    @EnvironmentObject private var model: AppModel
    @State private var pdfURL: URL?
    @State private var loadingPDF = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Text(message.isMine ? "You" : (message.senderName ?? "Team")).fontWeight(.semibold)
                Text("· " + Optional(message.ts).dateText).foregroundStyle(.secondary)
            }
            .font(.caption)

            if let text = message.text, !text.isEmpty {
                Text(text).textSelection(.enabled)
            }
            if let path = message.mediaPath, message.mediaKind == "image" {
                AuthImage(path: path)
            }
            if let path = message.mediaPath, message.mediaKind == "pdf" {
                Button {
                    Task { await openPDF(path) }
                } label: {
                    Label(loadingPDF ? "Loading…" : "Open PDF", systemImage: "doc.richtext")
                }
                .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(message.isMine ? Color.accentColor.opacity(0.12) : Color(.secondarySystemGroupedBackground),
                    in: RoundedRectangle(cornerRadius: 14))
        .quickLookPreview($pdfURL)
    }

    private func openPDF(_ path: String) async {
        guard let api = model.api, let encoded = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else { return }
        loadingPDF = true
        defer { loadingPDF = false }
        guard let data = try? await api.request("/media/\(encoded)") else { return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(path)
        try? data.write(to: url)
        pdfURL = url
    }
}

/// Image from the server's /media route (needs the auth header, so AsyncImage won't do).
struct AuthImage: View {
    let path: String
    @EnvironmentObject private var model: AppModel
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            } else {
                RoundedRectangle(cornerRadius: 10).fill(Color(.tertiarySystemFill))
                    .frame(height: 160)
                    .overlay(ProgressView())
            }
        }
        .task {
            guard image == nil, let api = model.api,
                  let encoded = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
                  let data = try? await api.request("/media/\(encoded)") else { return }
            image = UIImage(data: data)
        }
    }
}

struct CheckCircle: View {
    let on: Bool
    var body: some View {
        Image(systemName: on ? "checkmark.circle.fill" : "circle")
            .font(.title2)
            .foregroundStyle(on ? Color.accentColor : Color.secondary.opacity(0.5))
            .contentTransition(.symbolEffect(.replace))
    }
}

struct Pill: View {
    let text: String
    var warn = false
    var body: some View {
        Text(text.capitalized)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background((warn ? Color.orange : Color.accentColor).opacity(0.15), in: Capsule())
            .foregroundStyle(warn ? Color.orange : Color.accentColor)
    }
}

struct ItemRow: View {
    let item: CareItem
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button { Task { await model.toggleItem(item) } } label: { CheckCircle(on: item.isDone) }
                .buttonStyle(.borderless)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title ?? "").fontWeight(.medium)
                    .strikethrough(item.isDone)
                    .foregroundStyle(item.isDone ? .secondary : .primary)
                if let d = item.details, !d.isEmpty { Text(d).font(.subheadline).foregroundStyle(.secondary) }
                if let r = item.resolution, !r.isEmpty { Text("→ " + r).font(.subheadline).foregroundStyle(.secondary) }
                HStack(spacing: 6) {
                    Pill(text: item.kind ?? "task", warn: item.kind == "question")
                    if let due = item.due { Text("due \(due)").font(.caption).foregroundStyle(.secondary) }
                    Text(item.ts.dateText).font(.caption).foregroundStyle(.secondary)
                    SourceButton(messageId: item.sourceMsg)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

struct LogRow: View {
    let log: LogEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Pill(text: log.category ?? "log")
                Text(log.summary ?? "")
                if let v = log.value, !v.isEmpty { Text(v).fontWeight(.semibold) }
            }
            HStack(spacing: 6) {
                Text(log.ts.dateText).font(.caption).foregroundStyle(.secondary)
                SourceButton(messageId: log.sourceMsg)
            }
        }
    }
}

struct ChangeRow: View {
    let change: PlanChange
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(change.summary ?? "")
            HStack(spacing: 6) {
                Text(change.ts.dateText).font(.caption).foregroundStyle(.secondary)
                SourceButton(messageId: change.sourceMsg)
            }
        }
    }
}

struct BannerSection: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        let items = model.banners + (model.errorMessage.map { [$0] } ?? [])
        if !items.isEmpty {
            Section {
                ForEach(items, id: \.self) { b in
                    Label(b, systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(.orange)
                }
            }
        }
    }
}

struct EmptyRow: View {
    let text: String
    var body: some View { Text(text).foregroundStyle(.secondary) }
}
