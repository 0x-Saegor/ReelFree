import AVFoundation
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
    private var selection: AppTab = .instagram
    private var lastPhase: ScenePhase = .active

    init() {
        let settings = AppSettings()
        self.settings = settings
        // D08: playback category so video sound keeps going in the background / in PiP
        // (with UIBackgroundModes = audio in Info.plist) and ignores the silent switch.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        instagram = WebTab(site: .instagram, settings: settings)
        wire(instagram)
        settings.onChange = { [weak self] in
            self?.instagram.settingsDidChange()
            self?.youtube?.settingsDidChange()
        }
        // D08: locking the screen while in background makes WebKit pause the video again.
        NotificationCenter.default.addObserver(forName: UIApplication.protectedDataWillBecomeUnavailableNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.screenWillLock() }
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
        self.selection = selection
        if selection == .youtube && youtube == nil {
            let tab = WebTab(site: .youtube, settings: settings, ruleList: adBlocker.ruleList)
            wire(tab)
            youtube = tab
        }
        instagram.setVisible(selection == .instagram)
        youtube?.setVisible(selection == .youtube)
    }

    private var currentTab: WebTab? {
        switch selection {
        case .instagram: return instagram
        case .youtube: return youtube
        case .settings: return nil
        }
    }

    private func screenWillLock() {
        guard lastPhase == .background else { return }   // foreground lock: handled by the phase change
        currentTab?.appDidEnterBackground(keepPlaying: settings.backgroundPlayback)
    }

    /// D08: background playback and automatic Picture in Picture for the visible web tab.
    func scenePhaseChanged(_ phase: ScenePhase) {
        defer { lastPhase = phase }
        switch phase {
        case .inactive where lastPhase == .active:
            currentTab?.appWillResignActive(autoPictureInPicture: settings.autoPictureInPicture)
        case .background:
            currentTab?.appDidEnterBackground(keepPlaying: settings.backgroundPlayback)
        case .active:
            currentTab?.appDidBecomeActive()
        default:
            break
        }
    }
}

@main
struct ReelFreeApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView(model: model, settings: model.settings, chrome: model.chrome)
        }
        .onChange(of: scenePhase) { _, phase in model.scenePhaseChanged(phase) }
    }
}
