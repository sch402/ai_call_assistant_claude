import StoreKit
import SwiftUI

/// 删除账户（苹果审核要求）。删除前提醒两件删账户做不到的事：取消苹果订阅、关闭呼叫转移。
struct DeleteAccountView: View {
    @Environment(AppSession.self) private var session

    @AppStorage("forwarding.enabledAt") private var forwardingEnabledAt: Double = 0
    @State private var confirm = false
    @State private var isDeleting = false
    @State private var errorMessage: String?
    @State private var showManage = false

    /// 还在续费的苹果订阅：删账户不会停止扣费
    private var hasRenewingSubscription: Bool {
        guard session.config?.isOwner != true, let sub = session.config?.subscription else { return false }
        return sub.isAnswering && sub.expiresAt != nil && sub.autoRenew != false
    }

    var body: some View {
        List {
            Section {
                Text("你的手机号、来电记录和订阅记录会被永久删除，无法恢复。")
            }

            if hasRenewingSubscription {
                Section {
                    Label("苹果订阅不会随账户删除而取消", systemImage: "creditcard")
                    Button("管理订阅") { showManage = true }
                } footer: {
                    Text("请先取消订阅，否则苹果会继续扣费。")
                }
            }

            if forwardingEnabledAt > 0 {
                Section {
                    Label("呼叫转移还开着", systemImage: "phone.arrow.right")
                    Button("去关闭") { session.selectedTab = .forwarding }
                } footer: {
                    Text("删除后，转过来的电话不会再被接听，来电方会听到忙音。")
                }
            }

            Section {
                Button(role: .destructive) {
                    confirm = true
                } label: {
                    HStack {
                        Text("永久删除账户")
                        Spacer()
                        if isDeleting { ProgressView() }
                    }
                }
                .disabled(isDeleting)
            } footer: {
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("删除账户")
        .navigationBarTitleDisplayMode(.inline)
        .manageSubscriptionsSheet(isPresented: $showManage)
        .onChange(of: showManage) { _, isShowing in
            if !isShowing { Task { await session.refreshConfig() } }
        }
        .confirmationDialog("确定永久删除账户？", isPresented: $confirm, titleVisibility: .visible) {
            Button("删除", role: .destructive, action: delete)
        } message: {
            Text("删除后无法恢复。")
        }
    }

    private func delete() {
        isDeleting = true
        errorMessage = nil
        Task {
            do {
                // 成功后会自动回到登录页。本机记录的呼叫转移状态保留：用户没关的话，运营商那边仍然开着。
                try await session.deleteAccount()
            } catch {
                errorMessage = error.localizedDescription
            }
            isDeleting = false
        }
    }
}
