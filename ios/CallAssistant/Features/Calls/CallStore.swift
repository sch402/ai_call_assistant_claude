import Foundation
import Observation

enum CallFilter: String, CaseIterable, Identifiable {
    case all, attention, nuisance
    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: return String(localized: "全部")
        case .attention: return String(localized: "需回电")
        case .nuisance: return String(localized: "骚扰诈骗")
        }
    }
}

@MainActor
@Observable
final class CallStore {
    private(set) var calls: [CallRecord] = []
    private(set) var isLoading = false
    private(set) var hasLoaded = false
    var errorMessage: String?
    var filter: CallFilter = .all

    var visibleCalls: [CallRecord] {
        switch filter {
        case .all: return calls
        case .attention: return calls.filter(\.needsAttention)
        case .nuisance: return calls.filter { $0.category.isNuisance || $0.isBlocked }
        }
    }

    func load(using client: APIClient?) async {
        guard let client, !isLoading else { return }
        isLoading = true
        defer { isLoading = false; hasLoaded = true }
        do {
            calls = try await client.calls()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func block(_ call: CallRecord, using client: APIClient?) async -> Bool {
        guard let client, let number = call.dialableNumber else { return false }
        do {
            try await client.block(number: number)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}
