import Foundation

enum APIError: LocalizedError, Equatable {
    case invalidServerURL
    case unauthorized
    case server(String)
    case network(String)
    case decoding

    var errorDescription: String? {
        switch self {
        case .invalidServerURL: return String(localized: "服务地址不正确，请填写形如 xxx.vercel.app 的网址。")
        case .unauthorized: return String(localized: "口令不正确。")
        case .server(let message): return String(localized: "服务出错：\(message)")
        case .network(let message): return String(localized: "网络连接失败：\(message)")
        case .decoding: return String(localized: "服务返回的数据无法识别，请确认后端已更新到最新版本。")
        }
    }
}

/// 后端接口：/api/app-config、/api/calls、/api/admin/blocklist。
struct APIClient {
    let baseURL: URL
    let token: String
    var session: URLSession = .shared

    func appConfig() async throws -> AppConfig {
        try await get("api/app-config")
    }

    func calls() async throws -> [CallRecord] {
        let response: CallsResponse = try await get("api/calls")
        return response.calls
    }

    func block(number: String) async throws {
        struct Body: Encodable { let number: String; let reason: String }
        let _: OKResponse = try await send("api/admin/blocklist", method: "POST", body: Body(number: number, reason: "app"))
    }

    // MARK: - 通用请求

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await send(path, method: "GET", body: Optional<String>.none)
    }

    private func send<T: Decodable, B: Encodable>(_ path: String, method: String, body: B?) async throws -> T {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
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
