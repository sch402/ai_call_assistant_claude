import SwiftUI

@main
struct CallAssistantApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var session = AppSession()
    @State private var store = Store()
    @State private var contacts = ContactNames()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(store)
                .environment(contacts)
                .environment(PushCenter.shared)
                // 尽早开始监听：续费、其他设备购买、家长批准后的交易都从这里来
                .task { store.observeTransactionUpdates(session: session) }
        }
        .onChange(of: scenePhase) { _, phase in
            // 回到前台时重新读取通讯录和通知权限：用户可能刚改过联系人，或在系统设置里改了权限
            if phase == .active {
                Task { await contacts.reload() }
                Task { await PushCenter.shared.refreshPermission() }
            }
        }
    }
}

/// 未登录 → 登录页；登录后先读配置；还没设置称呼和声音 → 首次引导；否则进入主界面。
struct RootView: View {
    @Environment(AppSession.self) private var session

    private enum Stage { case login, loading, onboarding, main }

    private var stage: Stage {
        guard session.isSignedIn else { return .login }
        guard let config = session.config else { return .loading }
        return config.profile?.complete == false ? .onboarding : .main
    }

    var body: some View {
        Group {
            switch stage {
            case .login: LoginView()
            case .loading: ConfigLoadingView()
            case .onboarding: OnboardingView()
            case .main: MainTabView()
            }
        }
        .animation(.default, value: stage)
    }
}

/// 登录后读取配置。失败时可以重试或退出，不会一直转圈。
private struct ConfigLoadingView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        VStack(spacing: 16) {
            if let error = session.configError {
                Text(error)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("重试") { Task { await session.refreshConfig() } }
                    .buttonStyle(.borderedProminent)
                Button("退出登录") { Task { await session.signOut() } }
                    .font(.footnote)
            } else {
                ProgressView()
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task { await session.refreshConfig() }
    }
}

enum AppTab: Hashable {
    case calls, forwarding, settings
}

struct MainTabView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        @Bindable var session = session
        TabView(selection: $session.selectedTab) {
            CallListView()
                .tabItem { Label("来电", systemImage: "phone.bubble") }
                .tag(AppTab.calls)
            ForwardingView()
                .tabItem { Label("代接设置", systemImage: "arrow.triangle.turn.up.right.circle") }
                .tag(AppTab.forwarding)
            SettingsView()
                .tabItem { Label("我的", systemImage: "person.crop.circle") }
                .tag(AppTab.settings)
        }
        .task { await session.refreshConfig() }
        // 进入主界面后请求通知权限并上报设备令牌（AI 接完电话后推送来电人和摘要）
        .task { await PushCenter.shared.start(session: session) }
        .sheet(isPresented: $session.showSubscription) { SubscriptionView() }
    }
}
