import os
import UserNotifications

/// 通知扩展：来电通知显示之前，用本机通讯录里保存的名字替换标题。
/// 后端（lib/push.js）推送时带上 mutable-content 和来电号码 fromNumber；通讯录只在手机上匹配，不上传。
/// 没有匹配到、或处理超时，都原样显示后端给的标题（对方自称的名字或号码）。
/// 排查：Mac 上打开 Console.app，选中手机，搜索 subsystem「com.homeau.callassistant」。
final class NotificationService: UNNotificationServiceExtension {
    private let log = Logger(subsystem: "com.homeau.callassistant", category: "NotificationService")
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var original: UNNotificationContent?

    override func didReceive(_ request: UNNotificationRequest,
                             withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        original = request.content
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent,
              let number = content.userInfo["fromNumber"] as? String
        else {
            log.notice("通知里没有 fromNumber，原样显示")
            contentHandler(request.content)
            return
        }
        let result = ContactLookup.lookup(number)
        log.notice("通讯录匹配：\(result.source.rawValue, privacy: .public)，号码尾号 \(String(number.suffix(3)), privacy: .public)")
        if let name = result.name {
            let scam = content.userInfo["scam"] as? Bool ?? false
            content.title = scam ? String(localized: "疑似诈骗 · \(name)") : name
        }
        contentHandler(content)
    }

    /// 系统给扩展的时间快用完了：直接显示原通知
    override func serviceExtensionTimeWillExpire() {
        log.notice("处理超时，原样显示")
        if let contentHandler, let original { contentHandler(original) }
    }
}
