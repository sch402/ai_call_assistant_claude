import Foundation
import Observation

/// 保存「谁登录了」，以及服务端返回的基础配置。
/// 登录方式：手机号 + 短信验证码（Supabase Auth）。登录的手机号就是被转移来电的那个号码。
/// 后端地址在编译时写进 Info.plist（project.yml 里的 API_HOST），用户不用填。
@MainActor
@Observable
final class AppSession {
    let serverURL: URL?
    private(set) var authConfig: AuthConfig?
    private(set) var config: AppConfig?
    /// 读取配置失败的原因（只在还没有配置时显示，避免一直卡在加载页）
    private(set) var configError: String?
    /// 当前标签页。放在这里是为了让提示条能跳到「代接设置」。
    var selectedTab: AppTab = .calls
    /// 显示订阅页（来电助手 Pro）
    var showSubscription = false
    var isSignedIn: Bool { serverURL != nil && authConfig != nil && tokens != nil }
    var phone: String? { tokens?.phone }
    /// Supabase 用户 ID，购买时作为 appAccountToken 传给苹果
    var userID: String? { tokens?.userID }

    private var tokens: AuthTokens?
    @ObservationIgnored private var refreshTask: Task<AuthTokens, Error>?
    private let defaults: UserDefaults
    private let keychain: KeychainStore

    private static let authConfigKey = "authConfig"
    private static let tokensAccount = "authTokens"
    /// 旧版本用访问口令连接，升级后清掉
    private static let legacyTokenAccount = "dashboardToken"

    init(defaults: UserDefaults = .standard, keychain: KeychainStore = KeychainStore(),
         serverURL: URL? = AppSession.bundledServerURL) {
        self.defaults = defaults
        self.keychain = keychain
        self.serverURL = serverURL
        keychain.delete(account: Self.legacyTokenAccount)
        defaults.removeObject(forKey: "serverURL")
        if let data = defaults.data(forKey: Self.authConfigKey) {
            authConfig = try? JSONDecoder().decode(AuthConfig.self, from: data)
        }
        if let json = keychain.read(account: Self.tokensAccount) {
            tokens = try? JSONDecoder().decode(AuthTokens.self, from: Data(json.utf8))
        }
    }

    /// Info.plist 里的 APIHost（来自 project.yml 的 API_HOST）
    nonisolated static var bundledServerURL: URL? {
        (Bundle.main.object(forInfoDictionaryKey: "APIHost") as? String).flatMap(normalizedServerURL)
    }

    var client: APIClient? {
        guard let serverURL, isSignedIn else { return nil }
        return APIClient(baseURL: serverURL) { [weak self] in
            guard let self else { throw APIError.unauthorized }
            return try await self.validAccessToken()
        }
    }

    // MARK: - 登录

    /// 第一步：取 Supabase 配置（/api/auth-config），再让 Supabase 发验证码。返回整理后的 E.164 号码。
    func sendCode(phoneText: String) async throws -> String {
        guard let serverURL else { throw APIError.invalidServerURL }
        guard let phone = PhoneNumber.e164(phoneText) else { throw AuthError.invalidPhone }
        let fetched = try await APIClient.authConfig(baseURL: serverURL)
        try await SupabaseAuth(config: fetched).sendCode(phone: phone)
        authConfig = fetched
        defaults.set(try? JSONEncoder().encode(fetched), forKey: Self.authConfigKey)
        return phone
    }

    func resendCode(phone: String) async throws {
        guard let authConfig else { throw AuthError.sessionExpired }
        try await SupabaseAuth(config: authConfig).sendCode(phone: phone)
    }

    /// 第二步：校验验证码，成功即登录。
    func verify(phone: String, code: String) async throws {
        guard let authConfig else { throw AuthError.sessionExpired }
        let trimmed = code.filter(\.isNumber)
        guard trimmed.count >= 6 else { throw AuthError.invalidCode }
        let newTokens = try await SupabaseAuth(config: authConfig).verify(phone: phone, code: trimmed)
        store(newTokens)
        await refreshConfig()
    }

    /// 删除账户。服务端删除成功后清掉本地凭证（登录用户已经不存在，不用再调 Supabase 退出）。
    func deleteAccount() async throws {
        guard let client else { throw AuthError.sessionExpired }
        try await client.deleteAccount()
        clearTokens()
        selectedTab = .calls
    }

    func signOut() async {
        if let authConfig, let tokens {
            await SupabaseAuth(config: authConfig).signOut(tokens)
        }
        clearTokens()
    }

    // MARK: - 令牌

    /// 返回可用的访问令牌，快过期时先刷新。多个请求同时触发时只刷新一次（刷新令牌只能用一次）。
    func validAccessToken() async throws -> String {
        guard let tokens, let authConfig else { throw AuthError.sessionExpired }
        if !tokens.isExpired() { return tokens.accessToken }
        if let refreshTask { return try await refreshTask.value.accessToken }
        let task = Task { try await SupabaseAuth(config: authConfig).refresh(tokens) }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            let refreshed = try await task.value
            store(refreshed)
            return refreshed.accessToken
        } catch AuthError.sessionExpired {
            clearTokens()
            throw AuthError.sessionExpired
        }
    }

    private func store(_ newTokens: AuthTokens) {
        tokens = newTokens
        if let data = try? JSONEncoder().encode(newTokens) {
            keychain.save(String(decoding: data, as: UTF8.self), account: Self.tokensAccount)
        }
    }

    private func clearTokens() {
        keychain.delete(account: Self.tokensAccount)
        tokens = nil
        config = nil
    }

    /// 购买或恢复购买后，用后端返回的订阅状态更新界面，不用等下一次刷新。
    func apply(subscription: SubscriptionInfo) {
        config?.subscription = subscription
    }

    func refreshConfig() async {
        guard let client else { return }
        do {
            config = try await client.appConfig()
            configError = nil
        } catch {
            configError = error.localizedDescription
        }
    }

    /// 修改 AI 助手设置（首次引导和「我的 › AI 助手」共用），成功后立即更新界面。
    func updateProfile(name: String? = nil, gender: VoiceGender? = nil, voiceStyle: VoiceStyle? = nil) async throws {
        guard let client else { throw AuthError.sessionExpired }
        let saved = try await client.updateProfile(name: name, gender: gender, voiceStyle: voiceStyle)
        config?.profile = saved
    }

    /// 允许只填域名：自动补 https://，去掉末尾的 /。
    nonisolated static func normalizedServerURL(_ text: String) -> URL? {
        var value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        while value.hasSuffix("/") { value.removeLast() }
        guard !value.isEmpty else { return nil }
        if !value.lowercased().hasPrefix("http://") && !value.lowercased().hasPrefix("https://") {
            value = "https://" + value
        }
        if value.lowercased().hasPrefix("http://") {
            value = "https://" + value.dropFirst("http://".count)
        }
        guard let url = URL(string: value), let host = url.host, host.contains(".") else { return nil }
        return url
    }
}
