import Foundation

/// 后端 /api/auth-config 返回的 Supabase 项目地址和 anon key（公开的，存 UserDefaults 即可）。
struct AuthConfig: Codable, Equatable {
    let supabaseUrl: URL
    let supabaseAnonKey: String
}

/// 登录凭证。存进钥匙串。访问令牌约 1 小时过期，用刷新令牌换新的。
struct AuthTokens: Codable, Equatable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    let userID: String
    /// E.164，例如 +61412345678
    let phone: String

    /// 提前一分钟当作过期，避免请求途中失效。
    func isExpired(now: Date = Date()) -> Bool {
        now.addingTimeInterval(60) >= expiresAt
    }
}

enum AuthError: LocalizedError, Equatable {
    case invalidPhone
    case invalidCode
    case rateLimited
    case sessionExpired
    case server(String)
    case network(String)

    var errorDescription: String? {
        switch self {
        case .invalidPhone: return String(localized: "请输入澳洲手机号，例如 0412 345 678。")
        case .invalidCode: return String(localized: "验证码不正确或已过期，请重新获取。")
        case .rateLimited: return String(localized: "请求太频繁，请稍后再试。")
        case .sessionExpired: return String(localized: "登录已过期，请重新登录。")
        case .server(let message): return String(localized: "登录服务出错：\(message)")
        case .network(let message): return String(localized: "网络连接失败：\(message)")
        }
    }
}

/// Supabase Auth 的手机号验证码登录，直接调 REST 接口（/auth/v1/otp、/verify、/token、/logout），不引入 SDK。
/// 短信由 Supabase 里配置的 Twilio Verify 发送。
struct SupabaseAuth {
    let config: AuthConfig
    var session: URLSession = .shared

    /// 发送验证码。号码不存在时 Supabase 会自动注册（可在 Supabase 后台关闭注册）。
    func sendCode(phone: String) async throws {
        struct Body: Encodable { let phone: String; let create_user = true }
        _ = try await post("otp", body: Body(phone: phone))
    }

    func verify(phone: String, code: String) async throws -> AuthTokens {
        struct Body: Encodable { let type = "sms"; let phone: String; let token: String }
        let data = try await post("verify", body: Body(phone: phone, token: code))
        return try Self.decodeTokens(data)
    }

    func refresh(_ tokens: AuthTokens) async throws -> AuthTokens {
        struct Body: Encodable { let refresh_token: String }
        let data = try await post("token", query: [URLQueryItem(name: "grant_type", value: "refresh_token")],
                                  body: Body(refresh_token: tokens.refreshToken))
        return try Self.decodeTokens(data)
    }

    /// 让服务端作废刷新令牌。失败也无所谓，本地凭证照样删除。
    func signOut(_ tokens: AuthTokens) async {
        struct Empty: Encodable {}
        _ = try? await post("logout", body: Empty(), bearer: tokens.accessToken)
    }

    // MARK: - 请求

    private func post<B: Encodable>(_ path: String, query: [URLQueryItem] = [], body: B, bearer: String? = nil) async throws -> Data {
        var url = config.supabaseUrl.appending(path: "auth/v1").appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue(config.supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(bearer ?? config.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw AuthError.network(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw AuthError.network("无响应") }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.error(status: http.statusCode, data: data)
        }
        return data
    }

    /// Supabase Auth 的错误有新旧两种格式：{code, error_code, msg} 和 {error, error_description}。
    static func error(status: Int, data: Data) -> AuthError {
        struct Body: Decodable {
            let error_code: String?
            let msg: String?
            let message: String?
            let error: String?
            let error_description: String?
        }
        let body = try? JSONDecoder().decode(Body.self, from: data)
        let code = body?.error_code ?? body?.error ?? ""
        let message = body?.msg ?? body?.error_description ?? body?.message ?? "HTTP \(status)"
        if status == 429 || code.hasPrefix("over_") { return .rateLimited }
        switch code {
        case "otp_expired", "otp_disabled": return .invalidCode
        case "validation_failed" where message.localizedCaseInsensitiveContains("phone"): return .invalidPhone
        case "refresh_token_not_found", "refresh_token_already_used", "session_not_found", "session_expired", "invalid_grant":
            return .sessionExpired
        default:
            if message.localizedCaseInsensitiveContains("token has expired or is invalid") { return .invalidCode }
            if message.localizedCaseInsensitiveContains("invalid phone") { return .invalidPhone }
            return .server(message)
        }
    }

    static func decodeTokens(_ data: Data, now: Date = Date()) throws -> AuthTokens {
        struct User: Decodable { let id: String; let phone: String? }
        struct Body: Decodable {
            let access_token: String
            let refresh_token: String
            let expires_in: Double
            let user: User
        }
        guard let body = try? JSONDecoder().decode(Body.self, from: data),
              let phone = PhoneNumber.e164(body.user.phone ?? "", allowBareInternational: true) else {
            throw AuthError.server("返回的登录信息无法识别")
        }
        return AuthTokens(accessToken: body.access_token, refreshToken: body.refresh_token,
                          expiresAt: now.addingTimeInterval(body.expires_in), userID: body.user.id, phone: phone)
    }
}

/// 把用户输入（或键盘自动填入）的号码整理成 E.164。
/// 默认按澳洲号码解读：服务用的是澳洲 Twilio 号码，用户也是在澳洲设置呼叫转移。
enum PhoneNumber {
    static let defaultCountryCode = "61"

    /// - Parameter allowBareInternational: Supabase 返回的号码不带 +（61412345678），这种情况按已含国家码处理。
    static func e164(_ text: String, allowBareInternational: Bool = false) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let digits = trimmed.filter(\.isASCIIDigit)
        guard !digits.isEmpty else { return nil }
        let candidate: String
        if trimmed.hasPrefix("+") || allowBareInternational {
            candidate = digits
        } else if digits.hasPrefix("00") {
            candidate = String(digits.dropFirst(2))
        } else if digits.hasPrefix("0") {
            // 国内格式：0412 345 678 → +61 412 345 678
            candidate = defaultCountryCode + String(digits.dropFirst())
        } else if digits.hasPrefix(defaultCountryCode) && digits.count == 11 {
            candidate = digits
        } else if digits.count == 9 {
            // 省略了开头 0 的澳洲号码：412 345 678
            candidate = defaultCountryCode + digits
        } else {
            return nil
        }
        guard (8...15).contains(candidate.count), !candidate.hasPrefix("0") else { return nil }
        if candidate.hasPrefix(defaultCountryCode), candidate.count != 11 { return nil }
        return "+" + candidate
    }
}

extension PhoneNumber {
    /// 登录只接受澳洲手机号（+61 4xx xxx xxx）：服务用的是澳洲号码，也避免把验证码发到海外号码产生高额短信费。
    static func isAustralianMobile(_ e164: String?) -> Bool {
        guard let e164 else { return false }
        return e164.hasPrefix("+614") && e164.count == 12
    }

    /// 输入框里的显示格式：412 345 678（或 0412 345 678）。键盘自动填入的 +61 412 345 678 会去掉国家码。
    static func formatAustralianInput(_ text: String) -> String {
        var digits = text.filter(\.isASCIIDigit)
        if digits.hasPrefix("61"), digits.count >= 11 { digits.removeFirst(2) }
        let maxLength = digits.hasPrefix("0") ? 10 : 9
        digits = String(digits.prefix(maxLength))
        let groups = digits.hasPrefix("0") ? [4, 3, 3] : [3, 3, 3]
        var parts: [String] = []
        var rest = Substring(digits)
        for size in groups where !rest.isEmpty {
            parts.append(String(rest.prefix(size)))
            rest = rest.dropFirst(size)
        }
        return parts.joined(separator: " ")
    }
}

private extension Character {
    var isASCIIDigit: Bool { isASCII && isNumber }
}
