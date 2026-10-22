import SwiftUI

/// 我的 › AI 助手：称呼、男声 / 女声、音色。每项改完立即保存，下一通来电生效。
struct AssistantSettingsView: View {
    @Environment(AppSession.self) private var session

    @State private var name = ""
    @State private var errorMessage: String?
    @FocusState private var nameFocused: Bool

    private var profile: AssistantProfile? { session.config?.profile }
    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        List {
            Section {
                TextField("称呼", text: $name)
                    .textContentType(.givenName)
                    .submitLabel(.done)
                    .focused($nameFocused)
                    .onSubmit(saveName)
                    .onChange(of: nameFocused) { _, focused in
                        if !focused { saveName() }
                    }
                    .onChange(of: name) { _, newValue in
                        if newValue.count > OnboardingView.nameMaxLength {
                            name = String(newValue.prefix(OnboardingView.nameMaxLength))
                        }
                    }
            } header: {
                Text("称呼")
            } footer: {
                Text("AI 接到正常来电时会说「这是 \(trimmedName.isEmpty ? "你" : trimmedName) 的 AI 助手」。")
            }

            Section("声音") {
                Picker("声音", selection: genderBinding) {
                    ForEach(VoiceGender.allCases) { Text($0.label).tag(Optional($0)) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            Section {
                ForEach(VoiceStyle.allCases) { style in
                    Button {
                        save(voiceStyle: style)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(style.label).foregroundStyle(Color.primary)
                                Text(style.detail).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if profile?.voiceStyle == style {
                                Image(systemName: "checkmark").foregroundStyle(Color.accentColor)
                            }
                        }
                    }
                }
            } header: {
                Text("音色")
            } footer: {
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                } else {
                    Text("修改后，下一通转过来的电话就会使用新的声音。")
                }
            }
        }
        .navigationTitle("AI 助手")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { name = profile?.name ?? "" }
    }

    private var genderBinding: Binding<VoiceGender?> {
        Binding(
            get: { profile?.gender },
            set: { newValue in
                if let newValue, newValue != profile?.gender { save(gender: newValue) }
            }
        )
    }

    private func saveName() {
        guard !trimmedName.isEmpty else {
            name = profile?.name ?? ""
            return
        }
        guard trimmedName != profile?.name else { return }
        save(name: trimmedName)
    }

    private func save(name: String? = nil, gender: VoiceGender? = nil, voiceStyle: VoiceStyle? = nil) {
        errorMessage = nil
        Task {
            do {
                try await session.updateProfile(name: name, gender: gender, voiceStyle: voiceStyle)
                if name != nil { self.name = session.config?.profile?.name ?? self.name }
            } catch {
                errorMessage = error.localizedDescription
                self.name = session.config?.profile?.name ?? ""
            }
        }
    }
}
