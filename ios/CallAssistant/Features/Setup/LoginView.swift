import SwiftUI

/// 登录 / 注册：澳洲手机号 → 短信验证码。新号码验证后自动注册。
/// iOS 不允许 App 读取本机号码：号码框用 .telephoneNumber，键盘会建议「我的名片」里的号码；
/// 验证码框用 .oneTimeCode，短信到达后点一下键盘上方的建议即可填入，填满自动登录。
struct LoginView: View {
    @Environment(AppSession.self) private var session

    @State private var phoneText = ""
    @State private var code = ""
    @State private var agreed = false
    /// 已发送验证码的号码（E.164）；为空时显示第一步
    @State private var sentTo: String?
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var agreementShakes = 0
    @State private var codeShakes = 0
    @State private var appeared = false
    @FocusState private var focused: Field?

    private enum Field { case phone, code }
    private static let codeLength = 6
    private let throttle = OTPThrottle()

    private var phoneE164: String? { PhoneNumber.e164(phoneText) }
    private var phoneValid: Bool { PhoneNumber.isAustralianMobile(phoneE164) }

    var body: some View {
        ZStack {
            LoginBackground()
            ScrollView {
                VStack(spacing: 0) {
                    if let sentTo {
                        codeStep(phone: sentTo)
                            .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .trailing)).combined(with: .opacity))
                    } else {
                        phoneStep
                            .transition(.asymmetric(insertion: .move(edge: .leading), removal: .move(edge: .leading)).combined(with: .opacity))
                    }
                }
                .padding(.horizontal, 24)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)
        }
        .animation(.snappy(duration: 0.35), value: sentTo)
        .animation(.default, value: errorMessage)
        .sensoryFeedback(.selection, trigger: agreed)
        .sensoryFeedback(.warning, trigger: agreementShakes)
        .sensoryFeedback(.error, trigger: codeShakes)
        .sensoryFeedback(.success, trigger: sentTo) { _, new in new != nil }
        .onAppear {
            withAnimation(.spring(response: 0.6, dampingFraction: 0.75)) { appeared = true }
            focused = sentTo == nil ? .phone : .code
        }
    }

    // MARK: - 第一步：手机号

    private var phoneStep: some View {
        VStack(spacing: 0) {
            Image("LaunchLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 46, height: 46)
                .padding(16)
                .background(
                    LinearGradient(colors: [Color.accentColor, Color.accentColor.opacity(0.78)], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 22, style: .continuous)
                )
                .shadow(color: Color.accentColor.opacity(0.35), radius: 18, y: 8)
                .scaleEffect(appeared ? 1 : 0.85)
                .opacity(appeared ? 1 : 0)
                .padding(.top, 72)

            Text("欢迎使用来电助手")
                .font(.title.bold())
                .padding(.top, 24)
            Text("没接的电话，AI 替你接")
                .foregroundStyle(.secondary)
                .padding(.top, 6)

            phoneField
                .padding(.top, 40)

            agreementRow
                .padding(.top, 16)
                .modifier(Shake(animatableData: CGFloat(agreementShakes)))

            errorLine

            PrimaryButton(title: "登录 / 注册", isWorking: isWorking, action: submitPhone)
                .disabled(!phoneValid || isWorking)
                .padding(.top, 20)

            Text("新号码验证后自动注册")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .padding(.top, 12)
                .padding(.bottom, 24)
        }
    }

    private var phoneField: some View {
        HStack(spacing: 12) {
            Text("🇦🇺 +61")
                .font(.body.weight(.medium))
                .foregroundStyle(.secondary)
            Rectangle().fill(.quaternary).frame(width: 1, height: 24)
            TextField("412 345 678", text: $phoneText)
                .font(.title3.monospacedDigit())
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
                .focused($focused, equals: .phone)
                .onChange(of: phoneText) { _, newValue in
                    let formatted = PhoneNumber.formatAustralianInput(newValue)
                    if formatted != newValue { phoneText = formatted }
                    errorMessage = nil
                }
            if phoneValid {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(Color.accentColor)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .padding(.horizontal, 18)
        .frame(height: 60)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(focused == .phone ? Color.accentColor : Color.clear, lineWidth: 1.5)
        }
        .animation(.easeOut(duration: 0.2), value: focused)
        .animation(.spring(response: 0.3, dampingFraction: 0.6), value: phoneValid)
        .contentShape(Rectangle())
        .onTapGesture { focused = .phone }
    }

    private var agreementRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Button {
                agreed.toggle()
                if agreed, errorMessage == Self.agreementMessage { errorMessage = nil }
            } label: {
                Image(systemName: agreed ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(agreed ? Color.accentColor : Color.secondary)
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(agreed ? "已同意用户协议和隐私政策" : "同意用户协议和隐私政策")

            Text(agreementText)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }

    /// 「我已阅读并同意《用户协议》和《隐私政策》」，两个书名号可以点开。
    private var agreementText: AttributedString {
        var text = AttributedString(localized: "我已阅读并同意")
        if let terms = LegalLinks.terms(server: session.serverURL),
           let privacy = LegalLinks.privacy(server: session.serverURL) {
            var termsLink = AttributedString(localized: "《用户协议》")
            termsLink.link = terms
            termsLink.swiftUI.foregroundColor = .accentColor
            var privacyLink = AttributedString(localized: "《隐私政策》")
            privacyLink.link = privacy
            privacyLink.swiftUI.foregroundColor = .accentColor
            text += termsLink + AttributedString(localized: "和") + privacyLink
        }
        return text
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
                    .frame(width: 44, height: 44)
                    .background(.background.secondary, in: Circle())
            }
            .tint(.primary)
            .disabled(isWorking)
            .padding(.top, 16)

            Text("输入验证码")
                .font(.largeTitle.bold())
                .padding(.top, 28)
            HStack(spacing: 4) {
                Text("已发送至 \(PhoneFormat.display(phone))")
                Button("修改") {
                    sentTo = nil
                    code = ""
                    errorMessage = nil
                    focused = .phone
                }
                .font(.subheadline.weight(.semibold))
                .disabled(isWorking)
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding(.top, 8)

            CodeBoxes(code: code, length: Self.codeLength, isActive: focused == .code, isWorking: isWorking)
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
                .modifier(Shake(animatableData: CGFloat(codeShakes)))
                .padding(.top, 36)
                .onChange(of: code) { _, newValue in
                    let digits = String(newValue.filter(\.isNumber).prefix(Self.codeLength))
                    if digits != newValue {
                        code = digits
                        return
                    }
                    if digits.count == Self.codeLength { verify() }
                }

            errorLine

            TimelineView(.periodic(from: .now, by: 1)) { context in
                let wait = Int(throttle.waitTime(now: context.date).rounded(.up))
                Button {
                    resend(phone: phone)
                } label: {
                    Label(wait > 0 ? String(localized: "\(Self.waitLabel(wait)) 后可重新发送") : String(localized: "重新发送验证码"),
                          systemImage: "arrow.clockwise")
                        .font(.subheadline.weight(.medium))
                }
                .disabled(isWorking || wait > 0)
            }
            .padding(.top, 28)
            .padding(.bottom, 24)
        }
    }

    // MARK: - 组件

    @ViewBuilder
    private var errorLine: some View {
        if let errorMessage {
            Label(errorMessage, systemImage: "exclamationmark.circle.fill")
                .font(.footnote)
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 12)
                .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }

    private static let agreementMessage = String(localized: "请先阅读并勾选同意用户协议和隐私政策")

    /// 「45 秒」或「12 分钟」
    static func waitLabel(_ seconds: Int) -> String {
        seconds >= 60 ? String(localized: "\((seconds + 59) / 60) 分钟") : String(localized: "\(seconds) 秒")
    }

    // MARK: - 操作

    private func submitPhone() {
        guard phoneValid else {
            errorMessage = String(localized: "请输入澳洲手机号，例如 0412 345 678")
            return
        }
        guard agreed else {
            errorMessage = Self.agreementMessage
            withAnimation(.default) { agreementShakes += 1 }
            return
        }
        let wait = Int(throttle.waitTime().rounded(.up))
        guard wait == 0 else {
            errorMessage = String(localized: "发送太频繁，请 \(Self.waitLabel(wait)) 后再试")
            return
        }
        run {
            let phone = try await session.sendCode(phoneText: phoneText)
            throttle.recordSend()
            code = ""
            sentTo = phone
            focused = .code
        }
    }

    private func resend(phone: String) {
        guard throttle.waitTime() == 0 else { return }
        run {
            try await session.resendCode(phone: phone)
            throttle.recordSend()
        }
    }

    private func verify() {
        guard let sentTo else { return }
        run {
            do {
                try await session.verify(phone: sentTo, code: code)
            } catch {
                code = ""
                withAnimation(.default) { codeShakes += 1 }
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

// MARK: - 视觉组件

/// 主按钮：按下时轻微缩小
private struct PrimaryButton: View {
    let title: LocalizedStringKey
    let isWorking: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(title).opacity(isWorking ? 0 : 1)
                if isWorking { ProgressView().tint(.white) }
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
        }
        .buttonStyle(PressableProminentStyle())
    }
}

private struct PressableProminentStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.white)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(isEnabled ? Color.accentColor : Color.accentColor.opacity(0.35))
            )
            .shadow(color: isEnabled ? Color.accentColor.opacity(0.3) : .clear, radius: 12, y: 6)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
            .animation(.easeOut(duration: 0.2), value: isEnabled)
    }
}

/// 左右抖动，用于提示「还没勾选协议」「验证码不对」
private struct Shake: GeometryEffect {
    var animatableData: CGFloat

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 8 * sin(animatableData * .pi * 4), y: 0))
    }
}

/// 背景：两团缓慢漂移的主题色光晕。开启「减弱动态效果」时保持静止。
private struct LoginBackground: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drift = false

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            ZStack {
                Circle()
                    .fill(Color.accentColor.opacity(0.22))
                    .frame(width: width * 0.9)
                    .offset(x: drift ? -width * 0.25 : -width * 0.1, y: drift ? -40 : -90)
                Circle()
                    .fill(Color(red: 0.48, green: 0.77, blue: 0.67).opacity(0.25))
                    .frame(width: width * 0.75)
                    .offset(x: drift ? width * 0.3 : width * 0.15, y: drift ? 20 : -30)
            }
            .blur(radius: 70)
            .frame(width: width, height: proxy.size.height * 0.55, alignment: .top)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 7).repeatForever(autoreverses: true)) { drift = true }
        }
    }
}

/// 验证码格子：每格一位数字，当前格子描边高亮，并有闪烁的光标。
private struct CodeBoxes: View {
    let code: String
    let length: Int
    let isActive: Bool
    let isWorking: Bool

    var body: some View {
        HStack(spacing: 10) {
            ForEach(0..<length, id: \.self) { index in
                let chars = Array(code)
                let digit = index < chars.count ? String(chars[index]) : ""
                let isCurrent = isActive && !isWorking && index == min(code.count, length - 1) && code.count < length
                ZStack {
                    Text(digit)
                        .font(.title.monospacedDigit().weight(.semibold))
                        .contentTransition(.numericText())
                    if isCurrent && digit.isEmpty { Caret() }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 60)
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(isCurrent ? Color.accentColor : (digit.isEmpty ? Color.clear : Color.accentColor.opacity(0.35)), lineWidth: 1.5)
                }
                .scaleEffect(isCurrent ? 1.04 : 1)
                .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isCurrent)
            }
        }
        .opacity(isWorking ? 0.6 : 1)
    }
}

private struct Caret: View {
    @State private var visible = true

    var body: some View {
        RoundedRectangle(cornerRadius: 1)
            .fill(Color.accentColor)
            .frame(width: 2, height: 26)
            .opacity(visible ? 1 : 0)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.55).repeatForever()) { visible = false }
            }
    }
}
