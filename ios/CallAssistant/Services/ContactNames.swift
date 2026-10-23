import Contacts
import Foundation
import Observation

/// 来电号码 → 通讯录里保存的名字。只在本机读取和匹配，不上传任何通讯录数据。
/// 权限在用户点「允许」时才请求（来电列表顶部的提示、或「我的」页面），不会一打开 App 就弹窗。
@MainActor
@Observable
final class ContactNames {
    enum Access { case notDetermined, granted, denied }

    private(set) var access: Access = ContactNames.currentAccess()
    /// E.164 号码 → 显示名
    private var names: [String: String] = [:]
    @ObservationIgnored private var loadTask: Task<Void, Never>?

    func name(for number: String?) -> String? {
        guard let number, let key = PhoneNumber.e164(number) else { return nil }
        return names[key]
    }

    /// 请求通讯录权限，允许后立即建立号码索引。
    func requestAccess() async {
        _ = try? await CNContactStore().requestAccess(for: .contacts)
        access = Self.currentAccess()
        await reload()
    }

    /// 有权限时重新读取通讯录（App 回到前台时调用，用户可能刚改过联系人或权限）。
    func reload() async {
        access = Self.currentAccess()
        guard access == .granted else {
            names = [:]
            return
        }
        loadTask?.cancel()
        let task = Task.detached(priority: .utility) { Self.buildIndex() }
        loadTask = Task { [weak self] in
            let index = await task.value
            guard !Task.isCancelled else { return }
            self?.names = index
        }
        await loadTask?.value
    }

    nonisolated private static func currentAccess() -> Access {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .notDetermined: return .notDetermined
        case .denied, .restricted: return .denied
        // .authorized，以及 iOS 18 起的 .limited（用户只允许部分联系人）
        default: return .granted
        }
    }

    /// 遍历通讯录，把每个电话号码整理成 E.164 作为键。比较慢，在后台线程执行。
    nonisolated static func buildIndex() -> [String: String] {
        let keys: [CNKeyDescriptor] = [
            CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactOrganizationNameKey as CNKeyDescriptor,
        ]
        let request = CNContactFetchRequest(keysToFetch: keys)
        var index: [String: String] = [:]
        try? CNContactStore().enumerateContacts(with: request) { contact, _ in
            let fullName = CNContactFormatter.string(from: contact, style: .fullName)?
                .trimmingCharacters(in: .whitespaces)
            guard let name = displayName(fullName: fullName, organization: contact.organizationName) else { return }
            for labeled in contact.phoneNumbers {
                if let key = PhoneNumber.e164(labeled.value.stringValue), index[key] == nil {
                    index[key] = name
                }
            }
        }
        return index
    }

    /// 有姓名用姓名，只填了公司就用公司名。
    nonisolated static func displayName(fullName: String?, organization: String) -> String? {
        if let fullName, !fullName.isEmpty { return fullName }
        let org = organization.trimmingCharacters(in: .whitespaces)
        return org.isEmpty ? nil : org
    }
}
