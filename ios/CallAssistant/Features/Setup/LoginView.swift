import SwiftUI

/// 登录：手机号 → 短信验证码。
/// iOS 不允许 App 读取本机号码：号码框用 .telephoneNumber，键盘会建议「我的名片」里的号码；
/// 验证码框用 .oneTimeCode，短信到达后点一下键盘上方的建议即可填入，填满自动登录。
struct LoginView: View {
    @Environment(AppSession.self) private var session

    @State private var phoneText = ""
    @State private var code = ""
    /// 已发送验证码的号码（E.164）；为空时显示第一步
    @State private var sentTo: String?
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var resendAvailableAt = Date.distantPast
    @FocusState private var focused: Field?

    private enum Field { case phone, code }
    private static let codeLength = 6
    private static let resendInterval: TimeInterval = 60

    var body: some View {
        VStack(spacing: 0) {
            if let sentTo {
                codeStep(phone: sentTo)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            } else {
                phoneStep
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(.snappy, value: sentTo)
        .animation(.default, value: errorMessage)
        .onAppear { focused = sentTo == nil ? .phone : .code }
    }

    // MARK: - 第一步：手机号

    private var phoneStep: some View {
        VStack(spacing: 0) {
            Image("LaunchLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 44, height: 44)
                .padding(14)
                .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding(.top, 56)

            Text("登录来电助手")
                .font(.title.bold())
                .padding(.top, 20)

            HStack(spacing: 12) {
                Text("+61")
                    .foregroundStyle(.secondary)
                Divider().frame(height: 22)
                TextField("手机号", text: $phoneText)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                    .focused($focused, equals: .phone)
            }
            .font(.title3)
            .padding(.horizontal, 18)
            .frame(height: 56)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .padding(.top, 40)

            errorLine

            primaryButton("获取验证码", action: sendCode)
                .disabled(isWorking || PhoneNumber.e164(phoneText) == nil)
                .padding(.top, 16)

            agreementLine
                .padding(.top, 14)
        }
    }

    // MARK: - 第二步：验证码

    private func codeStep(phone: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                sentTo = nil
                code = ""
                errorMessage = nil
                focused = .phone
            } label: {
                Image(systemName: "chevron.left")
                    .font(.title3.weight(.semibold))
                    .frame(width: 44, height: 44, alignment: .leading)
            }
            .tint(.primary)
            .disabled(isWorking)
            .padding(.top, 8)

            Text("输入验证码")
                .font(.title.bold())
                .padding(.top, 16)
            Text("已发送至 \(PhoneFormat.display(phone))")
                .foregroundStyle(.secondary)
                .padding(.top, 6)

            CodeBoxes(code: code, length: Self.codeLength, isActive: focused == .code)
                .contentShape(Rectangle())
                .onTapGesture { focused = .code }
                .overlay {
                    // 透明的输入框负责键盘和验证码自动填充，格子只负责显示
                    TextField("", text: $code)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .focused($focused, equals: .code)
                        .foregroundStyle(.clear)
                        .tint(.clear)
                        .opacity(0.02)
                }
                .padding(.top, 32)
                .onChange(of: code) { _, newValue in
                    let digits = String(newValue.filter(\.isNumber).prefix(Self.codeLength))
                    if digits != newValue {
                        code = digits
                        return
                    }
                    if digits.count == Self.codeLength { verify() }
                }

            errorLine

            HStack {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let remaining = Int(resendAvailableAt.timeIntervalSince(context.date).rounded(.up))
                    let title = remaining > 0 ? String(localized: "\(remaining) 秒后可重新发送") : String(localized: "重新发送")
                    Button(title) { resend(phone: phone) }
                        .disabled(isWorking || remaining > 0)
                }
                .font(.subheadline)
                Spacer()
                if isWorking { ProgressView() }
            }
            .padding(.top, 20)
        }
    }

    // MARK: - 组件

    /// 「继续即表示同意《用户协议》和《隐私政策》」，链接到后端 public/ 下的页面。
    private var agreementLine: some View {
        var text = AttributedString(localized: "继续即表示同意")
        if let terms = LegalLinks.terms(server: session.serverURL),
           let privacy = LegalLinks.privacy(server: session.serverURL) {
            var termsLink = AttributedString(localized: "《用户协议》")
            termsLink.link = terms
            var privacyLink = AttributedString(localized: "《隐私政策》")
            privacyLink.link = privacy
            text += termsLink + AttributedString(localized: "和") + privacyLink
        }
        return Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
    }

    @ViewBuilder
    private var errorLine: some View {
        if let errorMessage {
            Text(errorMessage)
                .font(.footnote)
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 10)
        }
    }

    private func primaryButton(_ title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            ZStack {
                Text(title).opacity(isWorking ? 0 : 1)
                if isWorking { ProgressView().tint(.white) }
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.roundedRectangle(radius: 16))
    }

    // MARK: - 操作

    private func sendCode() {
        run {
            let phone = try await session.sendCode(phoneText: phoneText)
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

/// 验证码格子：每格一位数字，当前要输入的格子描边高亮。
private struct CodeBoxes: View {
    let code: String
    let length: Int
    let isActive: Bool

    var body: some View {
        HStack(spacing: 10) {
            ForEach(0..<length, id: \.self) { index in
                let digit = index < code.count ? String(code[code.index(code.startIndex, offsetBy: index)]) : ""
                let isCurrent = isActive && index == min(code.count, length - 1)
                Text(digit)
                    .font(.title2.monospacedDigit().weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(isCurrent ? Color.accentColor : .clear, lineWidth: 2)
                    }
            }
        }
    }
}
