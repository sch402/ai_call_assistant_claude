import Foundation
import SwiftUI

struct AppConfig: Decodable, Equatable {
    let twilioNumber: String
    let ownerName: String?
    /// 当前登录的手机号（E.164）
    let phone: String?
    /// 是否机主（OWNER_PHONE_NUMBER）。原型阶段只有机主能拉黑号码。
    let isOwner: Bool?
}

/// 一通来电，对应后端 calls 表。字段都按可选处理：通话进行中时还没有摘要。
struct CallRecord: Decodable, Identifiable, Hashable {
    let id: String
    let createdAt: Date
    let fromNumber: String?
    let forwardedFrom: String?
    let attributed: Bool?
    let status: String?
    let matchMethod: String?
    let endedReason: String?
    let durationSeconds: Double?
    let summary: String?
    let structured: CallAnalysis?
    let transcript: String?
}

/// 通话结束后 AI 提取的结构化信息（lib/assistant.js 里的 STRUCTURED_SCHEMA）。
struct CallAnalysis: Decodable, Hashable {
    let callerName: String?
    let organization: String?
    let purpose: String?
    let callbackNumber: String?
    let deadline: String?
    let category: String?
    let urgency: String?
    let scamRisk: Double?
    let scamReasons: [String]?
    let language: String?
    let recommendedAction: String?
    let summaryZh: String?
}

enum CallCategory: String, CaseIterable {
    case scam, telemarketing, robocall, business, personal, unknown

    var label: String {
        switch self {
        case .scam: return String(localized: "疑似诈骗")
        case .telemarketing: return String(localized: "推销")
        case .robocall: return String(localized: "机器人外呼")
        case .business: return String(localized: "正常事务")
        case .personal: return String(localized: "私人来电")
        case .unknown: return String(localized: "未分类")
        }
    }

    var symbol: String {
        switch self {
        case .scam: return "exclamationmark.shield.fill"
        case .telemarketing: return "megaphone.fill"
        case .robocall: return "waveform"
        case .business: return "building.2.fill"
        case .personal: return "person.fill"
        case .unknown: return "phone.fill"
        }
    }

    var tint: Color {
        switch self {
        case .scam: return .red
        case .telemarketing, .robocall: return .orange
        case .business: return .accentColor
        case .personal: return .green
        case .unknown: return .gray
        }
    }

    var isNuisance: Bool { self == .scam || self == .telemarketing || self == .robocall }
}

extension CallRecord {
    var category: CallCategory {
        if (structured?.scamRisk ?? 0) >= 70 { return .scam }
        return CallCategory(rawValue: structured?.category ?? "") ?? .unknown
    }

    var isBlocked: Bool { status == "blocked" }
    var isInProgress: Bool { status == "answering" }

    /// 列表标题：对方自称的名字和机构，没有就显示号码。
    var title: String {
        let parts = [structured?.callerName, structured?.organization]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && $0.lowercased() != "unknown" }
        if !parts.isEmpty { return parts.joined(separator: " · ") }
        return fromNumber.map(PhoneFormat.display) ?? String(localized: "未知来电")
    }

    var headline: String {
        if isBlocked { return String(localized: "黑名单号码，已直接拒接") }
        if isInProgress { return String(localized: "通话中，或通话报告尚未生成") }
        return structured?.summaryZh ?? summary ?? String(localized: "没有生成摘要")
    }

    var recommendation: String? {
        switch structured?.recommendedAction {
        case "call_back": return String(localized: "建议回电")
        case "ignore": return String(localized: "可以忽略")
        case "block": return String(localized: "建议拉黑")
        default: return nil
        }
    }

    var urgencyLabel: String? {
        switch structured?.urgency {
        case "high": return String(localized: "紧急")
        case "medium": return String(localized: "一般")
        case "low": return String(localized: "不急")
        default: return nil
        }
    }

    var needsAttention: Bool {
        !category.isNuisance && !isBlocked && structured?.recommendedAction == "call_back"
    }

    /// 只有标准格式（+ 开头）的号码才提供回电和拉黑。
    var dialableNumber: String? {
        guard let number = fromNumber, number.hasPrefix("+"), number.count >= 8 else { return nil }
        return number
    }
}

enum PhoneFormat {
    /// +61412345678 → +61 412 345 678；+61212345678 → +61 2 1234 5678；其他号码原样返回。
    static func display(_ number: String) -> String {
        let digits = number.filter(\.isNumber)
        guard number.hasPrefix("+61"), digits.count == 11 else { return number }
        let national = Array(digits.dropFirst(2))
        let s = String(national)
        if national.first == "4" {
            return "+61 \(s.prefix(3)) \(s.dropFirst(3).prefix(3)) \(s.suffix(3))"
        }
        return "+61 \(s.prefix(1)) \(s.dropFirst(1).prefix(4)) \(s.suffix(4))"
    }
}
