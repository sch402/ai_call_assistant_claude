import SwiftUI

/// 首次打开：连接后端服务。原型阶段用服务地址 + 访问口令（DASHBOARD_TOKEN）。
struct ConnectView: View {
    @Environment(AppSession.self) private var session

    @State private var server = ""
    @State private var token = ""
    @State private var isConnecting = false
    @State private var errorMessage: String?
    @FocusState private var focused: Field?

    private enum Field { case server, token }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 14) {
                        Image("LaunchLogo")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 72, height: 72)
                            .padding(18)
                            .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                        Text("来电助手")
                            .font(.title2.weight(.semibold))
                        Text("没接的电话由 AI 接听，\n问清是谁、什么事，再告诉你。")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                }
                .listRowBackground(Color.clear)

                Section {
                    TextField("例如 aicallassistantclaude.vercel.app", text: $server)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .focused($focused, equals: .server)
                        .submitLabel(.next)
                        .onSubmit { focused = .token }
                    SecureField("访问口令", text: $token)
                        .textContentType(.password)
                        .focused($focused, equals: .token)
                        .submitLabel(.go)
                        .onSubmit(connect)
                } header: {
                    Text("连接服务")
                } footer: {
                    if let errorMessage {
                        Text(errorMessage).foregroundStyle(.red)
                    } else {
                        Text("原型阶段：访问口令就是 Vercel 环境变量里的 DASHBOARD_TOKEN。口令只保存在这台手机的钥匙串里。")
                    }
                }

                Section {
                    Button(action: connect) {
                        HStack {
                            Spacer()
                            if isConnecting { ProgressView() } else { Text("连接").fontWeight(.semibold) }
                            Spacer()
                        }
                    }
                    .disabled(isConnecting || server.isEmpty || token.isEmpty)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private func connect() {
        guard !isConnecting else { return }
        focused = nil
        isConnecting = true
        errorMessage = nil
        Task {
            do {
                try await session.connect(serverText: server, token: token)
            } catch {
                errorMessage = error.localizedDescription
            }
            isConnecting = false
        }
    }
}
