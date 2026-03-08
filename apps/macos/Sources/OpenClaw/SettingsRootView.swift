import Observation
import SwiftUI

struct SettingsRootView: View {
    @Bindable var state: AppState
    private let permissionMonitor = PermissionMonitor.shared
    @State private var monitoringPermissions = false
    @State private var selectedTab: SettingsTab = .general
    @State private var snapshotPaths: (configPath: String?, stateDir: String?) = (nil, nil)
    let updater: UpdaterProviding?
    private let isPreview = ProcessInfo.processInfo.isPreview
    private let isNixMode = ProcessInfo.processInfo.isNixMode

    init(state: AppState, updater: UpdaterProviding?, initialTab: SettingsTab? = nil) {
        self.state = state
        self.updater = updater
        self._selectedTab = State(initialValue: initialTab ?? .general)
    }

    var body: some View {
        NavigationSplitView {
            sidebarContent
                .navigationSplitViewColumnWidth(min: 200, ideal: 220, max: 280)
        } detail: {
            detailContent
        }
        .navigationSplitViewStyle(.balanced)
        .frame(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight)
        .onReceive(NotificationCenter.default.publisher(for: .openclawSelectSettingsTab)) { note in
            if let tab = note.object as? SettingsTab {
                withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) {
                    self.selectedTab = tab
                }
            }
        }
        .onAppear {
            if let pending = SettingsTabRouter.consumePending() {
                self.selectedTab = self.validTab(for: pending)
            }
            self.updatePermissionMonitoring(for: self.selectedTab)
        }
        .onChange(of: self.state.debugPaneEnabled) { _, enabled in
            if !enabled, self.selectedTab == .debug {
                self.selectedTab = .general
            }
        }
        .onChange(of: self.selectedTab) { _, newValue in
            self.updatePermissionMonitoring(for: newValue)
        }
        .onDisappear { self.stopPermissionMonitoring() }
        .task {
            guard !self.isPreview else { return }
            await self.refreshPerms()
        }
        .task(id: self.state.connectionMode) {
            guard !self.isPreview else { return }
            await self.refreshSnapshotPaths()
        }
    }

    @ViewBuilder
    private var sidebarContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            if self.isNixMode {
                nixManagedBanner
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
            }

            List(selection: self.$selectedTab) {
                Section("Connection") {
                    ForEach(SettingsTab.mainTabs, id: \.self) { tab in
                        sidebarRow(for: tab)
                    }
                }

                Section("Configuration") {
                    ForEach(SettingsTab.configTabs, id: \.self) { tab in
                        sidebarRow(for: tab)
                    }
                }

                Section("Advanced") {
                    ForEach(SettingsTab.advancedTabs, id: \.self) { tab in
                        sidebarRow(for: tab)
                    }
                    if self.state.debugPaneEnabled {
                        sidebarRow(for: .debug)
                    }
                }

                Section {
                    sidebarRow(for: .about)
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
        }
        .background(Color(nsColor: .controlBackgroundColor))
    }

    private func sidebarRow(for tab: SettingsTab) -> some View {
        Label(tab.title, systemImage: tab.systemImage)
            .tag(tab)
    }

    @ViewBuilder
    private var detailContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            headerView
            Divider()
            tabContent
        }
    }

    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(self.selectedTab.title)
                    .font(.title2.weight(.semibold))
                Text(self.selectedTab.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    @ViewBuilder
    private var tabContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                switch self.selectedTab {
                case .general:
                    GeneralSettings(state: self.state)
                case .channels:
                    ChannelsSettings()
                case .voiceWake:
                    VoiceWakeSettings(state: self.state, isActive: true)
                case .config:
                    ConfigSettings()
                case .instances:
                    InstancesSettings()
                case .sessions:
                    SessionsSettings()
                case .cron:
                    CronSettings()
                case .skills:
                    SkillsSettings(state: self.state)
                case .permissions:
                    PermissionsSettings(
                        status: self.permissionMonitor.status,
                        refresh: self.refreshPerms,
                        showOnboarding: { DebugActions.restartOnboarding() })
                case .debug:
                    DebugSettings(state: self.state)
                case .about:
                    AboutSettings(updater: self.updater)
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .background(Color(nsColor: .textBackgroundColor))
    }

    private var nixManagedBanner: some View {
        let configPath = self.snapshotPaths.configPath ?? OpenClawPaths.configURL.path
        let stateDir = self.snapshotPaths.stateDir ?? OpenClawPaths.stateDirURL.path

        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "gearshape.2.fill")
                    .foregroundStyle(.secondary)
                Text("Managed by Nix")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text("Config: \(configPath)")
                Text("State:  \(stateDir)")
            }
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
            .lineLimit(1)
            .truncationMode(.middle)
        }
        .padding(10)
        .background(Color.gray.opacity(0.12))
        .cornerRadius(10)
    }

    private func validTab(for requested: SettingsTab) -> SettingsTab {
        if requested == .debug, !self.state.debugPaneEnabled { return .general }
        return requested
    }

    @MainActor
    private func refreshSnapshotPaths() async {
        let paths = await GatewayConnection.shared.snapshotPaths()
        self.snapshotPaths = paths
    }

    @MainActor
    private func refreshPerms() async {
        guard !self.isPreview else { return }
        await self.permissionMonitor.refreshNow()
    }

    private func updatePermissionMonitoring(for tab: SettingsTab) {
        guard !self.isPreview else { return }
        PermissionMonitoringSupport.setMonitoring(tab == .permissions, monitoring: &self.monitoringPermissions)
    }

    private func stopPermissionMonitoring() {
        PermissionMonitoringSupport.stopMonitoring(&self.monitoringPermissions)
    }
}

enum SettingsTab: CaseIterable {
    case general, channels, skills, sessions, cron, config, instances, voiceWake, permissions, debug, about
    static let windowWidth: CGFloat = 900
    static let windowHeight: CGFloat = 640
    var title: String {
        switch self {
        case .general: "General"
        case .channels: "Channels"
        case .skills: "Skills"
        case .sessions: "Sessions"
        case .cron: "Cron"
        case .config: "Config"
        case .instances: "Instances"
        case .voiceWake: "Voice Wake"
        case .permissions: "Permissions"
        case .debug: "Debug"
        case .about: "About"
        }
    }

    var subtitle: String {
        switch self {
        case .general: "Connection and startup settings"
        case .channels: "Messaging platform integrations"
        case .skills: "Custom agent capabilities"
        case .sessions: "Conversation history"
        case .cron: "Scheduled tasks"
        case .config: "Advanced configuration"
        case .instances: "Gateway instances"
        case .voiceWake: "Voice activation settings"
        case .permissions: "System permissions"
        case .debug: "Developer tools"
        case .about: "Version and credits"
        }
    }

    var systemImage: String {
        switch self {
        case .general: "gearshape"
        case .channels: "link"
        case .skills: "sparkles"
        case .sessions: "clock.arrow.circlepath"
        case .cron: "calendar"
        case .config: "slider.horizontal.3"
        case .instances: "network"
        case .voiceWake: "waveform.circle"
        case .permissions: "lock.shield"
        case .debug: "ant"
        case .about: "info.circle"
        }
    }

    static var mainTabs: [SettingsTab] {
        [.general, .channels, .voiceWake]
    }

    static var configTabs: [SettingsTab] {
        [.config, .instances, .sessions, .cron]
    }

    static var advancedTabs: [SettingsTab] {
        [.skills, .permissions]
    }
}

@MainActor
enum SettingsTabRouter {
    private static var pending: SettingsTab?

    static func request(_ tab: SettingsTab) {
        self.pending = tab
    }

    static func consumePending() -> SettingsTab? {
        defer { self.pending = nil }
        return self.pending
    }
}

extension Notification.Name {
    static let openclawSelectSettingsTab = Notification.Name("openclawSelectSettingsTab")
}

#if DEBUG
struct SettingsRootView_Previews: PreviewProvider {
    static var previews: some View {
        ForEach(SettingsTab.allCases, id: \.self) { tab in
            SettingsRootView(state: .preview, updater: DisabledUpdaterController(), initialTab: tab)
                .previewDisplayName(tab.title)
                .frame(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight)
        }
    }
}
#endif
