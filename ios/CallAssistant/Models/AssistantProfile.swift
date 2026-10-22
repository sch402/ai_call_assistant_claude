import Foundation

/// AI 助手的声音性别（后端 lib/assistant.js 的 GENDERS）
enum VoiceGender: String, Codable, CaseIterable, Identifiable {
    case male, female

    var id: String { rawValue }

    var label: String {
        switch self {
        case .male: return String(localized: "男声")
        case .female: return String(localized: "女声")
        }
    }
}

/// 音色（后端 lib/assistant.js 的 VOICE_STYLES）。以后支持用户自己的声音时在这里加一项。
enum VoiceStyle: String, Codable, CaseIterable, Identifiable {
    case mature, calm, young

    var id: String { rawValue }

    var label: String {
        switch self {
        case .mature: return String(localized: "成熟")
        case .calm: return String(localized: "稳重")
        case .young: return String(localized: "年轻")
        }
    }

    var detail: String {
        switch self {
        case .mature: return String(localized: "自然、从容")
        case .calm: return String(localized: "沉稳、低调")
        case .young: return String(localized: "轻快、有活力")
        }
    }
}

/// 用户的 AI 助手设置（后端 lib/profile.js 的 profileView）
struct AssistantProfile: Decodable, Equatable {
    /// 称呼。AI 对正常来电方说「这是 <称呼> 的 AI 助手」
    let name: String?
    let gender: VoiceGender?
    let voiceStyle: VoiceStyle
    /// 首次引导是否已完成（称呼和性别都填了）
    let complete: Bool

    /// 「女声 · 稳重」
    var voiceSummary: String {
        [gender?.label, voiceStyle.label].compactMap { $0 }.joined(separator: " · ")
    }
}
