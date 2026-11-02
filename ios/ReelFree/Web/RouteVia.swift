import Foundation

/// How the main-frame URL changed, sent to the injected script as `onNative({type:"route", path, via})`
/// (docs/SPEC-iOS.md, amendment 4). Only `popstate` has a contract meaning: it is a history traversal,
/// and both sides drop any DM token. The other values are informative.
enum RouteVia: String {
    case push       // new history entry (pushState or link)
    case replace    // same history entry, new URL (replaceState, redirect)
    case popstate   // history traversal (back/forward, swipe, history.go)
    case load       // document load started by the app itself (home, reload, guard redirect)

    /// Back/forward list as seen at one URL change. `Item` is WKBackForwardListItem in the app
    /// (WebKit keeps one wrapper object per entry, so identity is stable); tests use any class.
    struct Snapshot<Item: AnyObject> {
        var current: Item?
        var back: [Item]
        var forward: [Item]

        init(current: Item?, back: [Item], forward: [Item]) {
            self.current = current
            self.back = back
            self.forward = forward
        }
    }

    /// Classifies a URL change.
    /// - `pendingTraversal`: the app saw a back/forward navigation start (toolbar Back, swipe,
    ///   `navigationType == .backForward`) that has not produced a URL change yet.
    /// - `pendingLoad`: the app started a document load itself.
    ///
    /// Fail-safe direction: any doubt between push and traversal resolves to `popstate` only when there
    /// is positive evidence of a traversal; a mislabelled traversal is still caught by the JS
    /// `popstate` event (amendment 2), and the native guard re-evaluates every URL anyway.
    static func classify<Item: AnyObject>(previous: Snapshot<Item>?,
                                          current: Snapshot<Item>,
                                          pendingTraversal: Bool,
                                          pendingLoad: Bool) -> RouteVia {
        if pendingTraversal { return .popstate }
        if let prev = previous, let cur = current.current {
            // The new current entry already existed in the list: we moved inside the history.
            if prev.back.contains(where: { $0 === cur }) || prev.forward.contains(where: { $0 === cur }) {
                return .popstate
            }
            if let prevCur = prev.current, prevCur === cur {
                return .replace
            }
        }
        return pendingLoad ? .load : .push
    }
}
