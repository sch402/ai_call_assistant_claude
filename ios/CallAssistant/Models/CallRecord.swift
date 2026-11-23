import Foundation
import SwiftUI

struct AppConfig: Decodable, Equatable {
    let twilioNumber: String
    /// 当前登录的手机号（E.164）
    let phone: String?
    /// AI 助手设置：称呼、性别、音色
    var profile: AssistantProfile?
    var subscription: SubscriptionInfo?

    /// 界面上显示的代接号码：订阅失效或没开通时显示「尚未开通」，不展示号码（转过来也不会接）。
    var twilioNumberLabel: String {
        guard subscription?.isAnswering ?? true else { return String(localized: "尚未开通") }
        return PhoneFormat.display(twilioNumber)
    }
}

/// 订阅状态（后端 lib/entitlement.js）。到期后宽限期内照常代接，之后来电直接拒接。
struct SubscriptionInfo: Decodable, Equatable {
    enum State: String, Decodable {
        case active, grace, expired, none
    }

    let state: State
    let expiresAt: Date?
    let graceEndsAt: Date?
    /// 苹果内购：是否还开着自动续费（nil = 未知或手动开通）
    let autoRenew: Bool?

    /// AI 是否还在代接
    var isAnswering: Bool { state == .active || state == .grace }
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
    /// 号码在公开网页上被举报为骚扰 / 推销电话（陌生号码分析的缓存，后端 api/calls.js 附带）
    let spamReport: SpamReport?
}

struct SpamReport: Decodable, Hashable {
    /// 0–100
    let confidence: Int
}

/// 这通电话现在处于什么阶段（后端 calls.status：answering / ended / completed，以及转写内容）
enum CallPhase: Equatable {
    /// 正在通话（AI 和对方正在说话）
    case live
    /// 已挂断，几秒内会收到 AI 摘要
    case summarizing
    /// 接通后对方没说话就挂断了（多为自动外呼程序）
    case hungUpSilently
    /// 对方没说话，AI 结束了通话
    case silent
    /// 已结束，但没有收到通话报告
    case noReport
    /// 正常结束，有摘要
    case done
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
    var isInProgress: Bool { phase() == .live }
    /// 正在通话或等摘要：界面需要隔几秒刷新一次
    var isUpdating: Bool { [.live, .summarizing].contains(phase()) }
    /// 订阅失效期间转过来的来电：没有接听，直接拒接了
    var isUnpaid: Bool { status == "unpaid" }

    /// 显示用的标题：通讯录里有这个号码就用通讯录的名字，否则用 AI 听到的对方自称，最后才是号码。
    func displayTitle(contactName: String?) -> String {
        contactName ?? title
    }

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
        if isUnpaid { return String(localized: "订阅已过期，这通电话没有接听") }
        switch phase() {
        case .live: return String(localized: "正在通话…")
        case .summarizing: return String(localized: "通话已结束，正在生成摘要…")
        case .hungUpSilently: return String(localized: "对方自动挂断")
        case .silent: return String(localized: "对方没有说话")
        case .noReport: return String(localized: "通话已结束，没有生成摘要")
        case .done: return structured?.summaryZh ?? summary ?? String(localized: "没有生成摘要")
        }
    }

    /// 单次通话最长 MAX_CALL_SECONDS（默认 300 秒）。超过这个时间还显示「通话中」的旧记录，按已结束处理。
    private static let maxLiveSeconds: TimeInterval = 10 * 60
    /// 挂断后等通话报告的时间，超过就不再显示「正在生成摘要」
    private static let reportWaitSeconds: TimeInterval = 2 * 60

    /// 对方说过话（转写里有 User 的发言）
    var callerSpoke: Bool {
        transcript?.split(separator: "\n").contains { $0.hasPrefix("User:") } ?? false
    }

    func phase(now: Date = Date()) -> CallPhase {
        let age = now.timeIntervalSince(createdAt)
        switch status {
        case "answering":
            if age < Self.maxLiveSeconds { return .live }
            return callerSpoke ? .noReport : .hungUpSilently
        case "ended":
            // Twilio 已报告挂断，Vapi 的通话报告还没到
            if age < (durationSeconds ?? 0) + Self.reportWaitSeconds { return .summarizing }
            return callerSpoke ? .noReport : .hungUpSilently
        default:
            guard !callerSpoke else { return .done }
            // 对方一句话没说：多数是自动外呼程序接通后马上挂断
            return endedReason?.contains("customer") == true ? .hungUpSilently : .silent
        }
    }

    /// 诈骗风险：AI 的判断和号码被公开举报的可信度，取较高的一个
    func riskScore(lookup: NumberLookup? = nil) -> Int? {
        let reported = lookup?.kind == .spamReport ? lookup?.confidence : spamReport?.confidence
        let scores = [structured?.scamRisk.map { Int($0) }, reported].compactMap { $0 }
        return scores.max()
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
