import SwiftUI

struct SettingsView: View {
    @ObservedObject var settings: AppSettings

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Fil d'accueil", selection: $settings.feedMode) {
                        Text("Limité").tag("limited")
                        Text("Masqué").tag("off")
                    }
                    if settings.feedMode == "limited" {
                        Stepper(value: $settings.feedLimit, in: AppSettings.feedLimitRange) {
                            Text("Limite : \(settings.feedLimit) posts")
                        }
                    }
                    Toggle("Bloquer Explorer", isOn: $settings.blockExplore)
                } header: {
                    Text("Instagram")
                } footer: {
                    Text("Les Reels sont toujours bloqués. Un reel reçu en message reste visible.")
                }

                Section {
                    Toggle("Masquer l'accueil", isOn: $settings.ytHideHomeFeed)
                } header: {
                    Text("YouTube")
                } footer: {
                    Text("Les Shorts sont toujours bloqués. Un Short partagé s'ouvre comme une vidéo normale.")
                }

                Section {
                    Toggle("Lecture en arrière-plan", isOn: $settings.backgroundPlayback)
                    Toggle("Picture in Picture auto", isOn: $settings.autoPictureInPicture)
                } header: {
                    Text("Vidéo")
                } footer: {
                    Text("En quittant l'app, une vidéo en cours passe en Picture in Picture (ou continue en son seul si le PiP auto est coupé). Le bouton PiP de la barre fonctionne aussi à tout moment.")
                }

                Section {
                    Toggle("Barres toujours visibles", isOn: $settings.barsAlwaysVisible)
                } header: {
                    Text("Affichage")
                } footer: {
                    Text("Sinon, les barres sont masquées : touche la pastille en bas à droite pour les afficher. Glisse depuis le bord gauche pour revenir en arrière.")
                }

                Section {
                    Text("ReelFree ne contacte aucun serveur. Ta session reste sur cet iPhone, dans l'app.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Réglages")
        }
    }
}
