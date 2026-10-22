import Foundation

/// 本机的验证码发送限制：每次发送后冷却 60 秒，每小时最多 5 次。记录存在 UserDefaults，重启 App 也有效。
/// 这只防误触和连点；真正防刷靠服务端（Twilio Verify 的地区限制和防欺诈、Supabase 的每小时短信上限），见 README。
struct OTPThrottle {
    static let cooldown: TimeInterval = 60
    static let maxPerHour = 5

    var defaults: UserDefaults = .standard
    private let key = "otp.sentAt"

    private var history: [Date] {
        (defaults.array(forKey: key) as? [Double] ?? []).map(Date.init(timeIntervalSince1970:))
    }

    /// 还要等多久才能再发；0 表示现在可以发。
    func waitTime(now: Date = Date()) -> TimeInterval {
        Self.waitTime(history: history, now: now)
    }

    func recordSend(now: Date = Date()) {
        let recent = history.filter { now.timeIntervalSince($0) < 3600 } + [now]
        defaults.set(recent.map(\.timeIntervalSince1970), forKey: key)
    }

    static func waitTime(history: [Date], now: Date) -> TimeInterval {
        let recent = history.filter { now.timeIntervalSince($0) < 3600 }.sorted()
        var wait: TimeInterval = 0
        if let last = recent.last { wait = max(wait, cooldown - now.timeIntervalSince(last)) }
        if recent.count >= maxPerHour, let oldest = recent.first {
            wait = max(wait, 3600 - now.timeIntervalSince(oldest))
        }
        return max(0, wait)
    }
}
