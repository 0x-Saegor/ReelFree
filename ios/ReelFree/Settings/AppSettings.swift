import Foundation

/// User settings, persisted in UserDefaults (local to the app). Every change calls `onChange`,
/// which pushes the new config to the injected scripts.
@MainActor
final class AppSettings: ObservableObject {

    private enum Key {
        static let feedMode = "feedMode"
        static let feedLimit = "feedLimit"
        static let blockExplore = "blockExplore"
        static let ytHideHomeFeed = "ytHideHomeFeed"
        static let barsAlwaysVisible = "barsAlwaysVisible"
        static let backgroundPlayback = "backgroundPlayback"
        static let autoPictureInPicture = "autoPictureInPicture"
    }

    static let feedLimitRange = 3...50
    static let dmReelTtlMs = 10_000

    private let defaults: UserDefaults
    var onChange: (() -> Void)?

    @Published var feedMode: String {
        didSet {
            defaults.set(feedMode, forKey: Key.feedMode)
            onChange?()
        }
    }

    @Published var feedLimit: Int {
        didSet {
            defaults.set(feedLimit, forKey: Key.feedLimit)
            onChange?()
        }
    }

    @Published var blockExplore: Bool {
        didSet {
            defaults.set(blockExplore, forKey: Key.blockExplore)
            onChange?()
        }
    }

    @Published var ytHideHomeFeed: Bool {
        didSet {
            defaults.set(ytHideHomeFeed, forKey: Key.ytHideHomeFeed)
            onChange?()
        }
    }

    /// D07: native UI only (not sent to the scripts), so it does not call `onChange`.
    @Published var barsAlwaysVisible: Bool {
        didSet { defaults.set(barsAlwaysVisible, forKey: Key.barsAlwaysVisible) }
    }

    /// D08: keep a playing video's sound going when the app leaves the screen.
    @Published var backgroundPlayback: Bool {
        didSet {
            defaults.set(backgroundPlayback, forKey: Key.backgroundPlayback)
            onChange?()   // reinstalls the YouTube page-world script (next page load)
        }
    }

    /// D08: native only. Move a playing video to Picture in Picture when the app leaves the screen.
    @Published var autoPictureInPicture: Bool {
        didSet { defaults.set(autoPictureInPicture, forKey: Key.autoPictureInPicture) }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let mode = defaults.string(forKey: Key.feedMode)
        feedMode = (mode == "off") ? "off" : "limited"
        let limit = (defaults.object(forKey: Key.feedLimit) as? Int) ?? 15
        feedLimit = min(max(limit, Self.feedLimitRange.lowerBound), Self.feedLimitRange.upperBound)
        blockExplore = (defaults.object(forKey: Key.blockExplore) as? Bool) ?? true
        ytHideHomeFeed = (defaults.object(forKey: Key.ytHideHomeFeed) as? Bool) ?? false
        barsAlwaysVisible = (defaults.object(forKey: Key.barsAlwaysVisible) as? Bool) ?? false
        backgroundPlayback = (defaults.object(forKey: Key.backgroundPlayback) as? Bool) ?? true
        autoPictureInPicture = (defaults.object(forKey: Key.autoPictureInPicture) as? Bool) ?? false
    }

    /// `window.RF_CONFIG` / `{type: "config"}` payload.
    var jsConfig: [String: Any] {
        [
            "feedMode": feedMode == "off" ? "off" : "limited",
            "feedLimit": min(max(feedLimit, Self.feedLimitRange.lowerBound), Self.feedLimitRange.upperBound),
            "blockExplore": blockExplore,
            "ytHideHomeFeed": ytHideHomeFeed,
            "dmReelTtlMs": Self.dmReelTtlMs,
            "platform": "ios-app"
        ]
    }

    var policyConfig: PolicyConfig {
        PolicyConfig(blockExplore: blockExplore, dmReelTtlMs: Double(Self.dmReelTtlMs),
                     feedMode: feedMode == "off" ? "off" : "limited")
    }
}
