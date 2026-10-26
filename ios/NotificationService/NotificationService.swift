import UserNotifications

/// 通知扩展：来电通知显示之前，用本机通讯录里保存的名字替换标题。
/// 后端（lib/push.js）推送时带上 mutable-content 和来电号码 fromNumber；通讯录只在手机上匹配，不上传。
/// 没有通讯录权限、号码不在通讯录里、或处理超时，都原样显示后端给的标题（对方自称的名字或号码）。
final class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var original: UNNotificationContent?

    override func didReceive(_ request: UNNotificationRequest,
                             withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        original = request.content
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent,
              let number = content.userInfo["fromNumber"] as? String,
              let name = ContactLookup.name(for: number)
        else {
            contentHandler(request.content)
            return
        }
        let scam = content.userInfo["scam"] as? Bool ?? false
        content.title = scam ? String(localized: "疑似诈骗 · \(name)") : name
        contentHandler(content)
    }

    /// 系统给扩展的时间快用完了：直接显示原通知
    override func serviceExtensionTimeWillExpire() {
        if let contentHandler, let original { contentHandler(original) }
    }
}
