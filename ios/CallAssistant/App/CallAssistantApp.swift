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

/// 未连接服务时显示连接页，连接后进入主界面。
struct RootView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        Group {
            if session.isConnected {
                MainTabView()
            } else {
                ConnectView()
            }
        }
        .animation(.default, value: session.isConnected)
    }
}

struct MainTabView: View {
    var body: some View {
        TabView {
            CallListView()
                .tabItem { Label("来电", systemImage: "phone.bubble") }
            ForwardingView()
                .tabItem { Label("代接设置", systemImage: "arrow.triangle.turn.up.right.circle") }
            SettingsView()
                .tabItem { Label("我的", systemImage: "person.crop.circle") }
        }
    }
}
