import SwiftUI

/// 首次打开 App 时的功能介绍：4 页左右滑动，每页一个动态插图（模拟 App 界面）+ 一句标题。
/// 看完或点「跳过」后进入登录页，之后不再显示（RootView 用 @AppStorage("intro.seen") 记录）。
struct IntroView: View {
    let onFinish: () -> Void
    @State private var page = 0

    private let pages: [IntroPage] = [
        IntroPage(title: "不方便接？AI 替你接", subtitle: "开会、开车、陌生号码，都交给 AI", art: .answer),
        IntroPage(title: "来意，一眼看清", subtitle: "挂断几秒，中文摘要直达手机", art: .summary),
        IntroPage(title: "骚扰电话，统统过滤", subtitle: "诈骗、推销、机器人外呼，自动识别", art: .filter),
        IntroPage(title: "中英文，零障碍", subtitle: "英文来电照样接，记录统一中文", art: .bilingual),
    ]

    private var isLast: Bool { page == pages.count - 1 }

    var body: some View {
        ZStack {
            IntroBackground()
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    Button("跳过", action: onFinish)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.75))
                        .padding(.horizontal, 20)
                        .padding(.vertical, 8)
                        .opacity(isLast ? 0 : 1)
                        .disabled(isLast)
                }

                TabView(selection: $page) {
                    ForEach(pages.indices, id: \.self) { index in
                        IntroPageView(page: pages[index], isActive: page == index)
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

                PageDots(count: pages.count, current: page)
                    .padding(.bottom, 22)

                Button {
                    if isLast {
                        onFinish()
                    } else {
                        withAnimation(.snappy) { page += 1 }
                    }
                } label: {
                    Text(isLast ? "开始使用" : "继续")
                        .font(.headline)
                        .foregroundStyle(IntroPalette.deep)
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(.white, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 28)
                .padding(.bottom, 12)
            }
        }
        .preferredColorScheme(.dark)
    }
}

struct IntroPage {
    enum Art { case answer, summary, filter, bilingual }
    let title: String
    let subtitle: String
    let art: Art
}

/// 品牌色：和 App 图标一致的深青绿与薄荷绿
enum IntroPalette {
    static let top = Color(red: 0.180, green: 0.478, blue: 0.412)   // #2E7A69
    static let deep = Color(red: 0.071, green: 0.231, blue: 0.200)  // #123B33
    static let teal = Color(red: 0.141, green: 0.431, blue: 0.369)  // #246E5E
    static let mint = Color(red: 0.596, green: 0.894, blue: 0.784)  // #98E4C8
}

private struct IntroBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [IntroPalette.top, IntroPalette.deep], startPoint: .top, endPoint: .bottom)
            Circle()
                .fill(IntroPalette.mint.opacity(0.22))
                .frame(width: 420, height: 420)
                .blur(radius: 90)
                .offset(x: 150, y: -320)
            Circle()
                .fill(Color.white.opacity(0.07))
                .frame(width: 360, height: 360)
                .blur(radius: 70)
                .offset(x: -170, y: 280)
        }
        .ignoresSafeArea()
    }
}

private struct PageDots: View {
    let count: Int
    let current: Int

    var body: some View {
        HStack(spacing: 8) {
            ForEach(0..<count, id: \.self) { index in
                Capsule()
                    .fill(index == current ? Color.white : Color.white.opacity(0.3))
                    .frame(width: index == current ? 22 : 8, height: 8)
            }
        }
        .animation(.snappy, value: current)
        .accessibilityElement()
        .accessibilityLabel("第 \(current + 1) 页，共 \(count) 页")
    }
}

/// 一页：上面是插图，下面一句标题、一句副标题。插图按 320×380 设计，小屏幕上等比缩小。
private struct IntroPageView: View {
    let page: IntroPage
    let isActive: Bool

    private let artSize = CGSize(width: 320, height: 380)

    var body: some View {
        GeometryReader { geo in
            let available = max(200, geo.size.height - 150)
            let scale = min(1, available / artSize.height, (geo.size.width - 32) / artSize.width)
            VStack(spacing: 0) {
                Spacer(minLength: 4)
                art
                    .frame(width: artSize.width, height: artSize.height)
                    .scaleEffect(scale)
                    .frame(width: artSize.width * scale, height: artSize.height * scale)
                Spacer(minLength: 20)
                Text(page.title)
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(page.subtitle)
                    .font(.body)
                    .foregroundStyle(.white.opacity(0.72))
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
                Spacer(minLength: 12)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
        }
    }

    @ViewBuilder
    private var art: some View {
        switch page.art {
        case .answer: AnswerArt(isActive: isActive)
        case .summary: SummaryArt(isActive: isActive)
        case .filter: FilterArt(isActive: isActive)
        case .bilingual: BilingualArt(isActive: isActive)
        }
    }
}

/// 进入这一页时播放入场动画，离开时复位，下次滑回来再播一遍
private struct AppearOnActive: ViewModifier {
    let isActive: Bool
    @Binding var shown: Bool

    func body(content: Content) -> some View {
        content.onChange(of: isActive, initial: true) { _, active in
            if active {
                withAnimation(.spring(duration: 0.6)) { shown = true }
            } else {
                shown = false
            }
        }
    }
}

private extension View {
    func appearWhen(_ isActive: Bool, shown: Binding<Bool>) -> some View {
        modifier(AppearOnActive(isActive: isActive, shown: shown))
    }

    /// 插图里的白色卡片
    func introCard(cornerRadius: CGFloat = 24) -> some View {
        self
            .background(.white, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .shadow(color: .black.opacity(0.25), radius: 24, y: 12)
            .environment(\.colorScheme, .light)
    }
}

// MARK: - 第 1 页：来电转给 AI 接听

private struct AnswerArt: View {
    let isActive: Bool
    @State private var shown = false

    var body: some View {
        VStack(spacing: 16) {
            // 模拟 iOS 来电
            HStack(spacing: 12) {
                Circle()
                    .fill(.white.opacity(0.18))
                    .frame(width: 50, height: 50)
                    .overlay(Image(systemName: "person.fill").font(.title3).foregroundStyle(.white))
                VStack(alignment: .leading, spacing: 3) {
                    Text("+61 4•• ••• 382").font(.headline).foregroundStyle(.white)
                    Text("来电").font(.caption).foregroundStyle(.white.opacity(0.7))
                }
                Spacer()
                Circle()
                    .fill(Color.red)
                    .frame(width: 46, height: 46)
                    .overlay(Image(systemName: "phone.down.fill").foregroundStyle(.white))
            }
            .padding(14)
            .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(.white.opacity(0.2)))
            .offset(y: shown ? 0 : -24)
            .opacity(shown ? 1 : 0)

            Image(systemName: "arrow.down")
                .font(.title2.weight(.bold))
                .foregroundStyle(IntroPalette.mint)
                .symbolEffect(.pulse, isActive: shown)
                .opacity(shown ? 1 : 0)

            // AI 接听中
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    Image(systemName: "sparkles").foregroundStyle(IntroPalette.teal)
                    Text("AI 正在接听").font(.subheadline.weight(.semibold)).foregroundStyle(IntroPalette.deep)
                    Spacer()
                    Circle().fill(Color.red).frame(width: 8, height: 8)
                        .opacity(shown ? 1 : 0.3)
                        .animation(.easeInOut(duration: 0.8).repeatForever(), value: shown)
                }
                Waveform(isAnimating: isActive)
                    .frame(height: 64)
                Text("“Hi, who's calling?”")
                    .font(.callout.italic())
                    .foregroundStyle(.secondary)
            }
            .padding(20)
            .introCard()
            .scaleEffect(shown ? 1 : 0.9)
            .opacity(shown ? 1 : 0)
            .animation(.spring(duration: 0.6).delay(0.25), value: shown)
        }
        .appearWhen(isActive, shown: $shown)
    }
}

/// 跳动的声波
private struct Waveform: View {
    var isAnimating: Bool
    var barCount = 26

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !isAnimating)) { context in
            let time = context.date.timeIntervalSinceReferenceDate
            HStack(alignment: .center, spacing: 4) {
                ForEach(0..<barCount, id: \.self) { index in
                    let wave = sin(time * 5 + Double(index) * 0.6) * 0.5 + 0.5
                    let envelope = 0.35 + 0.65 * sin(Double(index) / Double(barCount - 1) * .pi)
                    Capsule()
                        .fill(LinearGradient(colors: [IntroPalette.teal, IntroPalette.mint], startPoint: .bottom, endPoint: .top))
                        .frame(width: 5, height: max(6, 64 * (0.25 + 0.75 * wave) * envelope))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

// MARK: - 第 2 页：通知 + 摘要详情

private struct SummaryArt: View {
    let isActive: Bool
    @State private var shown = false

    var body: some View {
        VStack(spacing: 18) {
            // 锁屏通知
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(IntroPalette.teal)
                    .frame(width: 38, height: 38)
                    .overlay(Image("LaunchLogo").resizable().scaledToFit().padding(7))
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text("来电助手").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        Spacer()
                        Text("刚刚").font(.caption2).foregroundStyle(.secondary)
                    }
                    Text("Sarah · City Dental").font(.subheadline.weight(.semibold))
                    Text("确认周五上午 10 点的预约，请回电。").font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(14)
            .introCard(cornerRadius: 22)
            .offset(y: shown ? 0 : -70)
            .opacity(shown ? 1 : 0)

            // 来电详情
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    CategoryBadge(category: .business, size: 46)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Sarah · City Dental").font(.headline)
                        Text("刚刚 · 48 秒").font(.caption).foregroundStyle(.secondary)
                    }
                }
                HStack(spacing: 6) {
                    Tag(text: "正常事务", tint: IntroPalette.teal)
                    Tag(text: "建议回电", tint: IntroPalette.teal)
                    Tag(text: "周四前", tint: .orange)
                }
                Divider()
                IntroInfoRow(label: "来意", value: "确认洗牙预约")
                IntroInfoRow(label: "回电", value: "02 5550 1234")
            }
            .padding(20)
            .introCard()
            .offset(y: shown ? 0 : 50)
            .opacity(shown ? 1 : 0)
            .animation(.spring(duration: 0.7).delay(0.3), value: shown)
        }
        .appearWhen(isActive, shown: $shown)
    }
}

private struct IntroInfoRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).fontWeight(.medium)
        }
        .font(.subheadline)
    }
}

// MARK: - 第 3 页：骚扰电话被拦下

private struct FilterArt: View {
    let isActive: Bool
    @State private var shown = false

    private struct Row: Identifiable {
        let id: Int
        let title: String
        let tag: String
        let category: CallCategory
        let tint: Color
    }

    private let rows = [
        Row(id: 0, title: "自称「中国大使馆」", tag: "疑似诈骗 · 已挂断", category: .scam, tint: .red),
        Row(id: 1, title: "Bright Solar", tag: "推销 · 已拒绝", category: .telemarketing, tint: .orange),
        Row(id: 2, title: "自动语音来电", tag: "机器人外呼 · 已挂断", category: .robocall, tint: .orange),
    ]

    var body: some View {
        ZStack(alignment: .topTrailing) {
            VStack(spacing: 12) {
                ForEach(rows) { row in
                    HStack(spacing: 12) {
                        CategoryBadge(category: row.category, size: 42)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(row.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Tag(text: row.tag, tint: row.tint)
                        }
                        Spacer(minLength: 4)
                        Image(systemName: "xmark.circle.fill")
                            .font(.title3)
                            .foregroundStyle(row.tint.opacity(0.85))
                    }
                    .padding(14)
                    .introCard(cornerRadius: 20)
                    .offset(x: shown ? 0 : 80)
                    .opacity(shown ? 1 : 0)
                    .animation(.spring(duration: 0.6).delay(0.12 * Double(row.id)), value: shown)
                }
            }
            .padding(.top, 52)

            // 盾牌
            Image(systemName: "checkmark.shield.fill")
                .symbolRenderingMode(.palette)
                .foregroundStyle(IntroPalette.deep, IntroPalette.mint)
                .font(.system(size: 54))
                .padding(14)
                .background(Circle().fill(IntroPalette.mint))
                .overlay(Circle().strokeBorder(.white.opacity(0.6), lineWidth: 3))
                .shadow(color: IntroPalette.mint.opacity(0.6), radius: 20)
                .offset(x: 6, y: -6)
                .scaleEffect(shown ? 1 : 0.3)
                .opacity(shown ? 1 : 0)
                .symbolEffect(.bounce, value: shown)
                .animation(.spring(duration: 0.5, bounce: 0.5).delay(0.45), value: shown)
        }
        .appearWhen(isActive, shown: $shown)
    }
}

// MARK: - 第 4 页：英文来电，中文记录

private struct BilingualArt: View {
    let isActive: Bool
    @State private var shown = false

    private struct Line: Identifiable {
        let id: Int
        let text: String
        let fromAI: Bool
    }

    private let lines = [
        Line(id: 0, text: "Hi, this is Sarah from City Dental.", fromAI: false),
        Line(id: 1, text: "Hi Sarah, this is Charlie's AI assistant.", fromAI: true),
        Line(id: 2, text: "Just confirming Friday at 10am.", fromAI: false),
    ]

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 8) {
                LanguageChip(text: "English")
                LanguageChip(text: "普通话")
            }
            .opacity(shown ? 1 : 0)
            .padding(.bottom, 4)

            ForEach(lines) { line in
                ChatBubble(text: line.text, fromAI: line.fromAI)
                    .frame(maxWidth: .infinity, alignment: line.fromAI ? .trailing : .leading)
                    .offset(y: shown ? 0 : 18)
                    .opacity(shown ? 1 : 0)
                    .animation(.spring(duration: 0.5).delay(0.3 + 0.35 * Double(line.id)), value: shown)
            }

            Image(systemName: "arrow.down")
                .font(.headline.weight(.bold))
                .foregroundStyle(IntroPalette.mint)
                .opacity(shown ? 1 : 0)
                .animation(.easeOut.delay(1.3), value: shown)

            VStack(alignment: .leading, spacing: 6) {
                Label("中文摘要", systemImage: "text.bubble.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(IntroPalette.teal)
                Text("City Dental 的 Sarah 确认你周五上午 10 点的预约。")
                    .font(.subheadline.weight(.medium))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .introCard(cornerRadius: 20)
            .scaleEffect(shown ? 1 : 0.9)
            .opacity(shown ? 1 : 0)
            .animation(.spring(duration: 0.6).delay(1.5), value: shown)
        }
        .appearWhen(isActive, shown: $shown)
    }
}

private struct LanguageChip: View {
    let text: String

    var body: some View {
        Label(text, systemImage: "checkmark")
            .font(.caption.weight(.semibold))
            .foregroundStyle(IntroPalette.deep)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(IntroPalette.mint, in: Capsule())
    }
}

private struct ChatBubble: View {
    let text: String
    let fromAI: Bool

    var body: some View {
        VStack(alignment: fromAI ? .trailing : .leading, spacing: 3) {
            Text(fromAI ? "AI" : "来电方")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white.opacity(0.6))
            Text(text)
                .font(.subheadline)
                .foregroundStyle(fromAI ? IntroPalette.deep : .black)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(fromAI ? IntroPalette.mint : .white,
                            in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .frame(maxWidth: 260, alignment: fromAI ? .trailing : .leading)
    }
}

#Preview {
    IntroView(onFinish: {})
}
