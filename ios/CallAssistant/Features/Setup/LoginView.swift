import SwiftUI

/// 登录：手机号 + 短信验证码。登录的手机号就是要被代接（设置呼叫转移）的那个号码。
/// iOS 不允许 App 读取本机号码，所以号码框用 .telephoneNumber，键盘会建议「通讯录 › 我的名片」里的号码；
/// 验证码框用 .oneTimeCode，短信到达后键盘上方会出现验证码，点一下即可填入。
struct LoginView: View {
    @Environment(AppSession.self) private var session

    @State private var server = ""
    @State private var phoneText = ""
    @State private var code = ""
    /// 已发送验证码的号码（E.164）；为空时显示第一步
    @State private var sentTo: String?
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var resendAvailableAt = Date.distantPast
    @FocusState private var focused: Field?

    private enum Field { case server, phone, code }
    private static let resendInterval: TimeInterval = 60

    var body: some View {
        NavigationStack {
            Form {
                header
                if let sentTo {
                    codeStep(phone: sentTo)
                } else {
                    phoneStep
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .onAppear {
                if server.isEmpty { server = session.savedServerText }
                focused = server.isEmpty ? .server : .phone
            }
        }
    }

    private var header: some View {
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
    }

    // MARK: - 第一步：手机号

    @ViewBuilder
    private var phoneStep: some View {
        Section {
            TextField("手机号，例如 0412 345 678", text: $phoneText)
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
                .focused($focused, equals: .phone)
        } header: {
            Text("用手机号登录")
        } footer: {
            footer(default: "请填写这台 iPhone 的号码：AI 代接的就是打到这个号码、你没接的电话。我们会发一条短信验证码确认号码是你的。")
        }

        Section {
            TextField("例如 aicallassistantclaude.vercel.app", text: $server)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .textContentType(.URL)
                .focused($focused, equals: .server)
                .submitLabel(.next)
                .onSubmit { focused = .phone }
        } header: {
            Text("服务地址")
        } footer: {
            Text("原型阶段需要填写后端的 Vercel 网址。")
        }

        Section {
            primaryButton("获取验证码", action: sendCode)
                .disabled(isWorking || server.isEmpty || phoneText.isEmpty)
        }
    }

    // MARK: - 第二步：验证码

    @ViewBuilder
    private func codeStep(phone: String) -> some View {
        Section {
            TextField("6 位验证码", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($focused, equals: .code)
                .font(.title3.monospacedDigit())
                .onChange(of: code) { _, newValue in
                    // 键盘自动填入验证码后直接登录
                    if newValue.filter(\.isNumber).count == 6 { verify() }
                }
        } header: {
            Text("验证码已发送到 \(PhoneFormat.display(phone))")
        } footer: {
            footer(default: "短信到达后，键盘上方会出现验证码，点一下即可填入。")
        }

        Section {
            primaryButton("登录", action: verify)
                .disabled(isWorking || code.filter(\.isNumber).count < 6)
        }

        Section {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let remaining = Int(resendAvailableAt.timeIntervalSince(context.date).rounded(.up))
                let title = remaining > 0 ? String(localized: "重新发送（\(remaining) 秒）") : String(localized: "重新发送验证码")
                Button(title) { resend(phone: phone) }
                    .disabled(isWorking || remaining > 0)
            }
            Button("更换手机号") {
                sentTo = nil
                code = ""
                errorMessage = nil
                focused = .phone
            }
            .disabled(isWorking)
        }
    }

    // MARK: - 组件

    @ViewBuilder
    private func footer(default text: LocalizedStringKey) -> some View {
        if let errorMessage {
            Text(errorMessage).foregroundStyle(.red)
        } else {
            Text(text)
        }
    }

    private func primaryButton(_ title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Spacer()
                if isWorking { ProgressView() } else { Text(title).fontWeight(.semibold) }
                Spacer()
            }
        }
    }

    // MARK: - 操作

    private func sendCode() {
        run {
            let phone = try await session.sendCode(serverText: server, phoneText: phoneText)
            resendAvailableAt = Date().addingTimeInterval(Self.resendInterval)
            code = ""
            sentTo = phone
            focused = .code
        }
    }

    private func resend(phone: String) {
        run {
            try await session.resendCode(phone: phone)
            resendAvailableAt = Date().addingTimeInterval(Self.resendInterval)
        }
    }

    private func verify() {
        guard let sentTo else { return }
        run {
            do {
                try await session.verify(phone: sentTo, code: code)
            } catch {
                code = ""
                throw error
            }
        }
    }

    private func run(_ work: @escaping () async throws -> Void) {
        guard !isWorking else { return }
        isWorking = true
        errorMessage = nil
        Task {
            do {
                try await work()
            } catch {
                errorMessage = error.localizedDescription
            }
            isWorking = false
        }
    }
}
