import Foundation
import Observation
import StoreKit

/// 苹果内购（StoreKit 2 自动续期订阅）。
/// 购买时把 Supabase 用户 ID 作为 appAccountToken 传给苹果；拿到交易后交给后端 /api/subscription-sync 验证，
/// 后端确认后才 finish。后端没确认的交易不 finish，下次启动时 Transaction.updates 会再给一次。
@MainActor
@Observable
final class Store {
    private(set) var products: [Product] = []
    private(set) var isLoadingProducts = false
    private(set) var isPurchasing = false
    var errorMessage: String?

    /// project.yml 的 IAP_PRODUCT_IDS（逗号分隔），需要和 App Store Connect 里创建的产品 ID 一致
    nonisolated static var productIDs: [String] {
        let raw = Bundle.main.object(forInfoDictionaryKey: "IAPProductIDs") as? String ?? ""
        return raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    @ObservationIgnored private var updatesTask: Task<Void, Never>?

    func loadProducts() async {
        guard products.isEmpty, !isLoadingProducts else { return }
        isLoadingProducts = true
        defer { isLoadingProducts = false }
        do {
            let ids = Self.productIDs
            let loaded = try await Product.products(for: ids)
            // 按 project.yml 里的顺序展示
            products = loaded.sorted { (ids.firstIndex(of: $0.id) ?? 0) < (ids.firstIndex(of: $1.id) ?? 0) }
            if products.isEmpty { errorMessage = String(localized: "暂时无法获取订阅方案，请稍后再试。") }
        } catch {
            errorMessage = String(localized: "暂时无法获取订阅方案：\(error.localizedDescription)")
        }
    }

    /// 购买成功并经后端确认后返回 true；用户取消或等待家长批准时返回 false。
    func purchase(_ product: Product, session: AppSession) async -> Bool {
        guard !isPurchasing else { return false }
        guard let userID = session.userID, let token = UUID(uuidString: userID) else {
            errorMessage = AuthError.sessionExpired.localizedDescription
            return false
        }
        isPurchasing = true
        errorMessage = nil
        defer { isPurchasing = false }
        do {
            switch try await product.purchase(options: [.appAccountToken(token)]) {
            case .success(let verification):
                return try await handle(verification, session: session)
            case .pending:
                errorMessage = String(localized: "购买正在等待确认（例如家长批准），完成后会自动开通。")
                return false
            case .userCancelled:
                return false
            @unknown default:
                return false
            }
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    /// 恢复购买：和 App Store 同步一次，再把当前有效的订阅交给后端。
    func restore(session: AppSession) async {
        isPurchasing = true
        errorMessage = nil
        defer { isPurchasing = false }
        do {
            try await AppStore.sync()
            var found = false
            for await verification in Transaction.currentEntitlements {
                if case .verified(let transaction) = verification, transaction.productType == .autoRenewable {
                    found = try await handle(verification, session: session) || found
                }
            }
            if !found { errorMessage = String(localized: "这个 Apple ID 没有可恢复的订阅。") }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// App 启动后一直监听：续费、在其他设备购买、家长批准后的交易都从这里来。
    func observeTransactionUpdates(session: AppSession) {
        guard updatesTask == nil else { return }
        updatesTask = Task { [weak self] in
            for await verification in Transaction.updates {
                guard let self, session.isSignedIn else { continue }
                _ = try? await self.handle(verification, session: session)
            }
        }
    }

    /// 后端确认后才 finish，并用后端返回的状态刷新界面。
    private func handle(_ verification: VerificationResult<Transaction>, session: AppSession) async throws -> Bool {
        guard case .verified(let transaction) = verification else {
            throw APIError.server(String(localized: "购买凭证校验失败"))
        }
        guard let client = session.client else { throw AuthError.sessionExpired }
        let subscription = try await client.syncSubscription(signedTransaction: verification.jwsRepresentation)
        await transaction.finish()
        session.apply(subscription: subscription)
        return subscription.isAnswering
    }
}

extension Product.SubscriptionPeriod {
    /// 「月」「年」「3 个月」「7 天」
    var label: String {
        switch unit {
        case .day: return value == 7 ? String(localized: "周") : String(localized: "\(value) 天")
        case .week: return value == 1 ? String(localized: "周") : String(localized: "\(value) 周")
        case .month: return value == 1 ? String(localized: "月") : String(localized: "\(value) 个月")
        case .year: return value == 1 ? String(localized: "年") : String(localized: "\(value) 年")
        @unknown default: return ""
        }
    }

    /// 「7 天」「1 个月」，用于免费试用时长
    var duration: String {
        switch unit {
        case .day: return String(localized: "\(value) 天")
        case .week: return String(localized: "\(value * 7) 天")
        case .month: return String(localized: "\(value) 个月")
        case .year: return String(localized: "\(value) 年")
        @unknown default: return ""
        }
    }
}
