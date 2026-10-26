import Observation
import UIKit
import UserNotifications

/// 推送通知：AI 接完电话后，后端（lib/push.js）通过 APNs 推送「谁打来 + 摘要」。
/// 流程：登录进入主界面 → 请求通知权限 → 向苹果注册 → 拿到设备令牌上报给后端（POST /api/account）。
/// 点通知时打开那通来电的详情；App 在前台时照常显示横幅，并刷新来电列表。
@MainActor
@Observable
final class PushCenter {
    static let shared = PushCenter()

    enum Permission { case notDetermined, granted, denied }

    private(set) var permission: Permission = .notDetermined
    /// 苹果给的设备令牌（十六进制）。退出登录时用它注销这台设备。
    private(set) var deviceToken: String?
    /// 点了通知、等待打开的来电 ID
    var pendingCallID: String?
    /// App 在前台时收到新来电通知就 +1，来电列表据此刷新
    private(set) var callsChanged = 0

    @ObservationIgnored private weak var session: AppSession?

    /// 从 Xcode 直接装的调试版走苹果的沙盒推送；TestFlight 和 App Store 版走正式推送。
    nonisolated static var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    nonisolated static func hex(_ token: Data) -> String {
        token.map { String(format: "%02x", $0) }.joined()
    }

    /// 进入主界面后调用。第一次会弹出系统授权框；已经授权就向苹果注册（每次启动都要注册，令牌可能变）。
    func start(session: AppSession) async {
        self.session = session
        await refreshPermission()
        if permission == .notDetermined {
            await requestPermission()
        } else if permission == .granted {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// 「我的 › 开启来电通知」也用这个
    func requestPermission() async {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
        await refreshPermission()
        if granted { UIApplication.shared.registerForRemoteNotifications() }
    }

    /// 回到前台时调用：用户可能刚在系统设置里打开或关闭了通知
    func refreshPermission() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        let previous = permission
        switch settings.authorizationStatus {
        case .notDetermined: permission = .notDetermined
        case .denied: permission = .denied
        default: permission = .granted
        }
        if previous == .denied, permission == .granted, session?.isSignedIn == true {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    func didRegister(deviceToken data: Data) {
        deviceToken = Self.hex(data)
        Task { await upload() }
    }

    private func upload() async {
        guard let deviceToken, let client = session?.client else { return }
        do {
            try await client.registerPush(token: deviceToken, environment: Self.environment)
        } catch {
            print("上报推送令牌失败：\(error.localizedDescription)")
        }
    }

    fileprivate func callArrived() {
        callsChanged += 1
    }

    fileprivate func open(callID: String?) {
        guard let callID, !callID.isEmpty else { return }
        pendingCallID = callID
        session?.selectedTab = .calls
    }
}

/// 接收 APNs 注册结果和通知点击。由 CallAssistantApp 的 @UIApplicationDelegateAdaptor 创建。
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // 要在启动完成前设置，否则点通知冷启动时收不到 didReceive
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushCenter.shared.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // 模拟器、或签名里没有 Push Notifications 能力时会走到这里
        print("注册推送失败：\(error.localizedDescription)")
    }

    /// App 在前台：照常显示横幅，并刷新来电列表
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        await MainActor.run { PushCenter.shared.callArrived() }
        return [.banner, .list, .sound]
    }

    /// 点了通知：打开那通来电
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let callID = response.notification.request.content.userInfo["callId"] as? String
        await MainActor.run { PushCenter.shared.open(callID: callID) }
    }
}
