import XCTest
@testable import ReelFree
#if canImport(WebKit)
import WebKit
#endif

/// D04: the embedded content-blocker rules block ads and trackers, never playback or sign-in.
final class AdBlockRulesTests: XCTestCase {

    private func rulesJSON() throws -> String {
        if let json = AdBlockRules.bundledJSON() { return json }
        // Fallback: read the checkout (host-less test runs).
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // ReelFreeTests
            .deletingLastPathComponent()   // ios
            .appendingPathComponent("ReelFree/Resources/adblock-rules.json")
        return try String(contentsOf: url, encoding: .utf8)
    }

    private func filters() throws -> [String] {
        let f = AdBlockRules.blockFilters(try rulesJSON())
        XCTAssertNotNil(f, "adblock-rules.json must be an array of block rules with a url-filter")
        return f ?? []
    }

    func testShapeAndWebKitRegexSubset() throws {
        let filters = try filters()
        XCTAssertGreaterThanOrEqual(filters.count, 10)
        for f in filters {
            // WebKit content blockers support neither disjunction nor counted quantifiers.
            XCTAssertFalse(f.contains("|"), f)
            XCTAssertFalse(f.contains("{"), f)
            XCTAssertTrue(f.hasPrefix("^https?://"), "anchored filters keep matching cheap: \(f)")
            XCTAssertNoThrow(try NSRegularExpression(pattern: f), f)
        }
    }

    func testBlocksAdsAndTrackers() throws {
        let filters = try filters()
        let blocked = [
            "https://googleads.g.doubleclick.net/pagead/id",
            "https://static.doubleclick.net/instream/ad_status.js",
            "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
            "https://www.googleadservices.com/pagead/conversion.js",
            "https://www.google-analytics.com/analytics.js",
            "https://adservice.google.com/ddm/fls/z",
            "https://adservice.google.fr/adsid/integrator.js",
            "https://adservice.google.co.uk/adsid/integrator.js",
            "https://www.google.com/pagead/1p-user-list/1/",
            "https://connect.facebook.net/en_US/fbevents.js",
            "https://connect.facebook.net/signals/config/1",
            "https://www.facebook.com/tr?id=1&ev=PageView",
            "https://www.youtube.com/pagead/viewthroughconversion/1/",
            "https://m.youtube.com/api/stats/ads?ver=2",
            "https://www.youtube.com/ptracking?pltype=content",
            "https://www.youtube.com/get_midroll_info?ei=x",
        ]
        for url in blocked {
            XCTAssertTrue(AdBlockRules.isBlocked(url, filters: filters), "should block \(url)")
        }
    }

    func testNeverBreaksPlaybackOrSignIn() throws {
        let filters = try filters()
        let allowed = [
            "https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1&itag=18",
            "https://m.youtube.com/youtubei/v1/player?prettyPrint=false",
            "https://m.youtube.com/youtubei/v1/next",
            "https://www.youtube.com/s/player/abc/player_ias.vflset/fr_FR/base.js",
            "https://m.youtube.com/api/stats/watchtime?ns=yt",
            "https://m.youtube.com/api/stats/qoe?fmt=18",
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
            "https://accounts.google.com/ServiceLogin?service=youtube",
            "https://consent.google.com/save",
            "https://www.google.com/recaptcha/api.js",
            "https://www.gstatic.com/recaptcha/releases/x/recaptcha__fr.js",
            "https://www.instagram.com/api/graphql",
            "https://www.instagram.com/direct/t/123/",
            "https://scontent-cdg4-1.cdninstagram.com/v/t51/1.jpg",
            "https://static.cdninstagram.com/rsrc.php/v3/x.js",
            "https://video.xx.fbcdn.net/v/t42/1.mp4",
            "https://www.facebook.com/login/",
            "https://www.youtube.com/trending",
        ]
        for url in allowed {
            XCTAssertFalse(AdBlockRules.isBlocked(url, filters: filters), "must not block \(url)")
        }
    }

    func testFingerprintIsStable() {
        XCTAssertEqual(AdBlockRules.fingerprint(""), "cbf29ce484222325")
        XCTAssertEqual(AdBlockRules.fingerprint("a"), AdBlockRules.fingerprint("a"))
        XCTAssertNotEqual(AdBlockRules.fingerprint("a"), AdBlockRules.fingerprint("b"))
    }

    #if canImport(WebKit)
    /// The real compiler: a rule WebKit rejects would silently disable all ad blocking.
    func testWebKitCompilesRules() throws {
        let json = try rulesJSON()
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("rf-rules-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = try XCTUnwrap(WKContentRuleListStore(url: dir))
        let done = expectation(description: "compiled")
        var compiled: WKContentRuleList?
        var failure: Error?
        store.compileContentRuleList(forIdentifier: "test", encodedContentRuleList: json) { list, error in
            compiled = list
            failure = error
            done.fulfill()
        }
        wait(for: [done], timeout: 30)
        XCTAssertNil(failure)
        XCTAssertNotNil(compiled)
    }
    #endif
}
