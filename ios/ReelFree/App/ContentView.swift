import SwiftUI

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        TabView {
            WebTabView(tab: model.instagram)
                .tabItem { Label("Instagram", systemImage: "camera") }
            WebTabView(tab: model.youtube)
                .tabItem { Label("YouTube", systemImage: "play.rectangle") }
            SettingsView(settings: model.settings)
                .tabItem { Label("Réglages", systemImage: "gearshape") }
        }
    }
}

/// A web tab with its minimal toolbar: back, home, reload.
struct WebTabView: View {
    @ObservedObject var tab: WebTab

    var body: some View {
        VStack(spacing: 0) {
            WebViewContainer(tab: tab)
            Divider()
            HStack {
                Button {
                    tab.goBack()
                } label: {
                    Image(systemName: "chevron.backward")
                        .frame(width: 44, height: 36)
                }
                .disabled(!tab.canGoBack)
                .accessibilityLabel("Retour")

                Spacer()

                Button {
                    tab.goHome()
                } label: {
                    Image(systemName: "house")
                        .frame(width: 44, height: 36)
                }
                .accessibilityLabel("Accueil \(tab.site.title)")

                Spacer()

                Button {
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
            .background(Color(uiColor: .systemBackground))
        }
    }
}
