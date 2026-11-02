import SwiftUI
import UIKit
import WebKit

/// Forwards script messages without retaining the tab (WKUserContentController retains its handlers).
@MainActor
final class ScriptMessageProxy: NSObject, WKScriptMessageHandler {
    weak var target: WebTab?

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        target?.handleScriptMessage(message)
    }
}

/// One web tab: a WKWebView locked to one site, its native route guard and the JS bridge.
///
/// The native guard is authoritative (docs/SPEC-iOS.md):
///  1. document loads, in webView(_:decidePolicyFor:decisionHandler:);
///  2. every change of webView.url (KVO), which covers SPA pushState navigations;
///  3. the `route` message from the injected script (redundancy).
@MainActor
final class WebTab: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {

    static let handlerName = "reelfree"

    let site: Site
    private let settings: AppSettings
    let webView: WKWebView
    let hostView = UIView()
    private let maskView = UIView()
    private let maskLabel = UILabel()
    private let proxy = ScriptMessageProxy()
    private var observations: [NSKeyValueObservation] = []
    private var scriptSource: String?

    @Published private(set) var canGoBack = false
    @Published private(set) var isMasked = true

    // D2 state, in memory only. The token is one-shot with a short TTL.
    private struct DMToken {
        let id: String
        let issuedAtMs: Double
    }
    private var dmToken: DMToken?
    private var lastThread: String?
    private var activeReel: String?

    init(site: Site, settings: AppSettings) {
        self.site = site
        self.settings = settings

        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore.default()
        config.limitsNavigationsToAppBoundDomains = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.allowsInlineMediaPlayback = true
        config.upgradeKnownHostsToHTTPS = true
        config.dataDetectorTypes = []

        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        scriptSource = Self.loadScript(site.scriptResource)
        proxy.target = self
        config.userContentController.add(proxy, contentWorld: .defaultClient, name: Self.handlerName)
        installUserScripts()

        webView.customUserAgent = Self.safariUserAgent()
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = true
        webView.navigationDelegate = self
        webView.uiDelegate = self

        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(handleRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        buildHostView()
        observeWebView()

        if scriptSource != nil {
            webView.load(URLRequest(url: site.homeURL))
        } else {
            // Fail-closed: without the protection script, the site is never shown.
            setMasked(true, message: "Script de protection introuvable.\nRéinstalle l'app.")
        }
    }

    // MARK: - Setup

    private static func loadScript(_ name: String) -> String? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8),
              !source.isEmpty else { return nil }
        return source
    }

    /// Safari iOS user agent matching the running iOS version.
    static func safariUserAgent() -> String {
        let parts = UIDevice.current.systemVersion.split(separator: ".").map(String.init)
        let major = parts.first ?? "17"
        let minor = parts.count > 1 ? parts[1] : "0"
        let osToken = parts.prefix(3).joined(separator: "_")
        return "Mozilla/5.0 (iPhone; CPU iPhone OS \(osToken) like Mac OS X) AppleWebKit/605.1.15 "
            + "(KHTML, like Gecko) Version/\(major).\(minor) Mobile/15E148 Safari/604.1"
    }

    /// RF_CONFIG first, then the site script, both at document start in the isolated world.
    private func installUserScripts() {
        let ucc = webView.configuration.userContentController
        ucc.removeAllUserScripts()
        guard let source = scriptSource else { return }
        let configJSON: String
        if let data = try? JSONSerialization.data(withJSONObject: settings.jsConfig, options: [.sortedKeys]),
           let json = String(data: data, encoding: .utf8) {
            configJSON = json
        } else {
            configJSON = "{}"
        }
        ucc.addUserScript(WKUserScript(source: "window.RF_CONFIG = \(configJSON);",
                                       injectionTime: .atDocumentStart,
                                       forMainFrameOnly: true,
                                       in: .defaultClient))
        ucc.addUserScript(WKUserScript(source: source,
                                       injectionTime: .atDocumentStart,
                                       forMainFrameOnly: true,
                                       in: .defaultClient))
    }

    private func buildHostView() {
        hostView.backgroundColor = .systemBackground
        webView.frame = hostView.bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        hostView.addSubview(webView)

        maskView.backgroundColor = .systemBackground
        maskView.frame = hostView.bounds
        maskView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        maskLabel.text = "Contenu masqué par ReelFree"
        maskLabel.textColor = .secondaryLabel
        maskLabel.font = .preferredFont(forTextStyle: .body)
        maskLabel.textAlignment = .center
        maskLabel.numberOfLines = 0
        maskLabel.translatesAutoresizingMaskIntoConstraints = false
        maskView.addSubview(maskLabel)
        NSLayoutConstraint.activate([
            maskLabel.centerXAnchor.constraint(equalTo: maskView.centerXAnchor),
            maskLabel.centerYAnchor.constraint(equalTo: maskView.centerYAnchor),
            maskLabel.leadingAnchor.constraint(greaterThanOrEqualTo: maskView.leadingAnchor, constant: 24),
            maskLabel.trailingAnchor.constraint(lessThanOrEqualTo: maskView.trailingAnchor, constant: -24)
        ])
        hostView.addSubview(maskView)
        maskView.isHidden = false
    }

    private func observeWebView() {
        observations.append(webView.observe(\.url, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.evaluateCurrentURL()
            }
        })
        observations.append(webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] _, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.canGoBack = self.webView.canGoBack
            }
        })
    }

    // MARK: - Toolbar actions

    func goBack() {
        if webView.canGoBack { webView.goBack() }
    }

    func goHome() {
        guard scriptSource != nil else { return }
        webView.load(URLRequest(url: site.homeURL))
    }

    func reload() {
        guard scriptSource != nil else { return }
        if webView.url == nil {
            webView.load(URLRequest(url: site.homeURL))
        } else {
            webView.reload()
        }
    }

    @objc private func handleRefresh(_ sender: UIRefreshControl) {
        reload()
        sender.endRefreshing()
    }

    // MARK: - Settings

    /// Called when a setting changes: future documents get the new RF_CONFIG, the current one is told.
    func settingsDidChange() {
        installUserScripts()
        sendToJS(["type": "config", "config": settings.jsConfig])
        evaluateCurrentURL()
    }

    // MARK: - Mask

    private func setMasked(_ masked: Bool, message: String = "Contenu masqué par ReelFree") {
        if masked {
            maskLabel.text = message
            webView.pauseAllMediaPlayback(completionHandler: nil)
        }
        maskView.isHidden = !masked
        if isMasked != masked { isMasked = masked }
    }

    // MARK: - Policy

    private enum Verdict {
        case allow
        case redirect(URL)
        case hide
    }

    private static func nowMs() -> Double {
        Date().timeIntervalSince1970 * 1000
    }

    /// Raw percent-encoded path of a URL ("/" if empty).
    private static func rawPath(_ url: URL) -> String? {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let p = comps.percentEncodedPath
        return p.isEmpty ? "/" : p
    }

    /// Same-origin redirect target. `to` must be a plain absolute path (no scheme, no "//").
    private func redirectURL(_ to: String, from url: URL) -> URL? {
        guard to.hasPrefix("/"), !to.hasPrefix("//"), !to.contains("\\") else { return nil }
        guard let target = URL(string: to, relativeTo: url)?.absoluteURL, site.isDocumentURL(target) else { return nil }
        return target
    }

    /// Evaluates a top-level document URL of this tab's site and applies the D2 side effects.
    private func verdict(for url: URL) -> Verdict {
        guard site.isDocumentURL(url), let path = Self.rawPath(url) else { return .hide }
        switch site {
        case .instagram:
            var ctx = PolicyContext()
            ctx.nowMs = Self.nowMs()
            if let t = dmToken { ctx.token = PolicyToken(id: t.id, issuedAtMs: t.issuedAtMs) }
            ctx.lastThread = lastThread
            ctx.activeReel = activeReel
            ctx.config = settings.policyConfig
            let d = RoutePolicy.decide(path: path, ctx: ctx)
            if d.consumeToken { dmToken = nil }
            activeReel = d.reelId
            switch d.action {
            case .allow:
                if RoutePolicy.isThreadPath(path) { lastThread = path }
                return .allow
            case .redirect:
                guard let to = d.to, let target = redirectURL(to, from: url) else { return .hide }
                if Self.rawPath(target) == path { return .hide }   // no redirect loop
                return .redirect(target)
            case .hide:
                return .hide
            }
        case .youtube:
            let d = YouTubePolicy.decide(path: path, hideHomeFeed: settings.ytHideHomeFeed)
            switch d.action {
            case .allow:
                return .allow
            case .redirect:
                guard let to = d.to, let target = redirectURL(to, from: url) else { return .hide }
                if target.absoluteString == url.absoluteString { return .hide }
                return .redirect(target)
            case .hide:
                return .hide
            }
        }
    }

    /// KVO / `route` message path: the page already shows this URL.
    func evaluateCurrentURL() {
        guard let url = webView.url else { return }
        let scheme = url.scheme?.lowercased()
        if scheme == "about" { return }   // about:blank before the first load
        switch verdict(for: url) {
        case .allow:
            setMasked(false)
        case .redirect(let target):
            setMasked(true)
            webView.load(URLRequest(url: target))
        case .hide:
            setMasked(true)
        }
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
            decisionHandler(.cancel)
            return
        }

        // New window (target=_blank, window.open): never a second web view.
        guard let frame = navigationAction.targetFrame else {
            decisionHandler(.cancel)
            openOutsideOrHere(url, userInitiated: true)
            return
        }

        if !frame.isMainFrame {
            if scheme == "about" || scheme == "blob" || scheme == "data" || site.isFrameURL(url) {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
            }
            return
        }

        if scheme == "about" {
            decisionHandler(.allow)
            return
        }

        // Instagram link shim: l.instagram.com/?u=<external url>
        if site == .instagram, url.host?.lowercased() == "l.instagram.com" {
            decisionHandler(.cancel)
            if let target = Self.shimTarget(url) {
                openOutsideOrHere(target, userInitiated: true)
            }
            return
        }

        if !site.isDocumentURL(url) {
            decisionHandler(.cancel)
            let userInitiated = navigationAction.navigationType == .linkActivated
            openOutsideOrHere(url, userInitiated: userInitiated)
            return
        }

        switch verdict(for: url) {
        case .allow:
            decisionHandler(.allow)
        case .redirect(let target):
            decisionHandler(.cancel)
            setMasked(true)
            webView.load(URLRequest(url: target))
        case .hide:
            decisionHandler(.cancel)
            setMasked(true)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.scrollView.refreshControl?.endRefreshing()
        evaluateCurrentURL()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        webView.scrollView.refreshControl?.endRefreshing()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        webView.scrollView.refreshControl?.endRefreshing()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // Fail-closed: mask, then reload; the guard re-evaluates the reloaded document.
        setMasked(true)
        activeReel = nil
        webView.reload()
    }

    // MARK: - WKUIDelegate

    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            openOutsideOrHere(url, userInitiated: true)
        }
        return nil
    }

    // MARK: - Links

    private static func shimTarget(_ url: URL) -> URL? {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let u = comps.queryItems?.first(where: { $0.name == "u" })?.value,
              let target = URL(string: u) else { return nil }
        return target
    }

    /// Same-site URL: loaded in this view (the guard decides). Other http(s) URL: Safari, only after a
    /// user action. Anything else (custom schemes, app deep links): dropped.
    private func openOutsideOrHere(_ url: URL, userInitiated: Bool) {
        let scheme = url.scheme?.lowercased()
        if site.isDocumentURL(url) {
            webView.load(URLRequest(url: url))
            return
        }
        guard userInitiated, scheme == "https" || scheme == "http" else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    // MARK: - Bridge

    func handleScriptMessage(_ message: WKScriptMessage) {
        guard message.name == Self.handlerName, message.frameInfo.isMainFrame else { return }
        let origin = message.frameInfo.securityOrigin
        guard origin.`protocol` == "https", Site.host(origin.host, isIn: site.documentDomains) else { return }
        guard let msg = BridgeMessage.parse(message.body) else { return }

        switch msg {
        case .dmReelOpen(let id):
            guard site == .instagram else { return }
            if let url = webView.url, site.isDocumentURL(url), let path = Self.rawPath(url),
               RoutePolicy.isThreadPath(path) {
                dmToken = DMToken(id: id, issuedAtMs: Self.nowMs())
                lastThread = path
                sendToJS(["type": "dmReelGranted", "id": id])
            } else {
                sendToJS(["type": "dmReelDenied", "id": id])
            }
        case .route:
            evaluateCurrentURL()
        case .ready:
            sendToJS(["type": "config", "config": settings.jsConfig])
        case .error:
            break   // debug only; nothing is logged or sent anywhere
        }
    }

    private func sendToJS(_ payload: [String: Any]) {
        guard let js = BridgeMessage.nativeCall(payload) else { return }
        webView.evaluateJavaScript(js, in: nil, in: .defaultClient) { _ in }
    }
}

/// SwiftUI wrapper. The tab owns the web view so it survives tab switches.
struct WebViewContainer: UIViewRepresentable {
    let tab: WebTab

    func makeUIView(context: Context) -> UIView {
        tab.hostView
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}
