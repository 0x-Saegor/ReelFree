import Foundation

/// The two sites the app can show. Each tab is locked to one site.
enum Site: String {
    case instagram
    case youtube

    var title: String {
        switch self {
        case .instagram: return "Instagram"
        case .youtube: return "YouTube"
        }
    }

    var homeURL: URL {
        switch self {
        case .instagram: return URL(string: "https://www.instagram.com/")!
        case .youtube: return URL(string: "https://m.youtube.com/")!
        }
    }

    /// Bundle resource name of the injected script (web/<name>.js).
    var scriptResource: String { rawValue }

    /// D05: optional script injected in the page world (YouTube ad pruning only). It gets no bridge.
    var pageScriptResource: String? {
        switch self {
        case .instagram: return nil
        case .youtube: return "youtube-ads"
        }
    }

    /// Registrable domains whose documents are guarded by the route policy (SPEC-iOS, amendment 1).
    var documentDomains: [String] {
        switch self {
        case .instagram: return ["instagram.com"]
        case .youtube: return ["youtube.com"]
        }
    }

    /// Domains a sub-frame of this tab may load (subset of WKAppBoundDomains).
    var frameDomains: [String] {
        switch self {
        case .instagram: return ["instagram.com", "cdninstagram.com", "fbcdn.net"]
        case .youtube: return ["youtube.com", "ytimg.com", "googlevideo.com", "gstatic.com"]
        }
    }

    /// Exact Google hosts a YouTube sub-frame may load (F4); www.google.com only under /recaptcha/.
    private var frameGoogleHosts: [String] {
        switch self {
        case .instagram: return []
        case .youtube: return ["accounts.google.com", "consent.google.com"]
        }
    }

    /// Exact hosts (not domains) a top-level document may also live on, outside the route policy:
    /// the Google sign-in / consent flow of YouTube. Any other google.com page opens in Safari.
    var auxiliaryHosts: [String] {
        switch self {
        case .instagram: return []
        case .youtube: return ["accounts.google.com", "consent.google.com"]
        }
    }

    static func host(_ host: String?, isIn domains: [String]) -> Bool {
        guard let h = host?.lowercased(), !h.isEmpty else { return false }
        for d in domains where h == d || h.hasSuffix("." + d) {
            return true
        }
        return false
    }

    func isDocumentURL(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && Site.host(url.host, isIn: documentDomains)
    }

    func isAuxiliaryURL(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https", let h = url.host?.lowercased() else { return false }
        return auxiliaryHosts.contains(h)
    }

    func isFrameURL(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https", let h = url.host?.lowercased() else { return false }
        if Site.host(h, isIn: frameDomains) { return true }
        if frameGoogleHosts.contains(h) { return true }
        if self == .youtube && h == "www.google.com" {
            let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? ""
            return path.hasPrefix("/recaptcha/")
        }
        return false
    }
}
