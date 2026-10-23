import SwiftUI

struct CallListView: View {
    @Environment(AppSession.self) private var session
    @Environment(ContactNames.self) private var contacts
    @AppStorage("contacts.promptDismissed") private var contactsPromptDismissed = false
    @State private var store = CallStore()

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("来电")
                .navigationDestination(for: CallRecord.self) { call in
                    CallDetailView(call: call, store: store)
                }
                .safeAreaInset(edge: .top, spacing: 0) {
                    VStack(spacing: 8) {
                        if let subscription = session.config?.subscription {
                            SubscriptionBanner(
                                info: subscription,
                                onSubscribe: { session.showSubscription = true },
                                onCancelForwarding: { session.selectedTab = .forwarding }
                            )
                        }
                        Picker("筛选", selection: $store.filter) {
                            ForEach(CallFilter.allCases) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.segmented)
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 8)
                    .background(.bar)
                }
                .refreshable { await store.load(using: session.client) }
                .task { await store.load(using: session.client) }
        }
    }

    @ViewBuilder
    private var content: some View {
        if !store.hasLoaded && store.isLoading {
            ProgressView("正在读取来电…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let message = store.errorMessage, store.calls.isEmpty {
            ContentUnavailableView {
                Label("读取失败", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("重试") { Task { await store.load(using: session.client) } }
                    .buttonStyle(.borderedProminent)
            }
        } else if store.visibleCalls.isEmpty {
            ContentUnavailableView(
                store.calls.isEmpty ? "还没有来电记录" : "这里没有来电",
                systemImage: "phone.bubble",
                description: Text(store.calls.isEmpty ? "开启代接后，你没接的电话会由 AI 接听并记录在这里。" : "换一个筛选看看。")
            )
        } else {
            List {
                if contacts.access == .notDetermined && !contactsPromptDismissed {
                    ContactsPromptRow(
                        onAllow: { Task { await contacts.requestAccess() } },
                        onDismiss: { contactsPromptDismissed = true }
                    )
                }
                ForEach(store.visibleCalls) { call in
                    NavigationLink(value: call) {
                        CallRowView(call: call)
                    }
                }
            }
            .listStyle(.plain)
        }
    }
}

/// 来电列表顶部的一行提示：允许读取通讯录后，来电显示通讯录里的名字。
private struct ContactsPromptRow: View {
    let onAllow: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "person.crop.circle.badge.checkmark")
                .font(.title2)
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text("显示通讯录里的名字").font(.subheadline.weight(.semibold))
                Text("只在这台手机上匹配，不会上传通讯录。").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Button("允许", action: onAllow)
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("不再提示")
        }
        .padding(.vertical, 6)
        .listRowSeparator(.hidden)
    }
}

struct CallRowView: View {
    let call: CallRecord
    @Environment(ContactNames.self) private var contacts

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            CategoryBadge(category: call.category, size: 40)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(call.displayTitle(contactName: contacts.name(for: call.fromNumber)))
                        .font(.headline)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(call.createdAt, format: .relative(presentation: .named, unitsStyle: .abbreviated))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(call.headline)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                if call.needsAttention || call.category == .scam {
                    HStack(spacing: 6) {
                        if call.category == .scam { Tag(text: "疑似诈骗", tint: .red) }
                        if let recommendation = call.recommendation, call.needsAttention {
                            Tag(text: recommendation, tint: .accentColor)
                        }
                        if let urgency = call.urgencyLabel, call.structured?.urgency == "high" {
                            Tag(text: urgency, tint: .orange)
                        }
                    }
                    .padding(.top, 2)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

struct CategoryBadge: View {
    let category: CallCategory
    var size: CGFloat = 40

    var body: some View {
        Image(systemName: category.symbol)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(category.tint)
            .frame(width: size, height: size)
            .background(category.tint.opacity(0.14), in: Circle())
            .accessibilityLabel(category.label)
    }
}

struct Tag: View {
    let text: String
    var tint: Color = .secondary

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule())
    }
}
