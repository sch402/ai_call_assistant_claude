import SwiftUI

struct SettingsView: View {
    @Environment(AppSession.self) private var session
    @State private var confirmSignOut = false

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
                    if let name = session.config?.ownerName, !name.isEmpty {
                        LabeledContent("称呼", value: name)
                    }
                    if let number = session.config?.twilioNumber {
                        LabeledContent("代接号码", value: PhoneFormat.display(number))
                    }
                }

                Section {
                    HStack(spacing: 14) {
                        Image(systemName: "sparkles")
                            .font(.title2)
                            .foregroundStyle(Color.accentColor)
                            .frame(width: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("来电助手 Pro").font(.headline)
                            Text("更多通话时长、自定义声音、来电实时提醒").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text("即将推出").font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                } header: {
                    Text("会员")
                }

                Section("关于") {
                    LabeledContent("版本", value: version)
                    NavigationLink("隐私说明") { PrivacyView() }
                }

                Section {
                    Button("退出登录", role: .destructive) { confirmSignOut = true }
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
    var body: some View {
        List {
            Section {
                Text("AI 接听时不会说出你的姓、住址、证件号、账户等任何个人信息，也不会替你做任何承诺。")
                Text("通话不保存录音，只保存文字转写和摘要，存放在你自己的 Supabase 数据库里。")
                Text("登录凭证只保存在这台手机的钥匙串中。手机号只用于登录，以及确认被转移过来的来电是你的。")
            }
        }
        .navigationTitle("隐私说明")
        .navigationBarTitleDisplayMode(.inline)
    }
}
