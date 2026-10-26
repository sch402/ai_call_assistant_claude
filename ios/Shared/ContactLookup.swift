import Contacts
import Foundation

// App 和通知扩展（NotificationService）共用：按号码在本机通讯录里找名字。只在手机上匹配，不上传。
enum ContactLookup {
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

    /// 只查一个号码（通知扩展用：内存和时间都有限，不能遍历整个通讯录）。
    /// 系统的号码匹配比较宽松，所以再按 E.164 精确核对一遍，和 App 里列表的匹配结果一致。
    static func name(for number: String) -> String? {
        guard isAuthorized, let target = PhoneNumber.e164(number) else { return nil }
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
