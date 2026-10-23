import SwiftUI
import UIKit

struct SettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(ContactNames.self) private var contacts
    @State private var confirmSignOut = false

    private var membershipStatus: String {
        switch session.config?.subscription?.state {
        case .active: return String(localized: "已订阅")
        case .grace: return String(localized: "待续费")
        case .expired: return String(localized: "已过期")
        case .none?, nil: return String(localized: "未开通")
        }
    }

    private var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "0.1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(short)（\(build)）"
    }

    var body: some View {
        NavigationStack {
            List {
                Section("账户") {
                    if let phone = session.phone {
                        LabeledContent("手机号", value: PhoneFormat.display(phone))
                    }
                    if let config = session.config {
                        LabeledContent("代接号码", value: config.twilioNumberLabel)
                    }
                }

                Section("AI 助手") {
                    NavigationLink {
                        AssistantSettingsView()
                    } label: {
                        LabeledContent("称呼与声音") {
                            Text([session.config?.profile?.name, session.config?.profile?.voiceSummary]
                                .compactMap { $0 }
                                .filter { !$0.isEmpty }
                                .joined(separator: " · "))
                        }
                    }
                }

                Section {
                    switch contacts.access {
                    case .granted:
                        LabeledContent("显示通讯录名字", value: String(localized: "已开启"))
                    case .notDetermined:
                        Button("显示通讯录里的名字") { Task { await contacts.requestAccess() } }
                    case .denied:
                        Button("去设置里允许读取通讯录") {
                            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                        }
                    }
                } header: {
                    Text("通讯录")
                } footer: {
                    Text("来电号码在通讯录里时，显示你保存的名字。只在这台手机上匹配，不会上传。")
                }

                Section("会员") {
                    Button { session.showSubscription = true } label: {
                        HStack(spacing: 14) {
                            Image(systemName: "sparkles")
                                .font(.title2)
                                .foregroundStyle(Color.accentColor)
                                .frame(width: 36)
                            Text("来电助手 Pro").font(.headline).foregroundStyle(Color.primary)
                            Spacer()
                            Text(membershipStatus).font(.subheadline).foregroundStyle(.secondary)
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 4)
                    }
                }

                Section("关于") {
                    LabeledContent("版本", value: version)
                    // 直接显示网站上的最新版本（public/privacy.html、public/terms.html），不在 App 里另写一份
                    if let privacy = LegalLinks.privacy(server: session.serverURL) {
                        NavigationLink("隐私政策") { WebPageView(title: "隐私政策", url: privacy) }
                    }
                    if let terms = LegalLinks.terms(server: session.serverURL) {
                        NavigationLink("用户协议") { WebPageView(title: "用户协议", url: terms) }
                    }
                }

                Section {
                    Button("退出登录", role: .destructive) { confirmSignOut = true }
                }

                Section {
                    NavigationLink("删除账户") { DeleteAccountView() }
                        .foregroundStyle(.red)
                }
            }
            .navigationTitle("我的")
            .task { await session.refreshConfig() }
            .confirmationDialog("退出后需要重新用短信验证码登录。", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("退出登录", role: .destructive) { Task { await session.signOut() } }
            }
        }
    }
}
