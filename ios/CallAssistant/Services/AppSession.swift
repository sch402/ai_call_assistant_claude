import Foundation
import Observation

/// 保存「连到哪个服务、用什么口令」，以及服务端返回的基础配置。
/// 原型阶段：口令就是后端的 DASHBOARD_TOKEN；以后换成正式的账号登录。
@MainActor
@Observable
final class AppSession {
    private(set) var serverURL: URL?
    private(set) var config: AppConfig?
    var isConnected: Bool { serverURL != nil && token != nil }

    private var token: String?
    private let defaults: UserDefaults
    private let keychain: KeychainStore

    private static let serverKey = "serverURL"
    private static let tokenAccount = "dashboardToken"

    init(defaults: UserDefaults = .standard, keychain: KeychainStore = KeychainStore()) {
        self.defaults = defaults
        self.keychain = keychain
        if let saved = defaults.string(forKey: Self.serverKey), let url = URL(string: saved),
           let savedToken = keychain.read(account: Self.tokenAccount) {
            serverURL = url
            token = savedToken
        }
    }

    var client: APIClient? {
        guard let serverURL, let token else { return nil }
        return APIClient(baseURL: serverURL, token: token)
    }

    /// 校验地址和口令（调用 /api/app-config），成功后才保存。
    func connect(serverText: String, token newToken: String) async throws {
        guard let url = Self.normalizedServerURL(serverText) else { throw APIError.invalidServerURL }
        let trimmedToken = newToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedToken.isEmpty else { throw APIError.unauthorized }
        let probe = APIClient(baseURL: url, token: trimmedToken)
        let fetched = try await probe.appConfig()
        keychain.save(trimmedToken, account: Self.tokenAccount)
        defaults.set(url.absoluteString, forKey: Self.serverKey)
        serverURL = url
        token = trimmedToken
        config = fetched
    }

    func refreshConfig() async {
        guard let client else { return }
        if let fetched = try? await client.appConfig() { config = fetched }
    }

    func disconnect() {
        keychain.delete(account: Self.tokenAccount)
        defaults.removeObject(forKey: Self.serverKey)
        serverURL = nil
        token = nil
        config = nil
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
