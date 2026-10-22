import SwiftUI

struct SettingsView: View {
    @Environment(AppSession.self) private var session
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
                    NavigationLink("隐私与条款") { PrivacyView() }
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

private struct PrivacyView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        List {
            Section {
                Text("AI 接听时只说你设置的称呼，不会透露你的姓、住址、证件号、账户等任何个人信息，也不会替你做任何承诺。")
                Text("通话不保存录音，只保存文字转写和摘要，用来在 App 里展示给你。")
                Text("手机号只用于登录，以及确认转过来的电话是你的。我们不出售你的数据，也不用于广告。")
                Text("你可以随时在「我的 › 删除账户」里删除账户和全部来电记录。")
            }
            Section {
                if let privacy = LegalLinks.privacy(server: session.serverURL) {
                    Link("隐私政策", destination: privacy)
                }
                if let terms = LegalLinks.terms(server: session.serverURL) {
                    Link("用户协议", destination: terms)
                }
            }
        }
        .navigationTitle("隐私与条款")
        .navigationBarTitleDisplayMode(.inline)
    }
}
