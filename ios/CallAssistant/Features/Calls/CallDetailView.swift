import SwiftUI
import UIKit

struct CallDetailView: View {
    let call: CallRecord
    let store: CallStore

    @Environment(AppSession.self) private var session
    @Environment(ContactNames.self) private var contacts
    @Environment(\.openURL) private var openURL
    @State private var confirmBlock = false
    @State private var blocked = false
    @State private var copied = false
    @State private var lookup: NumberLookup?
    /// 通话进行中或等摘要时，每 2 秒从后端取一次最新内容（实时转写）
    @State private var refreshed: CallRecord?

    private var current: CallRecord { refreshed ?? call }

    var body: some View {
        List {
            Section {
                HStack(spacing: 14) {
                    CategoryBadge(category: current.category, size: 52)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(current.displayTitle(contactName: contacts.name(for: current.fromNumber)))
                            .font(.title3.weight(.semibold))
                        Text(current.createdAt, format: .dateTime.month().day().hour().minute())
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
                tags
            }

            Section("AI 摘要") {
                HStack(spacing: 10) {
                    if current.isUpdating { ProgressView() }
                    Text(current.headline)
                        .font(.body)
                        .textSelection(.enabled)
                }
            }

            if current.isInProgress {
                liveTranscriptSection
            }

            Section {
                if let lookup {
                    NumberLookupRow(lookup: lookup)
                        .transition(.opacity)
                }
                InfoRow(label: "来电号码", value: current.fromNumber.map(PhoneFormat.display))
                InfoRow(label: "来意", value: current.structured?.purpose)
                InfoRow(label: "回电号码", value: current.structured?.callbackNumber)
                InfoRow(label: "时间要求", value: current.structured?.deadline)
                InfoRow(label: "判定理由", value: current.structured?.scamReasons?.joined(separator: "；"))
                InfoRow(label: "通话时长", value: current.durationSeconds.map { "\(Int($0.rounded())) 秒" })
                if current.attributed == false {
                    InfoRow(label: "转移来源", value: "运营商未提供，无法确认是转给你的来电")
                }
            } header: {
                Text("详情")
            } footer: {
                if let lookup {
                    LookupFooter(lookup: lookup)
                }
            }

            if !current.isInProgress, let transcript = current.transcript, !transcript.isEmpty {
                Section {
                    DisclosureGroup("完整转写") {
                        Text(transcript)
                            .font(.callout.monospaced())
                            .textSelection(.enabled)
                            .padding(.vertical, 4)
                    }
                }
            }

            if let number = current.dialableNumber {
                Section {
                    Button {
                        if let url = URL(string: "tel:\(number)") { openURL(url) }
                    } label: {
                        Label("回电 \(PhoneFormat.display(number))", systemImage: "phone.fill")
                    }
                    Button {
                        UIPasteboard.general.string = number
                        copied = true
                    } label: {
                        Label(copied ? "已复制" : "复制号码", systemImage: copied ? "checkmark" : "doc.on.doc")
                    }
                    // 只拉黑打给自己的电话（后端 user_blocks）
                    Button(role: .destructive) {
                        confirmBlock = true
                    } label: {
                        Label(blocked || current.isBlocked ? "已在黑名单" : "拉黑这个号码", systemImage: "hand.raised.fill")
                    }
                    .disabled(blocked || current.isBlocked)
                }
            }
        }
        .navigationTitle("来电详情")
        .animation(.easeOut(duration: 0.25), value: lookup)
        .animation(.easeOut(duration: 0.25), value: current)
        .task(id: call.id) { await loadLookup() }
        .task(id: current.isUpdating) { await followLiveCall() }
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("拉黑 \(PhoneFormat.display(current.dialableNumber ?? ""))？", isPresented: $confirmBlock, titleVisibility: .visible) {
            Button("拉黑", role: .destructive) {
                Task { blocked = await store.block(current, using: session.client) }
            }
        } message: {
            Text("之后这个号码打来会被直接拒接，不会消耗 AI 通话时长。")
        }
    }

    /// 通话进行中：直接展开显示对方和 AI 正在说的话
    private var liveTranscriptSection: some View {
        Section {
            if let transcript = current.transcript, !transcript.isEmpty {
                Text(transcript)
                    .font(.callout.monospaced())
                    .textSelection(.enabled)
                    .padding(.vertical, 4)
            } else {
                Text("等待对方开口…").foregroundStyle(.secondary)
            }
        } header: {
            HStack(spacing: 6) {
                Image(systemName: "circle.fill")
                    .font(.system(size: 8))
                    .foregroundStyle(.red)
                    .symbolEffect(.pulse)
                Text("实时转写")
            }
        } footer: {
            Text("每说完一句更新一次。")
        }
    }

    private var tags: some View {
        HStack(spacing: 6) {
            ForEach(tagItems) { item in Tag(text: item.text, tint: item.tint) }
        }
    }

    private var tagItems: [TagItem] {
        var items = [TagItem(text: current.category.label, tint: current.category.tint)]
        // AI 判断和号码被公开举报的可信度取较高的一个
        if let risk = current.riskScore(lookup: lookup) {
            let tint: Color = risk >= 70 ? .red : (risk >= 40 ? .orange : .secondary)
            items.append(TagItem(text: "诈骗风险 \(risk)", tint: tint))
        }
        if let urgency = current.urgencyLabel {
            items.append(TagItem(text: urgency, tint: current.structured?.urgency == "high" ? .orange : .secondary))
        }
        if let recommendation = current.recommendation {
            items.append(TagItem(text: recommendation, tint: .accentColor))
        }
        return items
    }
}

private struct TagItem: Identifiable {
    let text: String
    let tint: Color
    var id: String { text }
}

private extension CallDetailView {
    /// 陌生号码分析：只查通讯录里没有的号码；没找到或出错都不显示任何东西。
    func loadLookup() async {
        guard lookup == nil, let number = call.dialableNumber, contacts.name(for: number) == nil,
              let client = session.client else { return }
        lookup = try? await client.lookupNumber(number)
    }

    /// 正在通话或等摘要时，每 2 秒取一次最新内容，直到通话报告到达
    func followLiveCall() async {
        while current.isUpdating, !Task.isCancelled {
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled, let client = session.client else { return }
            if let fresh = try? await client.call(id: call.id) { refreshed = fresh }
        }
    }
}

/// 「可能是 Charles Adam · 房产中介 · Ray White · 90%」
private struct NumberLookupRow: View {
    let lookup: NumberLookup

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: lookup.kind == .spamReport ? "exclamationmark.bubble.fill" : "person.text.rectangle.fill")
                .font(.title3)
                .foregroundStyle(lookup.kind == .spamReport ? Color.orange : Color.accentColor)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text("可能是 \(lookup.headline)")
                    .font(.subheadline.weight(.semibold))
                if let detail = lookup.detail {
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            Text("\(lookup.confidence)%")
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(Color.accentColor)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Color.accentColor.opacity(0.12), in: Capsule())
                .accessibilityLabel("可信度 \(lookup.confidence)%")
        }
        .padding(.vertical, 2)
    }
}

private struct LookupFooter: View {
    let lookup: NumberLookup

    var body: some View {
        Text(text)
    }

    private var text: AttributedString {
        var text = AttributedString(localized: "根据公开网络信息推测，仅供参考。")
        if let url = lookup.sourceURL, let host = lookup.sourceHost {
            var link = AttributedString(host)
            link.link = url
            text += AttributedString(localized: "来源：") + link
        }
        return text
    }
}

private struct InfoRow: View {
    let label: LocalizedStringKey
    let value: String?

    var body: some View {
        if let value, !value.isEmpty, value.lowercased() != "unknown" {
            LabeledContent(label) {
                Text(value)
                    .multilineTextAlignment(.trailing)
                    .textSelection(.enabled)
            }
        }
    }
}
