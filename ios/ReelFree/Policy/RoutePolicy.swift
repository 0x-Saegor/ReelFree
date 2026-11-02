import Foundation

// Native route policy (authoritative guard). Port of decide() in web/instagram.js and decideYT()
// in web/youtube.js: the semantics MUST stay identical. Both are validated against the shared
// vectors in tests/vectors/policy.json (docs/SPEC-iOS.md).
//
// Pure functions: no clock, no storage, no UIKit/WebKit access.

struct PolicyConfig: Equatable {
    var blockExplore: Bool = true
    var dmReelTtlMs: Double = 10_000
    var feedMode: String = "limited"   // "limited" | "off"
}

struct PolicyToken: Equatable {
    var id: String
    var issuedAtMs: Double?            // nil = malformed token (never valid)
}

struct PolicyContext {
    var nowMs: Double?
    var token: PolicyToken?
    var lastThread: String?
    var activeReel: String?
    var config = PolicyConfig()
}

enum PolicyAction: String {
    case allow
    case redirect
    case hide
}

struct Decision: Equatable {
    let action: PolicyAction
    let to: String?            // same-origin path, only when action == .redirect
    let consumeToken: Bool
    let reason: String
    let mode: String
    let reelId: String?
}

enum RoutePolicy {

    static let defaultTtlMs: Double = 10_000

    // MARK: - Character-class helpers (ASCII only, equivalent to the JS regexes)

    static func isAsciiAlnum(_ u: Unicode.Scalar) -> Bool {
        switch u.value {
        case 0x30...0x39, 0x41...0x5A, 0x61...0x7A: return true
        default: return false
        }
    }

    /// True when `s` has between `minLen` and `maxLen` scalars, all in [A-Za-z0-9] + `extra`.
    static func matchesClass(_ s: String, extra: String, minLen: Int, maxLen: Int) -> Bool {
        let scalars = s.unicodeScalars
        let n = scalars.count
        if n < minLen || n > maxLen { return false }
        for u in scalars {
            if !(isAsciiAlnum(u) || extra.unicodeScalars.contains(u)) { return false }
        }
        return true
    }

    /// ^[A-Za-z0-9_-]{1,64}$
    static func isReelId(_ s: String) -> Bool {
        matchesClass(s, extra: "_-", minLen: 1, maxLen: 64)
    }

    /// ^[A-Za-z0-9._]{1,30}$
    static func isUsername(_ s: String) -> Bool {
        matchesClass(s, extra: "._", minLen: 1, maxLen: 30)
    }

    /// ^/direct/t/[A-Za-z0-9_-]{1,128}/?$
    static func isThreadPath(_ s: String) -> Bool {
        let prefix = "/direct/t/"
        guard s.unicodeScalars.starts(with: prefix.unicodeScalars) else { return false }
        var rest = dropScalars(s, prefix.unicodeScalars.count)
        if rest.unicodeScalars.last == "/" {
            rest = String(String.UnicodeScalarView(rest.unicodeScalars.dropLast()))
        }
        return matchesClass(rest, extra: "_-", minLen: 1, maxLen: 128)
    }

    /// `s` without its first `n` Unicode scalars (not Characters: a combining mark must not be swallowed).
    static func dropScalars(_ s: String, _ n: Int) -> String {
        String(String.UnicodeScalarView(s.unicodeScalars.dropFirst(n)))
    }

    /// /%2f|%5c|%2e%2e/i — encoded separators or dot-segments.
    static func hasEncodedSeparator(_ p: String) -> Bool {
        let lower = p.lowercased()
        return lower.contains("%2f") || lower.contains("%5c") || lower.contains("%2e%2e")
    }

    /// /\\/ or /(^|\/)\.\.?(\/|$)/ on the decoded path.
    static func hasBackslashOrDotSegment(_ decoded: String) -> Bool {
        if decoded.contains("\\") { return true }
        return decoded.components(separatedBy: "/").contains { $0 == "." || $0 == ".." }
    }

    /// path.split('?')[0].split('#')[0]
    static func stripQueryAndFragment(_ path: String) -> String {
        let noQuery = path.components(separatedBy: "?").first ?? ""
        return noQuery.components(separatedBy: "#").first ?? ""
    }

    /// Segments split on "/", ";params" dropped, empty segments removed (raw case).
    static func rawSegments(_ decoded: String) -> [String] {
        decoded.components(separatedBy: "/")
            .map { $0.components(separatedBy: ";").first ?? "" }
            .filter { !$0.isEmpty }
    }

    // MARK: - Results

    private static func result(_ action: PolicyAction, _ to: String?, _ consume: Bool,
                               _ reason: String, _ mode: String, _ reelId: String?) -> Decision {
        Decision(action: action,
                 to: action == .redirect ? to : nil,
                 consumeToken: consume,
                 reason: reason,
                 mode: mode,
                 reelId: reelId)
    }

    private static func hide(_ reason: String) -> Decision {
        result(.hide, nil, false, reason, "blocked", nil)
    }

    private static func block(_ to: String, _ reason: String, _ consume: Bool) -> Decision {
        result(.redirect, to, consume, reason, "blocked", nil)
    }

    private static func validThread(_ ctx: PolicyContext) -> String? {
        if let t = ctx.lastThread, isThreadPath(t) { return t }
        return nil
    }

    private static func tokenValid(_ token: PolicyToken?, _ id: String, _ ctx: PolicyContext, _ ttl: Double) -> Bool {
        guard let token = token, token.id == id, let ts = token.issuedAtMs, let now = ctx.nowMs else { return false }
        let age = now - ts
        return age >= 0 && age <= ttl
    }

    // MARK: - Instagram

    private static func decideReel(_ id: String, _ ctx: PolicyContext, _ ttl: Double) -> Decision {
        let token = ctx.token
        let consume = token != nil   // any token seen on a reel route is spent (valid or not)
        let lastThread = validThread(ctx)
        let back = lastThread ?? "/"
        let hasActive = !(ctx.activeReel ?? "").isEmpty
        let reasonDeny = (lastThread != nil || hasActive) ? "D3" : "R3"

        if !isReelId(id) { return block(back, reasonDeny, consume) }

        // Same reel already admitted on this page: re-evaluation, not a new navigation.
        if let active = ctx.activeReel, active == id {
            return result(.allow, nil, consume, "D2", "dm-reel", id)
        }
        if tokenValid(token, id, ctx, ttl) { return result(.allow, nil, true, "D2", "dm-reel", id) }
        return block(back, reasonDeny, consume)
    }

    // /p/<id>/: a regular post, but Instagram may serve a reel under the same shortcode.
    private static func decidePost(_ id: String, _ ctx: PolicyContext, _ ttl: Double) -> Decision {
        let token = ctx.token
        if let active = ctx.activeReel, !active.isEmpty, active != id {
            return block(validThread(ctx) ?? "/", "D3", token != nil)
        }
        if isReelId(id) {
            if let active = ctx.activeReel, active == id {
                return result(.allow, nil, token?.id == id, "D2", "dm-reel", id)
            }
            if tokenValid(token, id, ctx, ttl) { return result(.allow, nil, true, "D2", "dm-reel", id) }
        }
        return result(.allow, nil, false, "default", "post", nil)
    }

    /// Instagram policy for a raw (percent-encoded) path, as `location.pathname` would give it.
    static func decide(path: String, ctx: PolicyContext) -> Decision {
        let cfg = ctx.config
        let ttl = (cfg.dmReelTtlMs >= 0 && cfg.dmReelTtlMs.isFinite) ? cfg.dmReelTtlMs : defaultTtlMs
        let feedMode = (cfg.feedMode == "off") ? "off" : "limited"

        let p = stripQueryAndFragment(path)
        if hasEncodedSeparator(p) { return hide("X3-path") }
        guard let decoded = p.removingPercentEncoding else { return hide("X3-decode") }
        if hasBackslashOrDotSegment(decoded) { return hide("X3-path") }

        let raw = rawSegments(decoded)
        let seg = raw.map { $0.lowercased() }

        // Home feed.
        if seg.isEmpty {
            return result(.allow, nil, false, "S", feedMode == "off" ? "feed-off" : "feed", nil)
        }

        // R2 / R3
        if seg[0] == "reels" {
            if seg.count == 2 && seg[1] != "audio" { return decideReel(raw[1], ctx, ttl) }
            return block("/", "R2", false)
        }
        if seg[0] == "reel" || seg[0] == "tv" {
            if seg.count >= 2 { return decideReel(raw[1], ctx, ttl) }
            return block("/", "R2", false)
        }

        // R5: Explore. The bare account search page stays usable.
        if seg[0] == "explore" {
            if !cfg.blockExplore { return result(.allow, nil, false, "R5-off", "explore", nil) }
            if seg.count == 2 && seg[1] == "search" { return result(.allow, nil, false, "R5-search", "search", nil) }
            return block("/", "R5", false)
        }

        // Posts (possibly a reel in disguise).
        if seg[0] == "p" && seg.count >= 2 { return decidePost(raw[1], ctx, ttl) }
        if seg.count >= 3 && seg[1] == "p" { return decidePost(raw[2], ctx, ttl) }

        // DMs.
        if seg[0] == "direct" { return result(.allow, nil, false, "D1", "dm", nil) }

        // Profile-scoped reels.
        if seg.count >= 2 && (seg[1] == "reel" || seg[1] == "reels" || seg[1] == "tv") {
            if seg.count >= 3 { return decideReel(raw[2], ctx, ttl) }
            return block(isUsername(raw[0]) ? "/" + raw[0] + "/" : "/", "R2-profile", false)
        }

        return result(.allow, nil, false, "default", "other", nil)
    }

    /// Media shortcode targeted by a path (/reel/<id>, /reels/<id>, /tv/<id>, /p/<id>, /<user>/{reel,p}/<id>), or nil.
    static func mediaId(fromPath path: String) -> String? {
        if hasEncodedSeparator(path) { return nil }
        guard let decoded = stripQueryAndFragment(path).removingPercentEncoding else { return nil }
        let raw = rawSegments(decoded)
        let seg = raw.map { $0.lowercased() }
        var id: String?
        if seg.count >= 2 && (seg[0] == "reel" || seg[0] == "tv" || seg[0] == "p") {
            id = raw[1]
        } else if seg.count == 2 && seg[0] == "reels" && seg[1] != "audio" {
            id = raw[1]
        } else if seg.count >= 3 && (seg[1] == "reel" || seg[1] == "reels" || seg[1] == "tv" || seg[1] == "p") {
            id = raw[2]
        }
        if let id = id, isReelId(id) { return id }
        return nil
    }
}

// MARK: - YouTube (port of decideYT in web/youtube.js)

struct YouTubeDecision: Equatable {
    let action: PolicyAction
    let to: String?
    let reason: String
    let mode: String
}

enum YouTubePolicy {

    /// ^[A-Za-z0-9_-]{11}$
    static func isVideoId(_ s: String) -> Bool {
        RoutePolicy.matchesClass(s, extra: "_-", minLen: 11, maxLen: 11)
    }

    private static func result(_ action: PolicyAction, _ to: String?, _ reason: String, _ mode: String) -> YouTubeDecision {
        YouTubeDecision(action: action, to: action == .redirect ? to : nil, reason: reason, mode: mode)
    }

    private static func channelRoot(_ raw: [String], _ seg: [String]) -> String {
        // ^@[A-Za-z0-9._-]{1,100}$
        if seg.count >= 1, raw[0].unicodeScalars.first == "@",
           RoutePolicy.matchesClass(RoutePolicy.dropScalars(raw[0], 1), extra: "._-", minLen: 1, maxLen: 100) {
            return "/" + raw[0]
        }
        // ^UC[A-Za-z0-9_-]{22}$
        if seg.count >= 2 && seg[0] == "channel" && raw[1].unicodeScalars.starts(with: "UC".unicodeScalars)
            && RoutePolicy.matchesClass(RoutePolicy.dropScalars(raw[1], 2), extra: "_-", minLen: 22, maxLen: 22) {
            return "/channel/" + raw[1]
        }
        // ^(?=.*[A-Za-z0-9])[A-Za-z0-9._-]{1,100}$
        if seg.count >= 2 && (seg[0] == "c" || seg[0] == "user")
            && RoutePolicy.matchesClass(raw[1], extra: "._-", minLen: 1, maxLen: 100)
            && raw[1].unicodeScalars.contains(where: { RoutePolicy.isAsciiAlnum($0) }) {
            return "/" + seg[0] + "/" + raw[1]
        }
        return "/"
    }

    static func decide(path: String, hideHomeFeed: Bool) -> YouTubeDecision {
        let p = RoutePolicy.stripQueryAndFragment(path)
        if RoutePolicy.hasEncodedSeparator(p) { return result(.hide, nil, "Y-path", "blocked") }
        guard let decoded = p.removingPercentEncoding else { return result(.hide, nil, "Y-decode", "blocked") }
        if RoutePolicy.hasBackslashOrDotSegment(decoded) { return result(.hide, nil, "Y-path", "blocked") }
        let raw = RoutePolicy.rawSegments(decoded)
        let seg = raw.map { $0.lowercased() }

        if seg.isEmpty { return result(.allow, nil, "Y-home", hideHomeFeed ? "home-off" : "home") }

        if seg[0] == "shorts" {
            if seg.count >= 2 && isVideoId(raw[1]) {
                return result(.redirect, "/watch?v=" + raw[1], "Y-shorts", "shorts")
            }
            return result(.redirect, "/", "Y-shorts-invalid", "shorts")
        }
        if seg[0] == "feed" && seg.count >= 2 && seg[1] == "shorts" {
            return result(.redirect, "/", "Y-shorts-feed", "shorts")
        }
        if seg.contains("shorts") && seg[0] != "watch" && seg[0] != "results" {
            return result(.redirect, channelRoot(raw, seg), "Y-shorts-tab", "shorts")
        }
        if seg[0] == "watch" { return result(.allow, nil, "Y-watch", "watch") }
        return result(.allow, nil, "default", "other")
    }
}
