import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if model.isSignedIn { MainTabs() } else { SignInView() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.refresh() } }
        }
    }
}

struct MainTabs: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        TabView {
            TodayView().tabItem { Label("Today", systemImage: "sun.max") }
            PlanView().tabItem { Label("Plan", systemImage: "list.clipboard") }
            TodoView().tabItem { Label("To-do", systemImage: "checklist") }
            ChangesView().tabItem { Label("Changes", systemImage: "clock.arrow.circlepath") }
            ChatView().tabItem { Label("Chat", systemImage: "bubble.left.and.bubble.right") }
        }
        .task { await model.refresh() }
    }
}

// MARK: - Sign in

struct SignInView: View {
    @EnvironmentObject private var model: AppModel
    @State private var server = UserDefaults.standard.string(forKey: "server") ?? ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("your-app.up.railway.app", text: $server)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Dashboard password", text: $password)
                } header: {
                    Text("Tracker server")
                } footer: {
                    Text("The Railway address and the DASHBOARD_PASSWORD you set there.")
                }
                Section {
                    Button {
                        Task {
                            busy = true; error = nil
                            do { try await model.signIn(server: server, password: password) }
                            catch { self.error = error.localizedDescription }
                            busy = false
                        }
                    } label: {
                        HStack { Spacer(); if busy { ProgressView() } else { Text("Sign in").bold() }; Spacer() }
                    }
                    .disabled(server.isEmpty || password.isEmpty || busy)
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Care Tracker")
        }
    }
}

// MARK: - Today

struct TodayView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            List {
                BannerSection()
                if let o = model.overview {
                    Section("Supplements") {
                        if o.supplements.isEmpty { EmptyRow(text: "No supplements prescribed yet.") }
                        ForEach(o.supplements) { s in
                            Button { Task { await model.toggleCheck(s) } } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    CheckCircle(on: s.checked ?? false)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text([s.name, s.dose].compactMap { $0 }.joined(separator: " · ")).fontWeight(.medium)
                                        Text([s.timing ?? "timing not specified", s.notes].compactMap { $0 }.joined(separator: " — "))
                                            .font(.subheadline).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    let mine = o.items.filter { $0.owner == "me" }
                    Section("Needs your attention") {
                        if mine.isEmpty { EmptyRow(text: "Nothing waiting on you.") }
                        ForEach(mine.prefix(6)) { ItemRow(item: $0) }
                    }
                    Section {
                        if o.todayLogs.isEmpty { EmptyRow(text: "Nothing logged today yet.") }
                        ForEach(o.todayLogs) { LogRow(log: $0) }
                    } header: {
                        HStack {
                            Text("Logged today")
                            if o.todayLogs.isEmpty && !o.supplements.isEmpty { Pill(text: "nothing yet", warn: true) }
                        }
                    }
                    Section("Recent changes") {
                        if o.changes.isEmpty { EmptyRow(text: "No changes yet.") }
                        ForEach(o.changes.prefix(4)) { ChangeRow(change: $0) }
                    }
                } else {
                    Section { HStack { Spacer(); ProgressView(); Spacer() } }
                }
            }
            .navigationTitle("Today")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { SetupView() } label: { Image(systemName: "gearshape") }
                }
            }
            .refreshable { await model.refresh() }
        }
    }
}

// MARK: - Plan

struct PlanView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            List {
                BannerSection()
                if let o = model.overview {
                    Section("Supplements & medicines") {
                        if o.supplements.isEmpty { EmptyRow(text: "None yet.") }
                        ForEach(o.supplements) { s in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(s.name ?? "").fontWeight(.medium)
                                let detail = [s.dose, s.timing].compactMap { $0 }.joined(separator: " · ")
                                if !detail.isEmpty { Text(detail).foregroundStyle(.secondary) }
                                if let n = s.notes { Text(n).font(.subheadline).foregroundStyle(.secondary) }
                                HStack(spacing: 6) {
                                    Text("since " + s.startedTs.dateText).font(.caption).foregroundStyle(.secondary)
                                    SourceButton(messageId: s.sourceMsg)
                                }
                            }
                        }
                    }
                    let categories = Array(Set(o.rules.map { $0.category ?? "other" })).sorted()
                    if categories.isEmpty {
                        Section("Guidelines") { EmptyRow(text: "No diet or lifestyle rules yet.") }
                    }
                    ForEach(categories, id: \.self) { cat in
                        Section(cat.capitalized) {
                            ForEach(o.rules.filter { ($0.category ?? "other") == cat }) { r in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(r.text ?? "")
                                    HStack(spacing: 6) {
                                        Text(r.ts.dateText).font(.caption).foregroundStyle(.secondary)
                                        SourceButton(messageId: r.sourceMsg)
                                    }
                                }
                            }
                        }
                    }
                    if !o.stopped.isEmpty {
                        Section("Stopped") {
                            ForEach(o.stopped) { s in
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(s.name ?? "").strikethrough().foregroundStyle(.secondary)
                                    HStack(spacing: 6) {
                                        Text("stopped " + s.updatedTs.dateText).font(.caption).foregroundStyle(.secondary)
                                        SourceButton(messageId: s.sourceMsg)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Current plan")
            .refreshable { await model.refresh() }
        }
    }
}

// MARK: - To-do

struct TodoView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            List {
                BannerSection()
                if let o = model.overview {
                    let mine = o.items.filter { $0.owner == "me" }
                    let theirs = o.items.filter { $0.owner != "me" }
                    Section("On you") {
                        if mine.isEmpty { EmptyRow(text: "All clear.") }
                        ForEach(mine) { ItemRow(item: $0) }
                    }
                    Section("Waiting on the team") {
                        if theirs.isEmpty { EmptyRow(text: "Nothing pending.") }
                        ForEach(theirs) { ItemRow(item: $0) }
                    }
                    if !o.done.isEmpty {
                        Section("Recently done") { ForEach(o.done) { ItemRow(item: $0) } }
                    }
                }
            }
            .navigationTitle("To-do")
            .refreshable { await model.refresh() }
        }
    }
}

// MARK: - Changes & logs

struct ChangesView: View {
    @EnvironmentObject private var model: AppModel
    @State private var logs: [LogEntry] = []

    private var days: [(String, [LogEntry])] {
        Dictionary(grouping: logs) { $0.date ?? "" }
            .sorted { $0.key > $1.key }
            .map { ($0.key, $0.value) }
    }

    var body: some View {
        NavigationStack {
            List {
                BannerSection()
                Section("Plan changes") {
                    let changes = model.overview?.changes ?? []
                    if changes.isEmpty { EmptyRow(text: "No changes yet.") }
                    ForEach(changes) { ChangeRow(change: $0) }
                }
                if days.isEmpty {
                    Section("Your logs · last 14 days") { EmptyRow(text: "No logs yet.") }
                }
                ForEach(days, id: \.0) { group in
                    Section(DayLabel.from(group.0)) { ForEach(group.1) { LogRow(log: $0) } }
                }
            }
            .navigationTitle("Changes")
            .task { await loadLogs() }
            .refreshable { await model.refresh(); await loadLogs() }
        }
    }

    private func loadLogs() async {
        guard let api = model.api else { return }
        do { logs = try await api.get("/api/logs?days=14") } catch { model.handle(error) }
    }
}

// MARK: - Chat

struct ChatView: View {
    @EnvironmentObject private var model: AppModel
    @State private var messages: [ChatMessage] = []
    @State private var query = ""
    @State private var loading = false

    private var days: [(String, [ChatMessage])] {
        var out: [(String, [ChatMessage])] = []
        for m in messages {
            let label = DayLabel.from(ts: m.ts)
            if out.last?.0 == label { out[out.count - 1].1.append(m) } else { out.append((label, [m])) }
        }
        return out
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if messages.isEmpty && !loading {
                        ContentUnavailableView(emptyTitle, systemImage: "bubble.left")
                            .padding(.top, 60)
                    }
                    ForEach(days, id: \.0) { group in
                        Text(group.0).font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 8)
                        ForEach(group.1) { MessageBubble(message: $0) }
                    }
                }
                .padding(.horizontal)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Chat")
            .searchable(text: $query, prompt: "Search the group")
            .onSubmit(of: .search) { Task { await load() } }
            .onChange(of: query) { _, q in if q.isEmpty { Task { await load() } } }
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private var emptyTitle: String { query.isEmpty ? "No messages yet" : "No results" }

    private func load() async {
        guard let api = model.api else { return }
        loading = true
        defer { loading = false }
        let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        do { messages = try await api.get("/api/messages?q=\(q)") } catch { model.handle(error) }
    }
}

// MARK: - Setup

struct SetupView: View {
    @EnvironmentObject private var model: AppModel
    @State private var groups: [WAGroup] = []
    @State private var confirmRebuild = false
    @State private var confirmUnlink = false
    @State private var notice: String?

    var body: some View {
        List {
            if let s = model.status {
                if s.whatsapp == "qr", let qr = s.qr, let image = Self.decodeDataURL(qr) {
                    Section {
                        Image(uiImage: image).resizable().interpolation(.none).scaledToFit()
                            .frame(maxWidth: 260).frame(maxWidth: .infinity)
                            .padding(8).background(.white, in: RoundedRectangle(cornerRadius: 12))
                    } header: {
                        Text("Link WhatsApp")
                    } footer: {
                        Text("Scan from the phone whose WhatsApp is in the group: WhatsApp → Settings → Linked devices → Link a device. Use another screen (e.g. open the Railway URL on a laptop) if this is the same phone.")
                    }
                }
                if s.whatsapp == "open" && s.group == nil {
                    Section("Which group should be tracked?") {
                        if groups.isEmpty { EmptyRow(text: "Loading groups…") }
                        ForEach(groups) { g in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(g.name).fontWeight(.medium)
                                    Text("\(g.size) members" + (g.buffered > 0 ? " · \(g.buffered) past messages" : ""))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button("Track") {
                                    Task {
                                        await model.post("/api/group", body: ["jid": g.jid, "name": g.name])
                                        notice = "Tracking \"\(g.name)\". The plan fills in over the next few minutes."
                                    }
                                }
                                .buttonStyle(.borderedProminent)
                            }
                        }
                    }
                    .task { await loadGroups() }
                }
                Section("Status") {
                    LabeledContent("WhatsApp", value: s.whatsapp + (s.me.map { " · \($0)" } ?? ""))
                    LabeledContent("Tracked group", value: s.group?.name ?? "—")
                    LabeledContent("Messages stored", value: "\(s.messages)")
                    LabeledContent("Waiting to process", value: "\(s.extraction.pending)" + (s.extraction.running ? " (running)" : ""))
                    if let last = s.extraction.lastRun {
                        LabeledContent("Last update", value: Date(timeIntervalSince1970: last / 1000).formatted(date: .abbreviated, time: .shortened))
                    }
                    if let e = s.extraction.lastError { Text(e).foregroundStyle(.red).font(.subheadline) }
                }
            } else {
                Section { ProgressView() }
            }
            if let notice { Section { Text(notice).foregroundStyle(Color.accentColor) } }
            Section {
                Button("Process new messages now") { Task { await model.post("/api/process-now") } }
                Button("Rebuild from history") { confirmRebuild = true }
                Button("Unlink WhatsApp", role: .destructive) { confirmUnlink = true }
            }
            Section {
                Button("Sign out of this app", role: .destructive) { model.signOut() }
            }
        }
        .navigationTitle("Setup")
        .confirmationDialog("Re-run the AI over the whole history?", isPresented: $confirmRebuild, titleVisibility: .visible) {
            Button("Rebuild") { Task { await model.post("/api/reprocess") } }
        }
        .confirmationDialog("Unlink WhatsApp from the tracker?", isPresented: $confirmUnlink, titleVisibility: .visible) {
            Button("Unlink", role: .destructive) { Task { await model.post("/api/unlink") } }
        }
        .task {
            // poll while this screen is open so the QR and progress stay current
            while !Task.isCancelled {
                await model.refreshStatus()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    private func loadGroups() async {
        guard let api = model.api else { return }
        do { groups = try await api.get("/api/groups") } catch { model.handle(error) }
    }

    static func decodeDataURL(_ s: String) -> UIImage? {
        guard let comma = s.firstIndex(of: ",") else { return nil }
        guard let data = Data(base64Encoded: String(s[s.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }
}
