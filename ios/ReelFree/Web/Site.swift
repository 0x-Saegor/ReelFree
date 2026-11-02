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

    /// Registrable domains a top-level document of this tab may live on.
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
        case .youtube: return ["youtube.com", "ytimg.com", "googlevideo.com"]
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

    func isFrameURL(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && Site.host(url.host, isIn: frameDomains)
    }
}
