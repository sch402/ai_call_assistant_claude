import SwiftUI
import UIKit

struct CallDetailView: View {
    let call: CallRecord
    let store: CallStore

    @Environment(AppSession.self) private var session
    @Environment(\.openURL) private var openURL
    @State private var confirmBlock = false
    @State private var blocked = false
    @State private var copied = false

    var body: some View {
        List {
            Section {
                HStack(spacing: 14) {
                    CategoryBadge(category: call.category, size: 52)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(call.title).font(.title3.weight(.semibold))
                        Text(call.createdAt, format: .dateTime.month().day().hour().minute())
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
                tags
            }

            Section("AI 摘要") {
                Text(call.headline)
                    .font(.body)
                    .textSelection(.enabled)
            }

            Section("详情") {
                InfoRow(label: "来电号码", value: call.fromNumber.map(PhoneFormat.display))
                InfoRow(label: "来意", value: call.structured?.purpose)
                InfoRow(label: "回电号码", value: call.structured?.callbackNumber)
                InfoRow(label: "时间要求", value: call.structured?.deadline)
                InfoRow(label: "判定理由", value: call.structured?.scamReasons?.joined(separator: "；"))
                InfoRow(label: "通话时长", value: call.durationSeconds.map { "\(Int($0.rounded())) 秒" })
                if call.attributed == false {
                    InfoRow(label: "转移来源", value: "运营商未提供，无法确认是转给你的来电")
                }
            }

            if let transcript = call.transcript, !transcript.isEmpty {
                Section {
                    DisclosureGroup("完整转写") {
                        Text(transcript)
                            .font(.callout.monospaced())
                            .textSelection(.enabled)
                            .padding(.vertical, 4)
                    }
                }
            }

            if let number = call.dialableNumber {
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
                    Button(role: .destructive) {
                        confirmBlock = true
                    } label: {
                        Label(blocked || call.isBlocked ? "已在黑名单" : "拉黑这个号码", systemImage: "hand.raised.fill")
                    }
                    .disabled(blocked || call.isBlocked)
                }
            }
        }
        .navigationTitle("来电详情")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("拉黑 \(PhoneFormat.display(call.dialableNumber ?? ""))？", isPresented: $confirmBlock, titleVisibility: .visible) {
            Button("拉黑", role: .destructive) {
                Task { blocked = await store.block(call, using: session.client) }
            }
        } message: {
            Text("之后这个号码打来会被直接拒接，不会消耗 AI 通话时长。")
        }
    }

    private var tags: some View {
        HStack(spacing: 6) {
            ForEach(tagItems) { item in Tag(text: item.text, tint: item.tint) }
        }
    }

    private var tagItems: [TagItem] {
        var items = [TagItem(text: call.category.label, tint: call.category.tint)]
        if let risk = call.structured?.scamRisk {
            let tint: Color = risk >= 70 ? .red : (risk >= 40 ? .orange : .secondary)
            items.append(TagItem(text: "诈骗风险 \(Int(risk))", tint: tint))
        }
        if let urgency = call.urgencyLabel {
            items.append(TagItem(text: urgency, tint: call.structured?.urgency == "high" ? .orange : .secondary))
        }
        if let recommendation = call.recommendation {
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
