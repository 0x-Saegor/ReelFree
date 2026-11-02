import SwiftUI

/// Owns the settings and both web tabs for the lifetime of the app.
@MainActor
final class AppModel: ObservableObject {
    let settings: AppSettings
    let instagram: WebTab
    let youtube: WebTab

    init() {
        let settings = AppSettings()
        self.settings = settings
        instagram = WebTab(site: .instagram, settings: settings)
        youtube = WebTab(site: .youtube, settings: settings)
        settings.onChange = { [weak self] in
            self?.instagram.settingsDidChange()
            self?.youtube.settingsDidChange()
        }
    }
}

@main
struct ReelFreeApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
        }
    }
}
