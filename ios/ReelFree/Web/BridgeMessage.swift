import Foundation

/// Validated JS -> native message (docs/SPEC-iOS.md, "Bridge JS <-> natif").
/// Anything that does not match exactly is dropped.
enum BridgeMessage: Equatable {
    case dmReelOpen(id: String)
    case route(viaHistory: Bool)
    case ready(script: String, version: String)
    case error

    /// ^[A-Za-z0-9_-]{5,64}$
    static func isShortcode(_ s: String) -> Bool {
        RoutePolicy.matchesClass(s, extra: "_-", minLen: 5, maxLen: 64)
    }

    static func parse(_ body: Any) -> BridgeMessage? {
        guard let dict = body as? [String: Any], let type = dict["type"] as? String else { return nil }
        switch type {
        case "dmReelOpen":
            guard let id = dict["id"] as? String, isShortcode(id) else { return nil }
            return .dmReelOpen(id: id)
        case "route":
            // The path itself is not trusted: the guard re-reads webView.url.
            // Optional `via: "popstate"` (history traversal) makes the native side drop its DM token.
            return .route(viaHistory: (dict["via"] as? String) == "popstate")
        case "ready":
            guard let script = dict["script"] as? String, script == "instagram" || script == "youtube" else { return nil }
            let version = (dict["version"] as? String) ?? ""
            guard version.count <= 32 else { return nil }
            return .ready(script: script, version: version)
        case "error":
            return .error
        default:
            return nil
        }
    }

    /// JSON literal for `window.reelfree.onNative(...)`, or nil if not serialisable.
    static func nativeCall(_ payload: [String: Any]) -> String? {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8) else { return nil }
        return "window.reelfree && window.reelfree.onNative(\(json));"
    }
}
