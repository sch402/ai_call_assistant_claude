import SwiftUI
import UIKit

/// 呼叫转移设置。iOS 不允许 App 代拨含 * 或 # 的代码，所以流程是：复制代码 → 到电话 App 粘贴拨出 → 回来确认。
struct ForwardingView: View {
    @Environment(AppSession.self) private var session

    @AppStorage("forwarding.waitSeconds") private var waitSeconds = 20
    @AppStorage("forwarding.enabledAt") private var enabledAt: Double = 0
    @AppStorage("check.liveVoicemailOff") private var liveVoicemailOff = false
    @AppStorage("check.screeningOff") private var screeningOff = false

    @State private var activeCode: ActiveCode?

    private var number: String? { session.config?.twilioNumber }
    private var isEnabled: Bool { enabledAt > 0 }

    var body: some View {
        NavigationStack {
            List {
                statusSection
                if let number {
                    mainSection(number: number)
                    checklistSection
                    advancedSection(number: number)
                } else {
                    Section {
                        HStack(spacing: 12) {
                            ProgressView()
                            Text("正在读取代接号码…").foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("代接设置")
            .task { await session.refreshConfig() }
            .refreshable { await session.refreshConfig() }
            .sheet(item: $activeCode) { item in
                DialCodeSheet(item: item) { completed in
                    if completed {
                        switch item.kind {
                        case .cancelAll: enabledAt = 0
                        case .allConditional, .noReply, .busy, .unreachable: enabledAt = Date().timeIntervalSince1970
                        case .queryNoReply, .queryBusy: break
                        }
                    }
                    activeCode = nil
                }
                .presentationDetents([.medium, .large])
            }
        }
    }

    // MARK: - 状态

    private var statusSection: some View {
        Section {
            HStack(spacing: 14) {
                Image(systemName: isEnabled ? "checkmark.circle.fill" : "circle.dashed")
                    .font(.system(size: 34))
                    .foregroundStyle(isEnabled ? Color.accentColor : Color.secondary)
                VStack(alignment: .leading, spacing: 4) {
                    Text(isEnabled ? "代接已开启" : "代接未开启")
                        .font(.headline)
                    Group {
                        if isEnabled {
                            Text("\(Date(timeIntervalSince1970: enabledAt), format: .dateTime.month().day()) 设置。你没接的电话会转给 AI 接听。")
                        } else {
                            Text("开启后，你没接、拒接或无法接通的电话会转给 AI 接听。")
                        }
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 6)
            if let number {
                LabeledContent("代接号码", value: PhoneFormat.display(number))
            }
        } footer: {
            Text("状态以你在本 App 里的确认为准。想确认是否生效，可以用另一部手机打你的手机，不接，看来电记录里是否出现。")
        }
    }

    // MARK: - 开启 / 关闭

    private func mainSection(number: String) -> some View {
        Section {
            Picker("无人接听等待", selection: $waitSeconds) {
                ForEach(ForwardingCode.waitOptions, id: \.self) { Text("\($0) 秒").tag($0) }
            }
            Button {
                open(.allConditional, number: number)
            } label: {
                Label("开启代接", systemImage: "phone.arrow.right")
                    .font(.headline)
            }
            Button(role: .destructive) {
                open(.cancelAll, number: number)
            } label: {
                Label("关闭代接", systemImage: "phone.down")
            }
        } header: {
            Text("开启或关闭")
        } footer: {
            Text("出国前建议先关闭代接，避免转移产生漫游费用。")
        }
    }

    // MARK: - iPhone 设置检查

    private var checklistSection: some View {
        Section {
            Toggle(isOn: $liveVoicemailOff) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("已关闭「实时语音留言」")
                    Text("设置 › App › 电话 › 实时语音留言").font(.caption).foregroundStyle(.secondary)
                }
            }
            Toggle(isOn: $screeningOff) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("「筛选陌生来电」设为「不筛选」")
                    Text("设置 › App › 电话 › 筛选陌生来电").font(.caption).foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("iPhone 设置检查")
        } footer: {
            Text("这两项开着时，iPhone 会自己先接听，电话就不会转给 AI。")
        }
    }

    // MARK: - 分项设置与查询

    private func advancedSection(number: String) -> some View {
        Section("分项设置与查询") {
            ForEach([ForwardingCode.noReply, .busy, .unreachable, .queryNoReply, .queryBusy]) { kind in
                Button {
                    open(kind, number: number)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(kind.title).foregroundStyle(Color.primary)
                        Text(kind.detail).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func open(_ kind: ForwardingCode, number: String) {
        guard let code = kind.code(number: number, waitSeconds: waitSeconds) else { return }
        activeCode = ActiveCode(kind: kind, code: code)
    }
}

struct ActiveCode: Identifiable {
    let kind: ForwardingCode
    let code: String
    var id: String { kind.rawValue + code }
}

/// 复制代码并指导用户到电话 App 拨出。
struct DialCodeSheet: View {
    let item: ActiveCode
    let onFinish: (_ completed: Bool) -> Void

    @State private var copied = false

    private var isQuery: Bool { item.kind == .queryNoReply || item.kind == .queryBusy }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text(item.kind.detail)
                    .foregroundStyle(.secondary)

                Button {
                    copy()
                } label: {
                    HStack {
                        Text(item.code)
                            .font(.title2.monospaced().weight(.semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                        Spacer()
                        Label(copied ? "已复制" : "复制", systemImage: copied ? "checkmark" : "doc.on.doc")
                            .labelStyle(.titleAndIcon)
                            .font(.subheadline.weight(.semibold))
                    }
                    .padding()
                    .background(Color.accentColor.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 12) {
                    Step(number: 1, text: "点上面的代码复制")
                    Step(number: 2, text: "打开「电话」App，进入「拨号键盘」")
                    Step(number: 3, text: "长按号码栏，选「粘贴」，然后拨出")
                    Step(number: 4, text: isQuery ? "屏幕上会显示运营商返回的当前设置" : "看到运营商「设置成功」的提示后，回到这里确认")
                }

                Spacer()

                if !isQuery {
                    Button {
                        onFinish(true)
                    } label: {
                        Text("我已拨出并看到成功提示")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }
            }
            .padding()
            .navigationTitle(item.kind.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { onFinish(false) }
                }
            }
            .onAppear(perform: copy)
        }
    }

    private func copy() {
        UIPasteboard.general.string = item.code
        copied = true
    }
}

private struct Step: View {
    let number: Int
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(number)")
                .font(.caption.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 20, height: 20)
                .background(Color.accentColor, in: Circle())
            Text(text)
        }
    }
}
