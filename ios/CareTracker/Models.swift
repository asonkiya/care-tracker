import Foundation

// Mirrors the JSON returned by the Railway server (snake_case keys are converted automatically).

struct LoginResponse: Decodable { let ok: Bool; let token: String }

struct Supplement: Decodable, Identifiable {
    let id: Int
    let name: String?
    let dose: String?
    let timing: String?
    let notes: String?
    let status: String?
    let startedTs: Int?
    let updatedTs: Int?
    let sourceMsg: String?
    var checked: Bool?
}

struct Rule: Decodable, Identifiable {
    let id: Int
    let category: String?
    let text: String?
    let ts: Int?
    let sourceMsg: String?
}

struct LogEntry: Decodable, Identifiable {
    let id: Int
    let date: String?
    let category: String?
    let summary: String?
    let value: String?
    let ts: Int?
    let sourceMsg: String?
}

struct CareItem: Decodable, Identifiable {
    let id: Int
    let kind: String?
    let title: String?
    let details: String?
    let owner: String?
    let due: String?
    let status: String?
    let resolution: String?
    let ts: Int?
    let resolvedTs: Int?
    let sourceMsg: String?

    var isDone: Bool { status == "done" }
}

struct PlanChange: Decodable, Identifiable {
    let id: Int
    let ts: Int?
    let summary: String?
    let sourceMsg: String?
}

struct Overview: Decodable {
    let today: String
    var supplements: [Supplement]
    let stopped: [Supplement]
    let rules: [Rule]
    let items: [CareItem]
    let done: [CareItem]
    let changes: [PlanChange]
    let todayLogs: [LogEntry]
    let lastLogDate: String?
}

struct ChatMessage: Decodable, Identifiable {
    let id: String
    let senderName: String?
    let fromMe: Int
    let ts: Int
    let text: String?
    let mediaKind: String?
    let mediaPath: String?

    var isMine: Bool { fromMe == 1 }
}

struct GroupRef: Decodable { let jid: String; let name: String }

struct ExtractionState: Decodable {
    let running: Bool
    let lastRun: Double?
    let lastError: String?
    let pending: Int
}

struct ServerStatus: Decodable {
    let whatsapp: String
    let qr: String?
    let pairingCode: String?
    let me: String?
    let group: GroupRef?
    let extraction: ExtractionState
    let messages: Int
    let hasKey: Bool
}

struct WAGroup: Decodable, Identifiable {
    let jid: String
    let name: String
    let size: Int
    let buffered: Int
    var id: String { jid }
}

// MARK: - Formatting helpers

extension Optional where Wrapped == Int {
    var dateText: String {
        guard let ts = self else { return "" }
        return Date(timeIntervalSince1970: TimeInterval(ts)).formatted(.dateTime.day().month(.abbreviated).hour().minute())
    }
}

enum DayLabel {
    private static let parser: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    static func from(_ ymd: String) -> String {
        guard let d = parser.date(from: ymd) else { return ymd }
        return d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
    }

    static func from(ts: Int) -> String {
        Date(timeIntervalSince1970: TimeInterval(ts)).formatted(.dateTime.weekday(.wide).day().month(.wide))
    }
}
