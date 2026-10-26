import Contacts
import Foundation

// App 和通知扩展（NotificationService）共用：按号码在本机通讯录里找名字。只在手机上匹配，不上传。
//
// 通知扩展是独立进程，不一定能用 App 的通讯录权限。所以 App 每次读完通讯录，
// 把「E.164 号码 → 名字」写进 App Group 共享目录（只在这台手机上），扩展优先读这份；读不到再自己查通讯录。
enum ContactLookup {
    static let appGroup = "group.com.homeau.callassistant"

    /// 有通讯录权限（含 iOS 18 起的「部分联系人」）
    static var isAuthorized: Bool {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .notDetermined, .denied, .restricted: return false
        default: return true
        }
    }

    /// 有姓名用姓名，只填了公司就用公司名。
    static func displayName(fullName: String?, organization: String) -> String? {
        if let fullName, !fullName.isEmpty { return fullName }
        let org = organization.trimmingCharacters(in: .whitespaces)
        return org.isEmpty ? nil : org
    }

    static let keys: [CNKeyDescriptor] = [
        CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
        CNContactPhoneNumbersKey as CNKeyDescriptor,
        CNContactOrganizationNameKey as CNKeyDescriptor,
    ]

    // MARK: - App Group 共享的号码索引

    private static var sharedIndexURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appending(path: "contact-names.json")
    }

    /// App 读完通讯录后调用。手机解锁过一次后扩展就能读（锁屏时也能收到通知）。
    static func saveSharedIndex(_ index: [String: String]) {
        guard let url = sharedIndexURL, let data = try? JSONEncoder().encode(index) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// 通讯录权限被关掉时删除
    static func removeSharedIndex() {
        guard let url = sharedIndexURL else { return }
        try? FileManager.default.removeItem(at: url)
    }

    static func loadSharedIndex() -> [String: String]? {
        guard let url = sharedIndexURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode([String: String].self, from: data)
    }

    // MARK: - 查找

    enum Source: String { case sharedIndex, contacts, notFound, noAccess, invalidNumber }

    /// 通知扩展用：先查共享索引，没有索引再直接查通讯录。
    static func lookup(_ number: String) -> (name: String?, source: Source) {
        guard let target = PhoneNumber.e164(number) else { return (nil, .invalidNumber) }
        if let index = loadSharedIndex() {
            if let name = index[target] { return (name, .sharedIndex) }
            return (nil, .notFound)
        }
        guard isAuthorized else { return (nil, .noAccess) }
        if let name = name(forE164: target) { return (name, .contacts) }
        return (nil, .notFound)
    }

    /// 直接查通讯录里的一个号码（不遍历整个通讯录，扩展的内存和时间都有限）。
    /// 系统的号码匹配比较宽松，所以再按 E.164 精确核对一遍，和 App 里列表的匹配结果一致。
    static func name(forE164 target: String) -> String? {
        let store = CNContactStore()
        // 通讯录里可能存的是国际格式，也可能是 0412 345 678 这样的国内格式，两种都试
        var candidates = [target]
        if target.hasPrefix("+" + PhoneNumber.defaultCountryCode) {
            candidates.append("0" + target.dropFirst(1 + PhoneNumber.defaultCountryCode.count))
        }
        for candidate in candidates {
            let predicate = CNContact.predicateForContacts(matching: CNPhoneNumber(stringValue: candidate))
            guard let contacts = try? store.unifiedContacts(matching: predicate, keysToFetch: keys) else { continue }
            for contact in contacts where contact.phoneNumbers.contains(where: { PhoneNumber.e164($0.value.stringValue) == target }) {
                let fullName = CNContactFormatter.string(from: contact, style: .fullName)?.trimmingCharacters(in: .whitespaces)
                if let name = displayName(fullName: fullName, organization: contact.organizationName) { return name }
            }
        }
        return nil
    }
}
