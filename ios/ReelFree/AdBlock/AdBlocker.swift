import Foundation
import WebKit

/// D04: compiles the embedded rules into a WKContentRuleList once per launch, off the main thread
/// (WebKit compiles in the background). Ad blocking is best effort: if compilation fails, the tabs
/// simply run without it; the route guard and the injected scripts are unaffected.
@MainActor
final class AdBlocker {
    static let identifierPrefix = "reelfree-adblock-"

    private(set) var ruleList: WKContentRuleList?

    func compile(_ completion: @escaping (WKContentRuleList) -> Void) {
        guard let json = AdBlockRules.bundledJSON() else { return }
        let identifier = Self.identifierPrefix + AdBlockRules.fingerprint(json)
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: identifier,
                                                                encodedContentRuleList: json) { list, _ in
            guard let list = list else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.ruleList = list
                completion(list)
            }
        }
    }
}
