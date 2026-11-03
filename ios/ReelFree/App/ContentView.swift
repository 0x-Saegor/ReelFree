import SwiftUI

/// D07: visibility of the native bars (toolbar + tab bar) on the web tabs.
/// Shown from the floating handle, hidden again after 5 s without interaction or on a tap in the page.
/// One-shot task only: nothing runs per frame.
@MainActor
final class ChromeState: ObservableObject {
    static let autoHideNanoseconds: UInt64 = 5_000_000_000

    @Published private(set) var barsShown = false
    private var hideTask: Task<Void, Never>?

    func show() {
        set(true)
        scheduleHide()
    }

    func hide() {
        hideTask?.cancel()
        hideTask = nil
        set(false)
    }

    /// Any interaction with the bars restarts the 5 s delay.
    func poke() {
        if barsShown { scheduleHide() }
    }

    private func scheduleHide() {
        hideTask?.cancel()
        hideTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: Self.autoHideNanoseconds)
            guard !Task.isCancelled else { return }
            self?.hide()
        }
    }

    private func set(_ shown: Bool) {
        guard shown != barsShown else { return }
        withAnimation(.easeInOut(duration: 0.22)) { barsShown = shown }
    }
}

struct ContentView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var settings: AppSettings
    @ObservedObject var chrome: ChromeState
    @State private var selection: AppTab = .instagram

    var body: some View {
        TabView(selection: $selection) {
            webTab(model.instagram)
                .tabItem { Label("Instagram", systemImage: "camera") }
                .tag(AppTab.instagram)
            Group {
                if let youtube = model.youtube {
                    webTab(youtube)
                } else {
                    Color(uiColor: .systemBackground)   // D02: created on first selection
                }
            }
            .tabItem { Label("YouTube", systemImage: "play.rectangle") }
            .tag(AppTab.youtube)
            SettingsView(settings: settings)
                .tabItem { Label("Réglages", systemImage: "gearshape") }
                .tag(AppTab.settings)
        }
        .onChange(of: selection) { _, newValue in
            model.select(newValue)
            // Reached through the tab bar: keep it on screen for a moment, then auto-hide.
            if newValue != .settings { chrome.show() }
        }
    }

    private func webTab(_ tab: WebTab) -> some View {
        let barsVisible = settings.barsAlwaysVisible || chrome.barsShown
        // NavigationStack: the reliable host for `.toolbar(_:for: .tabBar)`.
        return NavigationStack {
            WebTabView(tab: tab, chrome: chrome, alwaysVisible: settings.barsAlwaysVisible)
                .toolbar(.hidden, for: .navigationBar)
                .toolbar(barsVisible ? .visible : .hidden, for: .tabBar)
        }
    }
}

/// A web tab. Immersive (default): the web view fills the screen inside the window safe area and the
/// bars float over it, so showing them never resizes the page. Always-visible: classic stacked layout.
struct WebTabView: View {
    @ObservedObject var tab: WebTab
    @ObservedObject var chrome: ChromeState
    let alwaysVisible: Bool

    var body: some View {
        if alwaysVisible {
            VStack(spacing: 0) {
                WebViewContainer(tab: tab)
                Divider()
                toolbar
            }
        } else {
            ZStack(alignment: .bottomTrailing) {
                // The host view insets the web view to the window safe area itself (WebHostView).
                WebViewContainer(tab: tab)
                    .ignoresSafeArea()
                if chrome.barsShown {
                    VStack(spacing: 0) {
                        Divider()
                        toolbar
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                } else {
                    ChromeHandle { chrome.show() }
                        .transition(.opacity)
                }
            }
        }
    }

    private var toolbar: some View {
        HStack {
            Button {
                chrome.poke()
                tab.goBack()
            } label: {
                Image(systemName: "chevron.backward")
                    .frame(width: 44, height: 36)
            }
            .disabled(!tab.canGoBack)
            .accessibilityLabel("Retour")

            Spacer()

            Button {
                chrome.poke()
                tab.goHome()
            } label: {
                Image(systemName: "house")
                    .frame(width: 44, height: 36)
            }
            .accessibilityLabel("Accueil \(tab.site.title)")

            Spacer()

            Button {
                chrome.poke()
                tab.togglePictureInPicture()
            } label: {
                Image(systemName: "pip.enter")
                    .frame(width: 44, height: 36)
            }
            .accessibilityLabel("Picture in Picture")

            Spacer()

            Button {
                chrome.poke()
                tab.reload()
            } label: {
                Image(systemName: "arrow.clockwise")
                    .frame(width: 44, height: 36)
            }
            .accessibilityLabel("Recharger")
        }
        .font(.system(size: 18, weight: .medium))
        .padding(.horizontal, 28)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity)
        .background(Color(uiColor: .systemBackground))
    }
}

/// D07: small translucent pill in the bottom-right corner, above the site's own bottom bar.
/// Tap: show the bars. Vertical drag: move it (position kept in UserDefaults, local to the app).
struct ChromeHandle: View {
    static let size: CGFloat = 36
    static let range: ClosedRange<Double> = 8...480

    @AppStorage("chromeHandleBottom") private var bottom: Double = 64
    @GestureState private var dragY: CGFloat = 0
    let onTap: () -> Void

    var body: some View {
        Circle()
            .fill(Color.black.opacity(0.32))
            .overlay(Circle().strokeBorder(Color.white.opacity(0.35), lineWidth: 0.5))
            .overlay(
                Image(systemName: "chevron.up")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.9))
            )
            .frame(width: Self.size, height: Self.size)
            .contentShape(Circle())
            .offset(y: clampedOffset(dragY))
            .padding(.trailing, 12)
            .padding(.bottom, CGFloat(bottom))
            .onTapGesture(perform: onTap)
            .gesture(
                DragGesture(minimumDistance: 4)
                    .updating($dragY) { value, state, _ in state = value.translation.height }
                    .onEnded { value in
                        bottom = Self.clamp(bottom - Double(value.translation.height))
                    }
            )
            .accessibilityLabel("Afficher les barres")
            .accessibilityAddTraits(.isButton)
    }

    /// Drag offset limited so the pill never leaves the allowed band.
    private func clampedOffset(_ dy: CGFloat) -> CGFloat {
        CGFloat(bottom - Self.clamp(bottom - Double(dy)))
    }

    private static func clamp(_ v: Double) -> Double {
        min(max(v, range.lowerBound), range.upperBound)
    }
}
