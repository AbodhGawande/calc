import SwiftUI

/// Tote as a native iPhone app: the same page as the web version (bundled inside the app, works offline),
/// shown full screen in a web view. See ToteWebView.swift.
@main
struct ToteApp: App {
    var body: some Scene {
        WindowGroup {
            ToteWebView()
                .ignoresSafeArea()           // the page handles the notch and home bar itself, and the keyboard
                .background(Color.black)
                .preferredColorScheme(.dark) // white status bar text
        }
    }
}
