import XCTest
@testable import ReelFree

/// Amendment 4: classification of a main-frame URL change from the back/forward list.
final class RouteViaTests: XCTestCase {
    private final class Item {}
    private typealias Snap = RouteVia.Snapshot<Item>

    private func classify(_ prev: Snap?, _ cur: Snap, traversal: Bool = false, load: Bool = false) -> RouteVia {
        RouteVia.classify(previous: prev, current: cur, pendingTraversal: traversal, pendingLoad: load)
    }

    func testPushStateIsPush() {
        let a = Item(), b = Item()
        XCTAssertEqual(classify(Snap(current: a, back: [], forward: []), Snap(current: b, back: [a], forward: [])), .push)
    }

    func testReplaceStateIsReplace() {
        let a = Item(), z = Item()
        XCTAssertEqual(classify(Snap(current: a, back: [z], forward: []), Snap(current: a, back: [z], forward: [])), .replace)
    }

    func testBackIsPopstate() {
        let a = Item(), b = Item()
        XCTAssertEqual(classify(Snap(current: b, back: [a], forward: []), Snap(current: a, back: [], forward: [b])), .popstate)
    }

    func testForwardIsPopstateEvenWhenCountsLookLikePush() {
        // back 0 -> 1 and forward 1 -> 0, like a push after a back: identity decides.
        let a = Item(), b = Item()
        XCTAssertEqual(classify(Snap(current: a, back: [], forward: [b]), Snap(current: b, back: [a], forward: [])), .popstate)
    }

    func testPushAfterBackIsPush() {
        let a = Item(), b = Item(), c = Item()
        XCTAssertEqual(classify(Snap(current: a, back: [], forward: [b]), Snap(current: c, back: [a], forward: [])), .push)
    }

    func testMultiStepGoIsPopstate() {
        let a = Item(), b = Item(), c = Item()
        XCTAssertEqual(classify(Snap(current: c, back: [a, b], forward: []), Snap(current: a, back: [], forward: [b, c])), .popstate)
    }

    func testPendingTraversalWins() {
        let a = Item(), b = Item()
        XCTAssertEqual(classify(Snap(current: a, back: [], forward: []), Snap(current: b, back: [a], forward: []),
                                traversal: true, load: true), .popstate)
        XCTAssertEqual(classify(nil, Snap(current: nil, back: [], forward: []), traversal: true), .popstate)
    }

    func testAppLoadIsLoad() {
        let a = Item(), b = Item()
        XCTAssertEqual(classify(Snap(current: a, back: [], forward: []), Snap(current: b, back: [a], forward: []), load: true), .load)
        XCTAssertEqual(classify(nil, Snap(current: a, back: [], forward: []), load: true), .load)
    }

    func testFirstChangeWithoutHistoryIsPush() {
        XCTAssertEqual(classify(nil, Snap(current: Item(), back: [], forward: [])), .push)
    }

    func testWireValues() {
        XCTAssertEqual(RouteVia.popstate.rawValue, "popstate")
        XCTAssertEqual(RouteVia.push.rawValue, "push")
        XCTAssertEqual(RouteVia.replace.rawValue, "replace")
        XCTAssertEqual(RouteVia.load.rawValue, "load")
    }

    func testRouteMessageIsSerialisable() {
        let js = BridgeMessage.nativeCall(["type": "route", "path": "/direct/t/123/", "via": RouteVia.popstate.rawValue])
        XCTAssertEqual(js, #"window.reelfree && window.reelfree.onNative({"path":"\/direct\/t\/123\/","type":"route","via":"popstate"});"#)
    }
}
