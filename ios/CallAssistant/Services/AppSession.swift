import Foundation
import Observation

/// 保存「连到哪个服务、谁登录了」，以及服务端返回的基础配置。
/// 登录方式：手机号 + 短信验证码（Supabase Auth）。登录的手机号就是被转移来电的那个号码。
@MainActor
@Observable
final class AppSession {
    private(set) var serverURL: URL?
    private(set) var authConfig: AuthConfig?
    private(set) var config: AppConfig?
    var isSignedIn: Bool { serverURL != nil && authConfig != nil && tokens != nil }
    var phone: String? { tokens?.phone }

    private var tokens: AuthTokens?
    @ObservationIgnored private var refreshTask: Task<AuthTokens, Error>?
    private let defaults: UserDefaults
    private let keychain: KeychainStore

    private static let serverKey = "serverURL"
    private static let authConfigKey = "authConfig"
    private static let tokensAccount = "authTokens"
    /// 旧版本用访问口令连接，升级后清掉
    private static let legacyTokenAccount = "dashboardToken"

    init(defaults: UserDefaults = .standard, keychain: KeychainStore = KeychainStore()) {
        self.defaults = defaults
        self.keychain = keychain
        keychain.delete(account: Self.legacyTokenAccount)
        if let saved = defaults.string(forKey: Self.serverKey) {
            serverURL = URL(string: saved)
        }
        if let data = defaults.data(forKey: Self.authConfigKey) {
            authConfig = try? JSONDecoder().decode(AuthConfig.self, from: data)
        }
        if let json = keychain.read(account: Self.tokensAccount) {
            tokens = try? JSONDecoder().decode(AuthTokens.self, from: Data(json.utf8))
        }
    }

    /// 登录页预填上次用过的服务地址
    var savedServerText: String { serverURL?.host() ?? "" }

    var client: APIClient? {
        guard let serverURL, isSignedIn else { return nil }
        return APIClient(baseURL: serverURL) { [weak self] in
            guard let self else { throw APIError.unauthorized }
            return try await self.validAccessToken()
        }
    }

    // MARK: - 登录

    /// 第一步：确认服务地址可用（取 /api/auth-config），再让 Supabase 发验证码。返回整理后的 E.164 号码。
    func sendCode(serverText: String, phoneText: String) async throws -> String {
        guard let url = Self.normalizedServerURL(serverText) else { throw APIError.invalidServerURL }
        guard let phone = PhoneNumber.e164(phoneText) else { throw AuthError.invalidPhone }
        let fetched = try await APIClient.authConfig(baseURL: url)
        try await SupabaseAuth(config: fetched).sendCode(phone: phone)
        serverURL = url
        authConfig = fetched
        defaults.set(url.absoluteString, forKey: Self.serverKey)
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

    func refreshConfig() async {
        guard let client else { return }
        if let fetched = try? await client.appConfig() { config = fetched }
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
