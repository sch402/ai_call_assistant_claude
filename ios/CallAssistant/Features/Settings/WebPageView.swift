import SwiftUI
import WebKit

/// 在 App 内显示网页（隐私政策、用户协议），内容始终是网站上的最新版本。
struct WebPageView: View {
    let title: String
    let url: URL

    @State private var isLoading = true
    @State private var failed = false

    var body: some View {
        ZStack {
            WebView(url: url, isLoading: $isLoading, failed: $failed)
                .opacity(failed ? 0 : 1)
            if failed {
                ContentUnavailableView {
                    Label("打不开页面", systemImage: "wifi.exclamationmark")
                } description: {
                    Text("请检查网络后重试。")
                } actions: {
                    Link("在浏览器中打开", destination: url)
                }
            } else if isLoading {
                ProgressView()
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Link(destination: url) { Image(systemName: "safari") }
                    .accessibilityLabel("在浏览器中打开")
            }
        }
    }
}

private struct WebView: UIViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool
    @Binding var failed: Bool

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView()
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let parent: WebView
        init(_ parent: WebView) { self.parent = parent }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            handle(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            handle(error)
        }

        /// 一次加载被另一次取代时会报「已取消」（-999），不算失败
        private func handle(_ error: Error) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            parent.isLoading = false
            parent.failed = true
        }

        /// 页面里的站外链接（例如 OAIC、mailto:）交给系统打开，站内锚点和两份文档之间的跳转留在 App 里
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard action.navigationType == .linkActivated, let target = action.request.url else {
                decisionHandler(.allow)
                return
            }
            if target.host() == parent.url.host() {
                decisionHandler(.allow)
            } else {
                UIApplication.shared.open(target)
                decisionHandler(.cancel)
            }
        }
    }
}
