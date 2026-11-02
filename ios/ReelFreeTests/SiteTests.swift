import XCTest
@testable import ReelFree

/// Freezes SPEC-iOS amendment 1: which hosts each tab guards, loads as sign-in pages or allows in frames (F5).
final class SiteTests: XCTestCase {

    private func url(_ s: String) -> URL { URL(string: s)! }

    func testHostMatchesOnLabelBoundary() {
        XCTAssertTrue(Site.host("instagram.com", isIn: ["instagram.com"]))
        XCTAssertTrue(Site.host("www.instagram.com", isIn: ["instagram.com"]))
        XCTAssertTrue(Site.host("WWW.Instagram.COM", isIn: ["instagram.com"]))
        XCTAssertFalse(Site.host("evilinstagram.com", isIn: ["instagram.com"]))
        XCTAssertFalse(Site.host("instagram.com.evil.com", isIn: ["instagram.com"]))
        XCTAssertFalse(Site.host("instagram.co", isIn: ["instagram.com"]))
    }

    func testHostRejectsEmptyNilAndTrailingDot() {
        XCTAssertFalse(Site.host(nil, isIn: ["instagram.com"]))
        XCTAssertFalse(Site.host("", isIn: ["instagram.com"]))
        // Fail-closed: a fully qualified "instagram.com." is not treated as the site.
        XCTAssertFalse(Site.host("www.instagram.com.", isIn: ["instagram.com"]))
    }

    func testDocumentURLsRequireHttpsAndOwnSite() {
        XCTAssertTrue(Site.instagram.isDocumentURL(url("https://www.instagram.com/direct/inbox/")))
        XCTAssertFalse(Site.instagram.isDocumentURL(url("http://www.instagram.com/")))
        XCTAssertFalse(Site.instagram.isDocumentURL(url("https://m.youtube.com/")))
        XCTAssertTrue(Site.youtube.isDocumentURL(url("https://m.youtube.com/watch?v=dQw4w9WgXcQ")))
        XCTAssertFalse(Site.youtube.isDocumentURL(url("https://accounts.google.com/")))
    }

    func testAuxiliaryHostsAreExact() {
        XCTAssertTrue(Site.youtube.isAuxiliaryURL(url("https://accounts.google.com/ServiceLogin")))
        XCTAssertTrue(Site.youtube.isAuxiliaryURL(url("https://consent.google.com/m")))
        XCTAssertFalse(Site.youtube.isAuxiliaryURL(url("https://www.google.com/search?q=x")))
        XCTAssertFalse(Site.youtube.isAuxiliaryURL(url("https://evil.accounts.google.com/")))
        XCTAssertFalse(Site.youtube.isAuxiliaryURL(url("http://accounts.google.com/")))
        XCTAssertFalse(Site.instagram.isAuxiliaryURL(url("https://accounts.google.com/")))
    }

    func testFrameURLsLimitGoogle() {
        XCTAssertTrue(Site.youtube.isFrameURL(url("https://www.youtube.com/embed/x")))
        XCTAssertTrue(Site.youtube.isFrameURL(url("https://i.ytimg.com/vi/x/hq.jpg")))
        XCTAssertTrue(Site.youtube.isFrameURL(url("https://accounts.google.com/RotateCookiesPage")))
        XCTAssertTrue(Site.youtube.isFrameURL(url("https://www.google.com/recaptcha/api2/anchor")))
        XCTAssertFalse(Site.youtube.isFrameURL(url("https://www.google.com/search?q=x")))
        XCTAssertFalse(Site.youtube.isFrameURL(url("https://www.google.com/recaptchaX/")))
        XCTAssertFalse(Site.youtube.isFrameURL(url("https://maps.google.com/")))
    }

    func testInstagramFramesStayOnInstagramCDNs() {
        XCTAssertTrue(Site.instagram.isFrameURL(url("https://www.instagram.com/")))
        XCTAssertTrue(Site.instagram.isFrameURL(url("https://scontent.cdninstagram.com/x")))
        XCTAssertTrue(Site.instagram.isFrameURL(url("https://static.xx.fbcdn.net/x")))
        XCTAssertFalse(Site.instagram.isFrameURL(url("https://www.facebook.com/")))
        XCTAssertFalse(Site.instagram.isFrameURL(url("https://www.google.com/recaptcha/api2/anchor")))
        XCTAssertFalse(Site.instagram.isFrameURL(url("http://www.instagram.com/")))
    }
}
