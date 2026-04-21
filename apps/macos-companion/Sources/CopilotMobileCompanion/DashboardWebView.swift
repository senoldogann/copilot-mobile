import SwiftUI
import WebKit

struct DashboardWebView: NSViewRepresentable {
    let dashboardURL: URL
    let reloadToken: UUID

    func makeCoordinator() -> Coordinator {
        Coordinator(reloadToken: reloadToken)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        webView.load(URLRequest(url: dashboardURL))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        let hasURLChanged = webView.url?.absoluteString != dashboardURL.absoluteString
        let shouldReload = context.coordinator.reloadToken != reloadToken

        if hasURLChanged || shouldReload {
            context.coordinator.reloadToken = reloadToken
            webView.load(URLRequest(url: dashboardURL))
        }
    }

    final class Coordinator {
        var reloadToken: UUID

        init(reloadToken: UUID) {
            self.reloadToken = reloadToken
        }
    }
}
