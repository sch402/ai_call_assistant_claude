import Foundation

/// GSM 呼叫转移代码（澳洲 Telstra、Optus、Vodafone 等都使用这一套）。
/// 查询和取消代码可以由 App 直接拨打；把来电转到某个号码的代码会被 iOS 拦截（Call Forwarding Link Blocked，
/// 防诈骗保护），只能复制后由用户在拨号键盘粘贴拨出。
enum ForwardingCode: String, CaseIterable, Identifiable {
    case allConditional
    case noReply
    case busy
    case unreachable
    case cancelAll
    case queryNoReply
    case queryBusy

    var id: String { rawValue }

    var title: String {
        switch self {
        case .allConditional: return String(localized: "开启代接（推荐）")
        case .noReply: return String(localized: "无人接听时转移")
        case .busy: return String(localized: "占线或拒接时转移")
        case .unreachable: return String(localized: "关机或无信号时转移")
        case .cancelAll: return String(localized: "关闭代接")
        case .queryNoReply: return String(localized: "查询无人接听转移")
        case .queryBusy: return String(localized: "查询占线转移")
        }
    }

    var detail: String {
        switch self {
        case .allConditional: return String(localized: "一次设置无人接听、占线拒接、关机无信号三种情况。")
        case .noReply: return String(localized: "响铃一段时间没人接，转给 AI。")
        case .busy: return String(localized: "通话中有新来电，或你按了拒接，立即转给 AI。")
        case .unreachable: return String(localized: "手机关机、飞行模式或没信号时转给 AI。")
        case .cancelAll: return String(localized: "取消所有条件转移，来电恢复正常。")
        case .queryNoReply: return String(localized: "运营商会显示当前转到哪个号码。")
        case .queryBusy: return String(localized: "运营商会显示当前转到哪个号码。")
        }
    }

    /// 是否需要代接号码。
    var needsNumber: Bool {
        switch self {
        case .allConditional, .noReply, .busy, .unreachable: return true
        case .cancelAll, .queryNoReply, .queryBusy: return false
        }
    }

    /// 是否使用「无人接听等待时间」。
    var usesWaitTime: Bool { self == .allConditional || self == .noReply }

    /// 生成要拨的代码。number 为 E.164 格式，例如 +61258496666；waitSeconds 为 5–30 之间、5 的倍数。
    func code(number: String, waitSeconds: Int) -> String? {
        let target = number.filter { $0.isNumber || $0 == "+" }
        if needsNumber && target.filter(\.isNumber).count < 8 { return nil }
        let wait = ForwardingCode.clampWait(waitSeconds)
        switch self {
        case .allConditional: return "**004*\(target)**\(wait)#"
        case .noReply: return "**61*\(target)**\(wait)#"
        case .busy: return "**67*\(target)#"
        case .unreachable: return "**62*\(target)#"
        case .cancelAll: return "##004#"
        case .queryNoReply: return "*#61#"
        case .queryBusy: return "*#67#"
        }
    }

    /// iOS 是否允许 App 直接拨打。实测：查询（*#67#）和取消（##004#）会弹出呼叫确认；
    /// 设置转移到某个号码的代码会被系统拦截，而且 openURL 仍然返回成功，App 无法察觉，所以按类型判断。
    var canDialDirectly: Bool {
        switch self {
        case .cancelAll, .queryNoReply, .queryBusy: return true
        case .allConditional, .noReply, .busy, .unreachable: return false
        }
    }

    /// 直接拨打代码用的 tel: 链接，* # + 做百分号编码。
    static func dialURL(for code: String) -> URL? {
        let encoded = code
            .replacingOccurrences(of: "*", with: "%2A")
            .replacingOccurrences(of: "#", with: "%23")
            .replacingOccurrences(of: "+", with: "%2B")
        return URL(string: "tel:\(encoded)")
    }

    static let waitOptions = [5, 10, 15, 20, 25, 30]

    static func clampWait(_ seconds: Int) -> Int {
        let clamped = min(max(seconds, 5), 30)
        return (clamped / 5) * 5
    }
}
