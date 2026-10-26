import Foundation

// App 和通知扩展（NotificationService）共用
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
