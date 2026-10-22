import SwiftUI

/// 首次登录后的引导：称呼 → 声音（男声 / 女声）。音色默认「成熟」，可以之后在「我的」里改。
struct OnboardingView: View {
    @Environment(AppSession.self) private var session

    @State private var name = ""
    @State private var gender: VoiceGender?
    @State private var step = Step.name
    @State private var isSaving = false
    @State private var errorMessage: String?
    @FocusState private var nameFocused: Bool

    private enum Step { case name, voice }
    static let nameMaxLength = 30

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch step {
            case .name: nameStep.transition(.move(edge: .leading).combined(with: .opacity))
            case .voice: voiceStep.transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(.snappy, value: step)
        .onAppear {
            name = session.config?.profile?.name ?? ""
            gender = session.config?.profile?.gender
            nameFocused = true
        }
    }

    // MARK: - 称呼

    private var nameStep: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("怎么称呼你？")
                .font(.title.bold())
                .padding(.top, 64)
            Text("AI 接电话时会说「这是 \(trimmedName.isEmpty ? "你" : trimmedName) 的 AI 助手」")
                .foregroundStyle(.secondary)
                .padding(.top, 8)

            TextField("名字或英文名", text: $name)
                .font(.title3)
                .textContentType(.givenName)
                .submitLabel(.next)
                .focused($nameFocused)
                .onSubmit(goToVoice)
                .padding(.horizontal, 18)
                .frame(height: 56)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.top, 32)
                .onChange(of: name) { _, newValue in
                    if newValue.count > Self.nameMaxLength { name = String(newValue.prefix(Self.nameMaxLength)) }
                }

            primaryButton("下一步", action: goToVoice)
                .disabled(trimmedName.isEmpty)
                .padding(.top, 24)
        }
    }

    // MARK: - 声音

    private var voiceStep: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                step = .name
                errorMessage = nil
            } label: {
                Image(systemName: "chevron.left")
                    .font(.title3.weight(.semibold))
                    .frame(width: 44, height: 44, alignment: .leading)
            }
            .tint(.primary)
            .disabled(isSaving)
            .padding(.top, 8)

            Text("选择助手的声音")
                .font(.title.bold())
                .padding(.top, 12)
            Text("音色之后可以在「我的」里调整")
                .foregroundStyle(.secondary)
                .padding(.top, 8)

            HStack(spacing: 12) {
                ForEach(VoiceGender.allCases) { option in
                    GenderCard(gender: option, isSelected: gender == option)
                        .onTapGesture { gender = option }
                }
            }
            .padding(.top, 32)

            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(.top, 12)
            }

            primaryButton("完成", action: finish)
                .disabled(gender == nil || isSaving)
                .padding(.top, 24)
        }
    }

    // MARK: - 组件与操作

    private func primaryButton(_ title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            ZStack {
                Text(title).opacity(isSaving ? 0 : 1)
                if isSaving { ProgressView().tint(.white) }
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.roundedRectangle(radius: 16))
    }

    private func goToVoice() {
        guard !trimmedName.isEmpty else { return }
        nameFocused = false
        step = .voice
    }

    private func finish() {
        guard let gender, !isSaving else { return }
        isSaving = true
        errorMessage = nil
        Task {
            do {
                // 保存成功后 RootView 会自动进入主界面
                try await session.updateProfile(name: trimmedName, gender: gender)
            } catch {
                errorMessage = error.localizedDescription
            }
            isSaving = false
        }
    }
}

private struct GenderCard: View {
    let gender: VoiceGender
    let isSelected: Bool

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "waveform")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(isSelected ? Color.accentColor : .secondary)
            Text(gender.label).font(.headline)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 130)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(isSelected ? Color.accentColor : .clear, lineWidth: 2)
        }
        .contentShape(Rectangle())
    }
}
