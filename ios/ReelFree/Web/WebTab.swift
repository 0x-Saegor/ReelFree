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

/// D07: the web view sits inside the *window* safe area, whatever bars SwiftUI shows over it, so
/// showing or hiding the tab bar never resizes the page. Its own safe-area insets are zero for the
/// same reason (no viewport or `env(safe-area-inset-*)` change when the tab bar appears).
final class ReelFreeWebView: WKWebView {
    override var safeAreaInsets: UIEdgeInsets { .zero }
}

/// Lays its content out inside the window safe area (frames only, recomputed on layout changes).
final class WebHostView: UIView {
    let content = UIView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        content.frame = bounds
        addSubview(content)
    }

    required init?(coder: NSCoder) { nil }

    override func layoutSubviews() {
        super.layoutSubviews()
        var frame = bounds
        if let window = window {
            let insets = window.safeAreaInsets
            let r = convert(bounds, to: window)
            let top = max(0, insets.top - r.minY)
            let left = max(0, insets.left - r.minX)
            let bottom = max(0, r.maxY - (window.bounds.height - insets.bottom))
            let right = max(0, r.maxX - (window.bounds.width - insets.right))
            frame = bounds.inset(by: UIEdgeInsets(top: top, left: left, bottom: bottom, right: right))
        }
        if content.frame != frame { content.frame = frame }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        setNeedsLayout()
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        setNeedsLayout()
    }
}

/// One web tab: a WKWebView locked to one site, its native route guard and the JS bridge.
///
/// The native guard is authoritative (docs/SPEC-iOS.md):
///  1. document loads, in webView(_:decidePolicyFor:decisionHandler:);
///  2. every change of webView.url (KVO), which covers SPA pushState navigations;
///  3. the `route` message from the injected script (redundancy).
@MainActor
final class WebTab: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, UIGestureRecognizerDelegate {

    static let handlerName = "reelfree"

    let site: Site
    private let settings: AppSettings
    let webView: WKWebView
    let hostView = WebHostView()
    /// D07: a tap in the page hides the native bars.
    var onPageTap: (() -> Void)?
    private let maskView = UIView()
    private let maskLabel = UILabel()
    private let proxy = ScriptMessageProxy()
    private var observations: [NSKeyValueObservation] = []
    private var scriptSource: String?
    private var pageScriptSource: String?
    private var backgroundScriptSource: String?

    @Published private(set) var canGoBack = false
    // Not @Published: no view reads it, and publishing would re-render the toolbar on every route.
    private(set) var isMasked = true
    private(set) var isVisible = true

    // Route notifications to the injected script (amendment 4).
    private var lastHistory: RouteVia.Snapshot<WKBackForwardListItem>?
    private var pendingTraversal = false
    private var pendingLoad = false
    private var lastRouteURL: String?

    // D2 state, in memory only. The token is one-shot with a short TTL.
    private struct DMToken {
        let id: String
        let issuedAtMs: Double
    }
    private var dmToken: DMToken?
    private var lastThread: String?
    private var activeReel: String?

    init(site: Site, settings: AppSettings, ruleList: WKContentRuleList? = nil) {
        self.site = site
        self.settings = settings

        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore.default()
        config.limitsNavigationsToAppBoundDomains = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.allowsInlineMediaPlayback = true
        // D08: inline videos may go to Picture in Picture (button or leaving the app).
        config.allowsPictureInPictureMediaPlayback = true
        config.upgradeKnownHostsToHTTPS = true
        config.dataDetectorTypes = []

        if let ruleList = ruleList {
            config.userContentController.add(ruleList)
        }

        webView = ReelFreeWebView(frame: .zero, configuration: config)
        super.init()

        scriptSource = Self.loadScript(site.scriptResource)
        if let page = site.pageScriptResource {
            pageScriptSource = Self.loadScript(page)
        }
        if let bg = site.backgroundScriptResource {
            backgroundScriptSource = Self.loadScript(bg)
        }
        proxy.target = self
        webView.configuration.userContentController.add(proxy, contentWorld: .defaultClient, name: Self.handlerName)
        installUserScripts()

        webView.customUserAgent = Self.safariUserAgent()
        webView.allowsLinkPreview = false
        webView.isInspectable = false
        // D07: left-edge swipe = back (covers pushState entries too).
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.navigationDelegate = self
        webView.uiDelegate = self

        let refresh = UIRefreshControl()
        refresh.addTarget(self, action: #selector(handleRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        buildHostView()
        observeWebView()

        let tap = UITapGestureRecognizer(target: self, action: #selector(handlePageTap))
        tap.cancelsTouchesInView = false
        tap.delaysTouchesBegan = false
        tap.delaysTouchesEnded = false
        tap.delegate = self
        webView.addGestureRecognizer(tap)

        if scriptSource != nil {
            loadDocument(site.homeURL)
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
        // D05: the only script in the page world (YouTube ad pruning; exception reviewed in D06).
        // No message handler exists in .page, so it cannot reach the bridge; it is optional.
        if let page = pageScriptSource {
            ucc.addUserScript(WKUserScript(source: page,
                                           injectionTime: .atDocumentStart,
                                           forMainFrameOnly: true,
                                           in: .page))
        }
        // D08: second and last page-world script (visibility spoof, YouTube only, setting-gated).
        if settings.backgroundPlayback, let bg = backgroundScriptSource {
            ucc.addUserScript(WKUserScript(source: bg,
                                           injectionTime: .atDocumentStart,
                                           forMainFrameOnly: true,
                                           in: .page))
        }
    }

    /// D04: content blocker compiled after launch (AdBlocker); added to the live configuration.
    func apply(ruleList: WKContentRuleList) {
        let ucc = webView.configuration.userContentController
        ucc.remove(ruleList)
        ucc.add(ruleList)
    }

    private func buildHostView() {
        hostView.backgroundColor = .systemBackground
        let content = hostView.content
        webView.frame = content.bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        content.addSubview(webView)

        maskView.backgroundColor = .systemBackground
        maskView.frame = content.bounds
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
        content.addSubview(maskView)
        maskView.isHidden = false
    }

    @objc private func handlePageTap() {
        onPageTap?()
    }

    /// Observe taps only: never compete with WebKit's own recognizers.
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }

    private func observeWebView() {
        observations.append(webView.observe(\.url, options: [.new]) { [weak self] _, _ in
            // WebKit reports URL changes on the main thread: decide (and mask) synchronously,
            // before the next frame. The async hop is only a fallback.
            if Thread.isMainThread {
                MainActor.assumeIsolated {
                    self?.urlDidChange()
                }
            } else {
                DispatchQueue.main.async {
                    self?.urlDidChange()
                }
            }
        })
        observations.append(webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] _, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                let value = self.webView.canGoBack
                if self.canGoBack != value { self.canGoBack = value }
            }
        })
    }

    /// Event-driven only (KVO): no timer or per-frame work on the native side.
    private func urlDidChange() {
        let list = webView.backForwardList
        let snapshot = RouteVia.Snapshot(current: list.currentItem, back: list.backList, forward: list.forwardList)
        let via = RouteVia.classify(previous: lastHistory, current: snapshot,
                                    pendingTraversal: pendingTraversal, pendingLoad: pendingLoad)
        lastHistory = snapshot
        pendingTraversal = false
        pendingLoad = false
        // Amendment 2, native side: a history traversal never spends a DM token.
        if via == .popstate { dmToken = nil }
        evaluateCurrentURL()
        notifyRoute(via)
    }

    /// Amendment 4: onNative({type:"route", path, via}) on each URL change, so the script needs no polling.
    private func notifyRoute(_ via: RouteVia) {
        guard let url = webView.url, site.isDocumentURL(url), let path = Self.rawPath(url) else {
            lastRouteURL = nil
            return
        }
        let key = url.absoluteString
        if key == lastRouteURL && via != .popstate { return }   // KVO may repeat the same URL
        lastRouteURL = key
        sendToJS(["type": "route", "path": path, "via": via.rawValue])
    }

    /// Every document load started by the app goes through here (labelled `via: "load"`).
    private func loadDocument(_ url: URL) {
        pendingLoad = true
        webView.load(URLRequest(url: url))
    }

    // MARK: - Toolbar actions

    func goBack() {
        guard webView.canGoBack else { return }
        pendingTraversal = true
        dmToken = nil
        webView.goBack()
    }

    func goHome() {
        guard scriptSource != nil else { return }
        loadDocument(site.homeURL)
    }

    func reload() {
        guard scriptSource != nil else { return }
        if webView.url == nil {
            loadDocument(site.homeURL)
        } else {
            webView.reload()
        }
    }

    // MARK: - Visibility

    /// Hidden tab: pause, then suspend its media so nothing plays or decodes off screen.
    /// Both calls go to the same web process in order, so no completion handler is needed.
    func setVisible(_ visible: Bool) {
        guard visible != isVisible else { return }
        isVisible = visible
        if visible {
            webView.setAllMediaPlaybackSuspended(false, completionHandler: nil)
        } else {
            webView.pauseAllMediaPlayback(completionHandler: nil)
            webView.setAllMediaPlaybackSuspended(true, completionHandler: nil)
        }
    }

    // MARK: - Background playback & Picture in Picture (D08)
    //
    // Runs in the isolated world (.defaultClient): the page cannot see these calls. Video elements are
    // shared DOM objects, so play()/webkitSetPresentationMode() from here act on the page's player.
    // evaluateJavaScript counts as a user gesture, which WebKit requires to start PiP.

    /// Remembers the videos playing right now (isolated-world global, in memory only).
    private static let markPlayingJS = """
    (function () {
      var all = document.querySelectorAll('video'), playing = [];
      for (var i = 0; i < all.length; i++) {
        var v = all[i];
        if (!v.paused && !v.ended && v.readyState > 2) playing.push(v);
      }
      window.__rfPlaying = playing;
      return playing.length;
    })();
    """

    /// PiP on the playing video, or the largest visible one; back inline if already in PiP.
    /// `onlyPlaying`: used when leaving the app, so a paused video never pops up.
    private static func pipJS(onlyPlaying: Bool) -> String {
        """
        (function () {
          var all = document.querySelectorAll('video'), best = null, bestArea = 0;
          for (var i = 0; i < all.length; i++) {
            var v = all[i];
            if (v.webkitPresentationMode === 'picture-in-picture') {
              \(onlyPlaying ? "return 'already';" : "v.webkitSetPresentationMode('inline'); return 'inline';")
            }
          }
          for (var j = 0; j < all.length; j++) {
            var c = all[j], playing = !c.paused && !c.ended;
            if (\(onlyPlaying ? "!playing" : "false")) continue;
            var r = c.getBoundingClientRect();
            var area = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * r.width;
            if (playing) area += 1e9;
            if (area > bestArea) { best = c; bestArea = area; }
          }
          if (!best || typeof best.webkitSetPresentationMode !== 'function') return 'none';
          best.disablePictureInPicture = false;
          if (best.webkitSupportsPresentationMode && !best.webkitSupportsPresentationMode('picture-in-picture')) return 'unsupported';
          best.webkitSetPresentationMode('picture-in-picture');
          return 'pip';
        })();
        """
    }

    /// WebKit pauses inline video when the app goes to the background: resume what was playing.
    private static let resumeJS = """
    (function () {
      var s = window.__rfPlaying || [], n = 0;
      for (var i = 0; i < s.length; i++) {
        var v = s[i];
        if (!v.isConnected || !v.paused || v.webkitPresentationMode === 'picture-in-picture') continue;
        try { var p = v.play(); if (p && p.catch) p.catch(function () {}); n++; } catch (e) {}
      }
      return n;
    })();
    """

    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    private func runMediaJS(_ js: String) {
        webView.evaluateJavaScript(js, in: nil, in: .defaultClient) { _ in }
    }

    /// Toolbar button.
    func togglePictureInPicture() {
        guard isVisible, !isMasked else { return }
        runMediaJS(Self.pipJS(onlyPlaying: false))
    }

    /// Scene went inactive (home gesture, app switcher, Control Center).
    func appWillResignActive(autoPictureInPicture: Bool) {
        guard isVisible, !isMasked else { return }
        runMediaJS(Self.markPlayingJS)
        if autoPictureInPicture { runMediaJS(Self.pipJS(onlyPlaying: true)) }
    }

    /// Scene is in the background: resume the sound of what was playing (PiP keeps playing on its own).
    func appDidEnterBackground(keepPlaying: Bool) {
        guard keepPlaying, isVisible, !isMasked else { return }
        endBackgroundTask()
        // Keep the app alive long enough for the resume; once audio plays, the audio mode takes over.
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "resume-media") { [weak self] in
            Task { @MainActor in self?.endBackgroundTask() }
        }
        Task { @MainActor [weak self] in
            for delayMs in [250, 550, 800] {
                try? await Task.sleep(for: .milliseconds(delayMs))
                self?.runMediaJS(Self.resumeJS)
            }
            try? await Task.sleep(for: .milliseconds(900))
            self?.endBackgroundTask()
        }
    }

    func appDidBecomeActive() {
        endBackgroundTask()
        runMediaJS("window.__rfPlaying = [];")
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
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
        // Sign-in pages: no route policy there (amendment 1); the injected scripts are no-op.
        if site.isAuxiliaryURL(url) { return .allow }
        guard site.isDocumentURL(url), let path = Self.rawPath(url) else { return .hide }
        switch site {
        case .instagram:
            var ctx = PolicyContext()
            ctx.nowMs = Self.nowMs()
            if let t = dmToken { ctx.token = PolicyToken(id: t.id, issuedAtMs: t.issuedAtMs) }
            ctx.lastThread = lastThread
            ctx.activeReel = activeReel
            ctx.config = settings.policyConfig
            if pendingTraversal { ctx.via = RouteVia.popstate.rawValue }   // dmToken is already nil here
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
        // Fail-closed (F1): no URL, or any about: page other than the initial about:blank, is masked.
        guard let url = webView.url else {
            setMasked(true)
            return
        }
        if url.scheme?.lowercased() == "about" {
            if url.absoluteString.lowercased() != "about:blank" { setMasked(true) }
            return
        }
        switch verdict(for: url) {
        case .allow:
            setMasked(false)
        case .redirect(let target):
            setMasked(true)
            loadDocument(target)
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
        let userInitiated = navigationAction.navigationType == .linkActivated
        guard let frame = navigationAction.targetFrame else {
            decisionHandler(.cancel)
            openOutsideOrHere(url, userInitiated: userInitiated)
            return
        }

        if !frame.isMainFrame {
            // Only blank/srcdoc documents and https frames of this site (no data:/blob: documents).
            if Self.isBlankDocument(url) || site.isFrameURL(url) {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
            }
            return
        }

        if scheme == "about" {
            decisionHandler(Self.isBlankDocument(url) ? .allow : .cancel)
            return
        }

        // Instagram link shim: l.instagram.com/?u=<external url>
        if site == .instagram, url.host?.lowercased() == "l.instagram.com" {
            decisionHandler(.cancel)
            if let target = Self.shimTarget(url) {
                openOutsideOrHere(target, userInitiated: userInitiated)
            }
            return
        }

        if site.isAuxiliaryURL(url) {
            decisionHandler(.allow)
            return
        }

        if !site.isDocumentURL(url) {
            decisionHandler(.cancel)
            openOutsideOrHere(url, userInitiated: userInitiated)
            return
        }

        // D2: history traversal never spends a DM token (Back right after a tap in a thread).
        if navigationAction.navigationType == .backForward {
            dmToken = nil
            pendingTraversal = true
        }

        switch verdict(for: url) {
        case .allow:
            decisionHandler(.allow)
        case .redirect(let target):
            decisionHandler(.cancel)
            pendingTraversal = false
            setMasked(true)
            loadDocument(target)
        case .hide:
            decisionHandler(.cancel)
            pendingTraversal = false
            pendingLoad = false
            setMasked(true)
        }
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        // No downloads or files the web view cannot render.
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.scrollView.refreshControl?.endRefreshing()
        clearPendingNavigation()
        evaluateCurrentURL()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        webView.scrollView.refreshControl?.endRefreshing()
        clearPendingNavigation()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        webView.scrollView.refreshControl?.endRefreshing()
        clearPendingNavigation()
    }

    /// A stale flag would mislabel the next pushState (and drop a DM token for nothing).
    private func clearPendingNavigation() {
        pendingTraversal = false
        pendingLoad = false
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // Fail-closed: mask, then reload; the guard re-evaluates the reloaded document.
        setMasked(true)
        activeReel = nil
        lastHistory = nil
        lastRouteURL = nil
        webView.reload()
    }

    // MARK: - WKUIDelegate

    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            openOutsideOrHere(url, userInitiated: navigationAction.navigationType == .linkActivated)
        }
        return nil
    }

    // MARK: - Links

    private static func isBlankDocument(_ url: URL) -> Bool {
        let s = url.absoluteString.lowercased()
        return s == "about:blank" || s == "about:srcdoc"
    }

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
        if site.isDocumentURL(url) || site.isAuxiliaryURL(url) {
            loadDocument(url)
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
        case .route(let viaHistory):
            if viaHistory { dmToken = nil }
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
