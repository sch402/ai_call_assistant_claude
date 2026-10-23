import Foundation

/// 陌生号码分析结果（后端 lib/lookup.js）。只有在公开网页里找到明确证据时才有。
struct NumberLookup: Decodable, Equatable {
    enum Kind: String, Decodable {
        case person, business
        case spamReport = "spam_report"
    }

    let kind: Kind
    let name: String?
    let role: String?
    let organization: String?
    /// 0–100
    let confidence: Int
    let sources: [String]

    /// 主标题：名字；被举报的号码用角色（例如「被举报为推销电话」）
    var headline: String { name ?? role ?? "" }

    /// 副标题：「房产中介 · Ray White」
    var detail: String? {
        let parts = [name == nil ? nil : role, organization].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var sourceURL: URL? { sources.first.flatMap(URL.init(string:)) }

    var sourceHost: String? {
        sourceURL?.host()?.replacingOccurrences(of: "www.", with: "")
    }
}
