import Foundation
import Security
import SwiftUI

enum APIError: LocalizedError {
    case unauthorized, badURL, server(String)
    var errorDescription: String? {
        switch self {
        case .unauthorized: return "Session expired. Please sign in again."
        case .badURL: return "That server address doesn't look right."
        case .server(let msg): return msg
        }
    }
}

struct API {
    let base: URL
    let token: String

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
        guard let url = URL(string: base.absoluteString + path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 30
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(code) else { throw APIError.server("Server error (\(code))") }
        return data
    }

    func get<T: Decodable>(_ path: String) async throws -> T {
        try API.decoder.decode(T.self, from: try await request(path))
    }

    func post(_ path: String, body: [String: Any]? = nil) async throws {
        _ = try await request(path, method: "POST", body: body)
    }
}

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var baseURL: URL?
    @Published private(set) var token: String?
    @Published var overview: Overview?
    @Published var status: ServerStatus?
    @Published var errorMessage: String?

    /// The Railway deployment; pre-filled so sign-in only asks for the password.
    static let defaultServer = "https://care-tracker-production-90cb661f.up.railway.app"

    init() {
        if let s = UserDefaults.standard.string(forKey: "server") { baseURL = URL(string: s) }
        token = Keychain.read("token")
    }

    var isSignedIn: Bool { baseURL != nil && token != nil }

    var api: API? {
        guard let baseURL, let token else { return nil }
        return API(base: baseURL, token: token)
    }

    // MARK: auth

    func signIn(server: String, password: String) async throws {
        var s = server.trimmingCharacters(in: .whitespacesAndNewlines)
        if !s.lowercased().hasPrefix("http") { s = "https://" + s }
        while s.hasSuffix("/") { s.removeLast() }
        guard let url = URL(string: s), url.host != nil else { throw APIError.badURL }

        var req = URLRequest(url: URL(string: s + "/api/login")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["password": password])
        let (data, response) = try await URLSession.shared.data(for: req)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 { throw APIError.server("Wrong password.") }
        guard code == 200, let r = try? JSONDecoder().decode(LoginResponse.self, from: data) else {
            throw APIError.server("Couldn't reach the tracker at that address.")
        }
        UserDefaults.standard.set(s, forKey: "server")
        Keychain.save("token", r.token)
        baseURL = url
        token = r.token
    }

    func signOut() {
        Keychain.delete("token")
        token = nil
        overview = nil
        status = nil
    }

    // MARK: data

    func refresh() async {
        guard let api else { return }
        do {
            async let o: Overview = api.get("/api/overview")
            async let s: ServerStatus = api.get("/api/status")
            let (ov, st) = try await (o, s)
            overview = ov
            status = st
            errorMessage = nil
        } catch { handle(error) }
    }

    func refreshStatus() async {
        guard let api else { return }
        do { status = try await api.get("/api/status") } catch { handle(error) }
    }

    func toggleCheck(_ s: Supplement) async {
        guard let api else { return }
        if let i = overview?.supplements.firstIndex(where: { $0.id == s.id }) {
            overview?.supplements[i].checked = !(s.checked ?? false)   // optimistic
        }
        do { try await api.post("/api/check/\(s.id)") } catch { handle(error) }
    }

    func toggleItem(_ item: CareItem) async {
        guard let api else { return }
        do { try await api.post("/api/items/\(item.id)/toggle"); await refresh() } catch { handle(error) }
    }

    func post(_ path: String, body: [String: Any]? = nil) async {
        guard let api else { return }
        do { try await api.post(path, body: body); await refresh() } catch { handle(error) }
    }

    func handle(_ error: Error) {
        if case APIError.unauthorized = error { signOut(); return }
        if (error as? URLError)?.code == .cancelled || error is CancellationError { return }
        errorMessage = error.localizedDescription
    }

    /// Warnings shown at the top of the main screens.
    var banners: [String] {
        guard let s = status else { return [] }
        var out: [String] = []
        if s.whatsapp != "open" {
            out.append(s.whatsapp == "qr" ? "WhatsApp isn't linked yet. Open Setup to scan the QR code." : "WhatsApp is reconnecting…")
        } else if s.group == nil {
            out.append("Pick the care group in Setup.")
        }
        if !s.hasKey { out.append("The server has no Anthropic API key, so messages aren't being organised.") }
        else if let e = s.extraction.lastError { out.append("Last update failed: \(e)") }
        return out
    }
}

enum Keychain {
    private static func base(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "CareTracker",
         kSecAttrAccount as String: key]
    }

    static func save(_ key: String, _ value: String) {
        SecItemDelete(base(key) as CFDictionary)
        var q = base(key)
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }

    static func read(_ key: String) -> String? {
        var q = base(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func delete(_ key: String) {
        SecItemDelete(base(key) as CFDictionary)
    }
}
