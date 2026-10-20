import SwiftUI

/// 订阅未生效时的提示条。订阅有效时不显示。
/// 我们没法远程取消用户手机上的呼叫转移，所以过期后要提醒用户续费，或者自己关闭转移。
struct SubscriptionBanner: View {
    let info: SubscriptionInfo
    /// 打开订阅页
    var onSubscribe: (() -> Void)?
    /// 跳到「代接设置」关闭呼叫转移
    var onCancelForwarding: (() -> Void)?

    var body: some View {
        if info.state != .active {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: info.state == .grace ? "clock.badge.exclamationmark" : "exclamationmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(tint)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.subheadline.weight(.semibold))
                    Text(message).font(.caption).foregroundStyle(.secondary)
                    HStack(spacing: 16) {
                        if let onSubscribe {
                            Button(info.state == .none ? "开通" : "续费", action: onSubscribe)
                        }
                        if let onCancelForwarding, !info.isAnswering {
                            Button("关闭呼叫转移", action: onCancelForwarding)
                        }
                    }
                    .font(.caption.weight(.semibold))
                    .padding(.top, 2)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private var tint: Color { info.state == .grace ? .orange : .red }

    private var title: String {
        switch info.state {
        case .active: return ""
        case .grace: return String(localized: "订阅已到期")
        case .expired: return String(localized: "订阅已过期，AI 已停止代接")
        case .none: return String(localized: "尚未开通代接服务")
        }
    }

    private var message: String {
        switch info.state {
        case .active:
            return ""
        case .grace:
            if let end = info.graceEndsAt {
                return String(localized: "AI 会继续代接到 \(end.formatted(.dateTime.month().day().hour().minute()))，之后来电不再接听。请及时续费。")
            }
            return String(localized: "AI 暂时继续代接，请及时续费。")
        case .expired:
            return String(localized: "转过来的电话会被直接挂断，来电方会听到忙音。请续费，或关闭呼叫转移。")
        case .none:
            return String(localized: "开通后 AI 才会接听转过来的电话。")
        }
    }
}
