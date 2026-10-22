import StoreKit
import SwiftUI

/// 订阅页（来电助手 Pro）。按苹果审核要求，页面上要有价格、周期、自动续期说明、恢复购买、使用条款和隐私政策链接。
struct SubscriptionView: View {
    @Environment(AppSession.self) private var session
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var selectedID: String?
    @State private var showManage = false

    private var subscription: SubscriptionInfo? { session.config?.subscription }
    private var isSubscribed: Bool { subscription?.state == .active }
    private var selected: Product? { store.products.first { $0.id == selectedID } ?? store.products.first }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    header
                    features
                    if isSubscribed {
                        subscribedCard
                    } else {
                        plans
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            .safeAreaInset(edge: .bottom) {
                if !isSubscribed { purchaseBar }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title2)
                            .symbolRenderingMode(.hierarchical)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .task { await store.loadProducts() }
            .manageSubscriptionsSheet(isPresented: $showManage)
            .onChange(of: showManage) { _, isShowing in
                // 用户可能在系统页面里取消了订阅，回来时刷新一次
                if !isShowing { Task { await session.refreshConfig() } }
            }
        }
    }

    // MARK: - 内容

    private var header: some View {
        VStack(spacing: 12) {
            Image("LaunchLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 44, height: 44)
                .padding(14)
                .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            Text("来电助手 Pro")
                .font(.title.bold())
        }
    }

    private var features: some View {
        VStack(alignment: .leading, spacing: 16) {
            FeatureRow(symbol: "phone.arrow.down.left", text: "没接的电话由 AI 接听，不限分钟")
            FeatureRow(symbol: "character.bubble", text: "中英文自动切换")
            FeatureRow(symbol: "exclamationmark.shield", text: "识别诈骗和推销电话")
            FeatureRow(symbol: "text.bubble", text: "每通电话都有中文摘要")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var subscribedCard: some View {
        VStack(spacing: 14) {
            Label("已订阅", systemImage: "checkmark.seal.fill")
                .font(.headline)
                .foregroundStyle(Color.accentColor)
            if let expires = subscription?.expiresAt {
                let date = expires.formatted(date: .long, time: .omitted)
                Text(subscription?.autoRenew == false
                     ? String(localized: "\(date) 到期，不再续费")
                     : String(localized: "下次续费：\(date)"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Button("管理订阅") { showManage = true }
                .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    @ViewBuilder
    private var plans: some View {
        if store.products.isEmpty {
            if store.isLoadingProducts {
                ProgressView().frame(height: 80)
            } else if let message = store.errorMessage {
                Text(message).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
        } else {
            VStack(spacing: 12) {
                ForEach(store.products) { product in
                    PlanCard(product: product, isSelected: product.id == selected?.id)
                        .onTapGesture { selectedID = product.id }
                }
            }
        }
    }

    private var purchaseBar: some View {
        VStack(spacing: 10) {
            if let message = store.errorMessage, !store.products.isEmpty {
                Text(message).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
            }
            Button {
                guard let selected else { return }
                Task {
                    if await store.purchase(selected, session: session) { dismiss() }
                }
            } label: {
                ZStack {
                    Text("订阅").opacity(store.isPurchasing ? 0 : 1)
                    if store.isPurchasing { ProgressView().tint(.white) }
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 16))
            .disabled(selected == nil || store.isPurchasing)

            Text("订阅按所选周期自动续费，可随时在系统设置中取消。")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            HStack(spacing: 16) {
                Button("恢复购买") { Task { await store.restore(session: session) } }
                    .disabled(store.isPurchasing)
                if let terms = LegalLinks.terms(server: session.serverURL) {
                    Link("使用条款", destination: terms)
                }
                if let privacy = LegalLinks.privacy(server: session.serverURL) {
                    Link("隐私政策", destination: privacy)
                }
            }
            .font(.caption)
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(.bar)
    }
}

private struct FeatureRow: View {
    let symbol: String
    let text: LocalizedStringKey

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(width: 28)
            Text(text)
        }
    }
}

private struct PlanCard: View {
    let product: Product
    let isSelected: Bool

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(product.displayName).font(.headline)
                if let offer = introOffer {
                    Text(offer).font(.caption).foregroundStyle(Color.accentColor)
                }
            }
            Spacer()
            Text(priceLabel).font(.headline.monospacedDigit())
        }
        .padding(18)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(isSelected ? Color.accentColor : .clear, lineWidth: 2)
        }
        .contentShape(Rectangle())
    }

    private var priceLabel: String {
        guard let period = product.subscription?.subscriptionPeriod else { return product.displayPrice }
        return "\(product.displayPrice) / \(period.label)"
    }

    /// 免费试用等首次优惠。是否有资格由苹果在付款页面最终确认。
    private var introOffer: String? {
        guard let offer = product.subscription?.introductoryOffer else { return nil }
        switch offer.paymentMode {
        case .freeTrial: return String(localized: "免费试用 \(offer.period.duration)")
        default: return nil
        }
    }
}

enum LegalLinks {
    /// 后端 public/terms.html（用户协议，订阅页按苹果要求必须链接）
    static func terms(server: URL?) -> URL? {
        server?.appending(path: "terms.html")
    }

    /// 后端 public/privacy.html
    static func privacy(server: URL?) -> URL? {
        server?.appending(path: "privacy.html")
    }
}
