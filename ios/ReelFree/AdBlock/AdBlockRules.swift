import Foundation

/// D04: embedded content-blocker rules (Resources/adblock-rules.json). Nothing is downloaded at run time.
/// Foundation only, so the checks below also run outside WebKit (unit tests).
enum AdBlockRules {
    static let resourceName = "adblock-rules"

    /// The bundled rule list, as the JSON string WKContentRuleListStore expects.
    static func bundledJSON(in bundle: Bundle = .main) -> String? {
        guard let url = bundle.url(forResource: resourceName, withExtension: "json"),
              let json = try? String(contentsOf: url, encoding: .utf8),
              !json.isEmpty else { return nil }
        return json
    }

    /// Stable 64-bit FNV-1a of the rules, so an app update with new rules gets a new store identifier.
    static func fingerprint(_ json: String) -> String {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in json.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100000001b3
        }
        return String(hash, radix: 16)
    }

    /// `url-filter` of every rule, or nil if the file is not the expected shape
    /// (array of {trigger: {url-filter}, action: {type: "block"}}).
    static func blockFilters(_ json: String) -> [String]? {
        guard let data = json.data(using: .utf8),
              let rules = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              !rules.isEmpty else { return nil }
        var filters: [String] = []
        for rule in rules {
            guard let trigger = rule["trigger"] as? [String: Any],
                  let filter = trigger["url-filter"] as? String, !filter.isEmpty,
                  let action = rule["action"] as? [String: Any],
                  action["type"] as? String == "block" else { return nil }
            filters.append(filter)
        }
        return filters
    }

    /// Approximation of WebKit's matching (case-insensitive regex search on the full URL).
    static func isBlocked(_ url: String, filters: [String]) -> Bool {
        let range = NSRange(url.startIndex..., in: url)
        for filter in filters {
            guard let re = try? NSRegularExpression(pattern: filter, options: [.caseInsensitive]) else { continue }
            if re.firstMatch(in: url, options: [], range: range) != nil { return true }
        }
        return false
    }
}
