import Foundation

enum APIError: LocalizedError, Equatable {
    case invalidServerURL
    case unauthorized
    case server(String)
    case network(String)
    case decoding

    var errorDescription: String? {
        switch self {
        case .invalidServerURL: return String(localized: "App 没有配置服务地址（project.yml 的 API_HOST）。")
        case .unauthorized: return String(localized: "登录已失效，请重新登录。")
        case .server(let message): return String(localized: "服务出错：\(message)")
        case .network(let message): return String(localized: "网络连接失败：\(message)")
        case .decoding: return String(localized: "服务返回的数据无法识别，请确认后端已更新到最新版本。")
        }
    }
}

/// 后端接口：/api/auth-config（公开）、/api/app-config、/api/calls、/api/admin/blocklist。
/// 除 auth-config 外都带 Supabase 登录令牌；令牌由 AppSession 提供，快过期时自动刷新。
struct APIClient {
    let baseURL: URL
    let accessToken: () async throws -> String
    var session: URLSession = .shared

    /// 登录前调用：取 Supabase 项目地址和 anon key，同时验证服务地址填得对不对。
    static func authConfig(baseURL: URL, session: URLSession = .shared) async throws -> AuthConfig {
        let client = APIClient(baseURL: baseURL, accessToken: { "" }, session: session)
        return try await client.send("api/auth-config", method: "GET", body: Optional<String>.none, authorized: false)
    }

    func appConfig() async throws -> AppConfig {
        try await get("api/app-config")
    }

    func calls() async throws -> [CallRecord] {
        let response: CallsResponse = try await get("api/calls")
        return response.calls
    }

    /// 陌生号码分析：公开网络上这个号码可能属于谁。没找到时返回 nil。
    func lookupNumber(_ number: String) async throws -> NumberLookup? {
        struct Response: Decodable { let lookup: NumberLookup? }
        let response: Response = try await get("api/calls", query: ["lookup": number])
        return response.lookup
    }

    /// 把 StoreKit 2 交易的 JWS 交给后端验证并开通，返回最新的订阅状态。
    func syncSubscription(signedTransaction: String) async throws -> SubscriptionInfo {
        struct Body: Encodable { let signedTransaction: String }
        struct Response: Decodable { let subscription: SubscriptionInfo }
        let response: Response = try await send("api/subscription-sync", method: "POST", body: Body(signedTransaction: signedTransaction))
        return response.subscription
    }

    /// 修改 AI 助手设置，只发送传了的字段。返回保存后的设置。
    func updateProfile(name: String? = nil, gender: VoiceGender? = nil, voiceStyle: VoiceStyle? = nil) async throws -> AssistantProfile {
        struct Body: Encodable { let name: String?; let gender: VoiceGender?; let voiceStyle: VoiceStyle? }
        struct Response: Decodable { let profile: AssistantProfile }
        let response: Response = try await send("api/account", method: "PATCH", body: Body(name: name, gender: gender, voiceStyle: voiceStyle))
        return response.profile
    }

    /// 永久删除账户和来电记录
    func deleteAccount() async throws {
        let _: OKResponse = try await send("api/account", method: "DELETE", body: Optional<String>.none)
    }

    func block(number: String) async throws {
        struct Body: Encodable { let number: String; let reason: String }
        let _: OKResponse = try await send("api/admin/blocklist", method: "POST", body: Body(number: number, reason: "app"))
    }

    // MARK: - 通用请求

    private func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        try await send(path, method: "GET", body: Optional<String>.none, query: query)
    }

    /// 网址加上查询参数。值做严格编码（+ 会变成 %2B，否则服务端会读成空格）。
    static func url(_ base: URL, path: String, query: [String: String]) -> URL {
        let url = base.appending(path: path)
        guard !query.isEmpty, var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        components.percentEncodedQueryItems = query.sorted { $0.key < $1.key }.map {
            URLQueryItem(name: $0.key, value: $0.value.addingPercentEncoding(withAllowedCharacters: .alphanumerics))
        }
        return components.url ?? url
    }

    private func send<T: Decodable, B: Encodable>(_ path: String, method: String, body: B?, authorized: Bool = true,
                                                  query: [String: String] = [:]) async throws -> T {
        var request = URLRequest(url: Self.url(baseURL, path: path, query: query))
        request.httpMethod = method
        request.timeoutInterval = 20
        if authorized {
            let token = try await accessToken()
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.network(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.network("无响应") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        if http.statusCode == 404 && !authorized { throw APIError.server("找不到登录配置接口，请确认后端已部署最新版本") }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error
            throw APIError.server(message ?? "HTTP \(http.statusCode)")
        }
        do {
            return try JSONDecoder.api.decode(T.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }
}

private struct CallsResponse: Decodable { let calls: [CallRecord] }
private struct OKResponse: Decodable { let ok: Bool? }
private struct ErrorResponse: Decodable { let error: String? }

extension JSONDecoder {
    /// 后端字段是 snake_case；时间是 Postgres 的 timestamptz（可能带 6 位小数秒）。
    static let api: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            guard let date = APIDate.parse(text) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "无法解析时间：\(text)")
            }
            return date
        }
        return decoder
    }()
}

enum APIDate {
    /// 支持 "2026-10-19T03:59:50.123456+00:00"、"2026-10-19T03:59:50Z" 等格式。
    static func parse(_ text: String) -> Date? {
        let trimmed = trimFraction(text)
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: trimmed) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: trimmed)
    }

    /// ISO8601DateFormatter 只可靠处理到毫秒，把更长的小数秒截到 3 位。
    static func trimFraction(_ text: String) -> String {
        guard let dot = text.firstIndex(of: ".") else { return text }
        let afterDot = text.index(after: dot)
        var end = afterDot
        while end < text.endIndex, text[end].isNumber { end = text.index(after: end) }
        let digits = text[afterDot..<end]
        guard digits.count > 3 else { return text }
        return String(text[..<afterDot]) + digits.prefix(3) + text[end...]
    }
}
