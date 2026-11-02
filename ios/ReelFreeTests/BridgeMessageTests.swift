import XCTest
@testable import ReelFree

final class BridgeMessageTests: XCTestCase {

    func testDmReelOpenValidatesShortcode() {
        XCTAssertEqual(BridgeMessage.parse(["type": "dmReelOpen", "id": "AbCdE12345"]), .dmReelOpen(id: "AbCdE12345"))
        XCTAssertNil(BridgeMessage.parse(["type": "dmReelOpen", "id": "abc"]))
        XCTAssertNil(BridgeMessage.parse(["type": "dmReelOpen", "id": "AbC/../x"]))
        XCTAssertNil(BridgeMessage.parse(["type": "dmReelOpen", "id": String(repeating: "a", count: 65)]))
        XCTAssertNil(BridgeMessage.parse(["type": "dmReelOpen", "id": 12345]))
        XCTAssertNil(BridgeMessage.parse(["type": "dmReelOpen"]))
    }

    func testRouteViaHistory() {
        XCTAssertEqual(BridgeMessage.parse(["type": "route", "path": "/"]), .route(viaHistory: false))
        XCTAssertEqual(BridgeMessage.parse(["type": "route", "path": "/", "via": "popstate"]), .route(viaHistory: true))
        XCTAssertEqual(BridgeMessage.parse(["type": "route", "via": 1]), .route(viaHistory: false))
    }

    func testReadyAndUnknown() {
        XCTAssertEqual(BridgeMessage.parse(["type": "ready", "script": "instagram", "version": "1.0.0"]),
                       .ready(script: "instagram", version: "1.0.0"))
        XCTAssertNil(BridgeMessage.parse(["type": "ready", "script": "other"]))
        XCTAssertNil(BridgeMessage.parse(["type": "ready", "script": "youtube", "version": String(repeating: "9", count: 33)]))
        XCTAssertNil(BridgeMessage.parse(["type": "eval", "code": "x"]))
        XCTAssertNil(BridgeMessage.parse("route"))
        XCTAssertNil(BridgeMessage.parse(["kind": "route"]))
    }

    func testNativeCallIsGuardedJSON() {
        let js = BridgeMessage.nativeCall(["type": "dmReelGranted", "id": "AbCdE12345"])
        XCTAssertEqual(js, "window.reelfree && window.reelfree.onNative({\"id\":\"AbCdE12345\",\"type\":\"dmReelGranted\"});")
        // A quote in a value stays inside the JSON string.
        let quoted = BridgeMessage.nativeCall(["type": "x\");alert(1);//"]) ?? ""
        XCTAssertTrue(quoted.contains("\\\""))
    }
}
