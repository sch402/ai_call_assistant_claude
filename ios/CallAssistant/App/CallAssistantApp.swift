import SwiftUI

@main
struct CallAssistantApp: App {
    @State private var session = AppSession()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
        }
    }
}

/// 未登录时显示登录页，登录后进入主界面。
struct RootView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        Group {
            if session.isSignedIn {
                MainTabView()
            } else {
                LoginView()
            }
        }
        .animation(.default, value: session.isSignedIn)
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
    }
}
