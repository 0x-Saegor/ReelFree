import SwiftUI
import WebKit

enum AppTab: Hashable {
    case instagram, youtube, settings
}

/// Owns the settings and the web tabs for the lifetime of the app.
/// D02: the YouTube tab (a whole web content process) is only created on its first selection.
@MainActor
final class AppModel: ObservableObject {
    let settings: AppSettings
    let chrome = ChromeState()
    let instagram: WebTab
    @Published private(set) var youtube: WebTab?
    private let adBlocker = AdBlocker()

    init() {
        let settings = AppSettings()
        self.settings = settings
        instagram = WebTab(site: .instagram, settings: settings)
        wire(instagram)
        settings.onChange = { [weak self] in
            self?.instagram.settingsDidChange()
            self?.youtube?.settingsDidChange()
        }
        // D04: compiled once off the launch path; tabs created later get it at init.
        adBlocker.compile { [weak self] ruleList in
            guard let self = self else { return }
            self.instagram.apply(ruleList: ruleList)
            self.youtube?.apply(ruleList: ruleList)
        }
    }

    private func wire(_ tab: WebTab) {
        tab.onPageTap = { [weak self] in self?.chrome.hide() }
    }

    /// Visible tab only plays media; the others are paused and suspended.
    func select(_ selection: AppTab) {
        if selection == .youtube && youtube == nil {
            let tab = WebTab(site: .youtube, settings: settings, ruleList: adBlocker.ruleList)
            wire(tab)
            youtube = tab
        }
        instagram.setVisible(selection == .instagram)
        youtube?.setVisible(selection == .youtube)
    }
}

@main
struct ReelFreeApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model, settings: model.settings, chrome: model.chrome)
        }
    }
}
