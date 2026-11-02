import XCTest
@testable import ReelFree

/// Runs the shared vectors (tests/vectors/policy.json, owned by rf-web) against the native policy,
/// plus a few built-in cases so the guard stays covered even if the vectors change shape.
final class RoutePolicyTests: XCTestCase {

    private static let nowMs: Double = 1_800_000_000_000

    // MARK: - Vector loading

    private func vectorsURL(_ name: String) -> URL? {
        if let url = Bundle(for: RoutePolicyTests.self).url(forResource: name, withExtension: "json") {
            return url
        }
        // Fallback: simulator tests can read the checkout directly.
        let repo = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // ReelFreeTests
            .deletingLastPathComponent()   // ios
            .deletingLastPathComponent()   // repo root
        let url = repo.appendingPathComponent("tests/vectors/\(name).json")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    // JSON booleans decode as a dedicated NSNumber subclass (__NSCFBoolean on Apple platforms).
    private static let boolNumberType = type(of: NSNumber(value: true))

    private static func isJSONBool(_ v: Any?) -> Bool {
        guard let n = v as? NSNumber else { return false }
        return type(of: n) == boolNumberType
    }

    private static func isJSONNumber(_ v: Any?) -> Bool {
        guard let n = v as? NSNumber else { return false }
        return type(of: n) != boolNumberType
    }

    private static func context(from json: [String: Any]) -> PolicyContext {
        var ctx = PolicyContext()
        ctx.nowMs = nowMs
        if let t = json["token"] as? [String: Any] {
            let id = t["id"] as? String ?? ""
            var issuedAt: Double?
            if isJSONNumber(t["ageMs"]), let age = (t["ageMs"] as? NSNumber)?.doubleValue {
                issuedAt = nowMs - age
            }
            ctx.token = PolicyToken(id: id, issuedAtMs: issuedAt)
        }
        ctx.lastThread = json["lastThread"] as? String
        ctx.activeReel = json["activeReel"] as? String
        ctx.via = json["via"] as? String
        if let c = json["config"] as? [String: Any] {
            if isJSONBool(c["blockExplore"]), let b = (c["blockExplore"] as? NSNumber)?.boolValue {
                ctx.config.blockExplore = b
            }
            if isJSONNumber(c["dmReelTtlMs"]), let ttl = (c["dmReelTtlMs"] as? NSNumber)?.doubleValue,
               ttl >= 0, ttl.isFinite {
                ctx.config.dmReelTtlMs = ttl
            }
            if let mode = c["feedMode"] as? String, mode == "limited" || mode == "off" {
                ctx.config.feedMode = mode
            }
        }
        return ctx
    }

    private func check(_ name: String, key: String, expected: Any, actual: Any?) {
        if expected is NSNull {
            XCTAssertNil(actual, "\(name): \(key) should be null, got \(String(describing: actual))")
        } else if Self.isJSONBool(expected) {
            XCTAssertEqual(actual as? Bool, (expected as? NSNumber)?.boolValue, "\(name): \(key)")
        } else {
            XCTAssertEqual(actual as? String, expected as? String, "\(name): \(key)")
        }
    }

    func testSharedVectors() throws {
        guard let url = vectorsURL("policy") else {
            XCTFail("tests/vectors/policy.json not found (bundle resource or checkout)")
            return
        }
        try runVectors(url, defaultScript: "instagram")
    }

    /// SPEC-iOS amendment 3: YouTube vectors, same format, produced by rf-web.
    func testYouTubeVectors() throws {
        guard let url = vectorsURL("youtube") else {
            throw XCTSkip("tests/vectors/youtube.json not published yet")
        }
        try runVectors(url, defaultScript: "youtube")
    }

    private func runVectors(_ url: URL, defaultScript: String) throws {
        let file = url.lastPathComponent
        let data = try Data(contentsOf: url)
        guard let vectors = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            XCTFail("\(file) must be an array of objects")
            return
        }
        XCTAssertFalse(vectors.isEmpty, "\(file) is empty")

        for (i, v) in vectors.enumerated() {
            let name = (v["name"] as? String) ?? "vector #\(i)"
            guard let path = v["path"] as? String, let expect = v["expect"] as? [String: Any] else {
                XCTFail("\(name): missing path or expect")
                continue
            }
            let ctxJSON = v["ctx"] as? [String: Any] ?? [:]
            let script = (v["script"] as? String) ?? defaultScript

            var actual: [String: Any?] = [:]
            if script == "youtube" {
                let cfg = ctxJSON["config"] as? [String: Any] ?? [:]
                let hideHome = Self.isJSONBool(cfg["hideHomeFeed"]) && ((cfg["hideHomeFeed"] as? NSNumber)?.boolValue ?? false)
                let d = YouTubePolicy.decide(path: path, hideHomeFeed: hideHome)
                actual = ["action": d.action.rawValue, "to": d.to, "reason": d.reason, "mode": d.mode]
            } else {
                let d = RoutePolicy.decide(path: path, ctx: Self.context(from: ctxJSON))
                actual = ["action": d.action.rawValue, "to": d.to, "consumeToken": d.consumeToken,
                          "reason": d.reason, "mode": d.mode, "reelId": d.reelId]
            }

            for (key, expected) in expect {
                guard let slot = actual[key] else {
                    XCTFail("\(name): unknown expect key \(key)")
                    continue
                }
                check(name, key: key, expected: expected, actual: slot)
            }
        }
    }

    // MARK: - Built-in cases (mirror tests/unit/decide.test.js)

    private func ctx(token: PolicyToken? = nil, lastThread: String? = nil, activeReel: String? = nil) -> PolicyContext {
        var c = PolicyContext()
        c.nowMs = Self.nowMs
        c.token = token
        c.lastThread = lastThread
        c.activeReel = activeReel
        return c
    }

    func testReelsFeedRedirectsHome() {
        let d = RoutePolicy.decide(path: "/reels/", ctx: ctx())
        XCTAssertEqual(d.action, .redirect)
        XCTAssertEqual(d.to, "/")
        XCTAssertEqual(d.reason, "R2")
    }

    func testReelWithoutTokenIsBlocked() {
        let d = RoutePolicy.decide(path: "/reel/AbCdE12345/", ctx: ctx())
        XCTAssertEqual(d.action, .redirect)
        XCTAssertEqual(d.reason, "R3")
    }

    func testReelWithValidTokenIsAllowed() {
        let token = PolicyToken(id: "AbCdE12345", issuedAtMs: Self.nowMs - 2_000)
        let d = RoutePolicy.decide(path: "/reel/AbCdE12345/", ctx: ctx(token: token, lastThread: "/direct/t/123/"))
        XCTAssertEqual(d.action, .allow)
        XCTAssertTrue(d.consumeToken)
        XCTAssertEqual(d.reelId, "AbCdE12345")
        XCTAssertEqual(d.mode, "dm-reel")
    }

    func testExpiredTokenGoesBackToThread() {
        let token = PolicyToken(id: "AbCdE12345", issuedAtMs: Self.nowMs - 20_000)
        let d = RoutePolicy.decide(path: "/reel/AbCdE12345/", ctx: ctx(token: token, lastThread: "/direct/t/123/"))
        XCTAssertEqual(d.action, .redirect)
        XCTAssertEqual(d.to, "/direct/t/123/")
        XCTAssertEqual(d.reason, "D3")
        XCTAssertTrue(d.consumeToken)
    }

    func testEncodedTraversalIsHidden() {
        XCTAssertEqual(RoutePolicy.decide(path: "/direct%2F..%2Freels/", ctx: ctx()).action, .hide)
        XCTAssertEqual(RoutePolicy.decide(path: "/%E0%A4%A/", ctx: ctx()).action, .hide)
        XCTAssertEqual(RoutePolicy.decide(path: "/direct/../reels/", ctx: ctx()).action, .hide)
    }

    func testMatrixParamsCannotBypass() {
        XCTAssertEqual(RoutePolicy.decide(path: "/reels;x/", ctx: ctx()).action, .redirect)
        XCTAssertEqual(RoutePolicy.decide(path: "/REELS/", ctx: ctx()).action, .redirect)
    }

    func testExploreSearchAllowedGridBlocked() {
        XCTAssertEqual(RoutePolicy.decide(path: "/explore/search/", ctx: ctx()).action, .allow)
        XCTAssertEqual(RoutePolicy.decide(path: "/explore/", ctx: ctx()).action, .redirect)
        XCTAssertEqual(RoutePolicy.decide(path: "/explore/tags/cats/", ctx: ctx()).action, .redirect)
    }

    func testProfileReelsTab() {
        let d = RoutePolicy.decide(path: "/some.user/reels/", ctx: ctx())
        XCTAssertEqual(d.action, .redirect)
        XCTAssertEqual(d.to, "/some.user/")
    }

    func testThreadPathValidation() {
        XCTAssertTrue(RoutePolicy.isThreadPath("/direct/t/123/"))
        XCTAssertTrue(RoutePolicy.isThreadPath("/direct/t/abc_D-9"))
        XCTAssertFalse(RoutePolicy.isThreadPath("/direct/t/"))
        XCTAssertFalse(RoutePolicy.isThreadPath("/direct/t/12//"))
        XCTAssertFalse(RoutePolicy.isThreadPath("/direct/inbox/"))
    }

    func testMediaIdFromPath() {
        XCTAssertEqual(RoutePolicy.mediaId(fromPath: "/reel/AbC12/"), "AbC12")
        XCTAssertEqual(RoutePolicy.mediaId(fromPath: "/user/p/XyZ99/"), "XyZ99")
        XCTAssertNil(RoutePolicy.mediaId(fromPath: "/reels/audio/"))
        XCTAssertNil(RoutePolicy.mediaId(fromPath: "/direct/t/1/"))
    }

    func testYouTubeShortsRedirect() {
        let d = YouTubePolicy.decide(path: "/shorts/dQw4w9WgXcQ", hideHomeFeed: false)
        XCTAssertEqual(d.action, .redirect)
        XCTAssertEqual(d.to, "/watch?v=dQw4w9WgXcQ")
        XCTAssertEqual(YouTubePolicy.decide(path: "/shorts/bad", hideHomeFeed: false).to, "/")
        XCTAssertEqual(YouTubePolicy.decide(path: "/@chan/shorts", hideHomeFeed: false).to, "/@chan")
        XCTAssertEqual(YouTubePolicy.decide(path: "/watch", hideHomeFeed: false).action, .allow)
    }
}
