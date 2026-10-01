import SwiftUI
import UIKit
import WebKit
import ObjectiveC

/// The page, served from the app bundle (Web/, copied in at build time from the repo's web files) at tote://app/.
struct ToteWebView: UIViewRepresentable {
    func makeCoordinator() -> Bridge { Bridge() }

    func makeUIView(context: Context) -> WKWebView {
        FocusWithoutTap.enable()
        let bridge = context.coordinator
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleFiles(), forURLScheme: "tote")
        config.websiteDataStore = .default()
        config.userContentController.add(bridge, name: "tote")
        config.userContentController.addUserScript(WKUserScript(source: bridge.restoreScript(),
                                                                injectionTime: .atDocumentStart,
                                                                forMainFrameOnly: true))
        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.contentInsetAdjustmentBehavior = .never // the page uses env(safe-area-inset-*) itself
        web.scrollView.isScrollEnabled = false                 // the page scrolls inside itself; the frame never moves
        web.scrollView.bounces = false
        web.navigationDelegate = bridge
        web.uiDelegate = bridge
        if #available(iOS 16.4, *) { web.isInspectable = true } // Safari ▸ Develop on the Mac, for debugging
        bridge.webView = web
        web.load(URLRequest(url: URL(string: "tote://app/index.html")!))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Serves the bundled web files. A custom scheme gives the page a stable origin, so its saved data (localStorage)
/// stays put between launches and updates.
final class BundleFiles: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.resourceURL!.appendingPathComponent("Web", isDirectory: true).standardizedFileURL
    private static let types = [
        "html": "text/html; charset=utf-8", "css": "text/css; charset=utf-8", "js": "text/javascript; charset=utf-8",
        "png": "image/png", "json": "application/json", "webmanifest": "application/manifest+json",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!)
            task.didFinish()
            return
        }
        let type = Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                        headerFields: ["Content-Type": type, "Cache-Control": "no-store"])!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// Messages from the page (share, copy, saved data) and the web view's delegates.
final class Bridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    weak var webView: WKWebView?
    private let backup = Backup()
    private let history = History()

    override init() {
        super.init()
        for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification] {
            NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.backup.flush()
            }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil,
                                               queue: .main) { [weak self] _ in self?.refocus() }
        // A folder was just chosen: tell the page, with any pages that were only in that folder.
        history.onChosen = { [weak self] pages in
            let json = (try? String(data: JSONEncoder().encode(pages), encoding: .utf8)) ?? "[]"
            self?.webView?.evaluateJavaScript("window.__toteHistoryFolder && window.__toteHistoryFolder(\(json))")
        }
    }

    /// Runs before the page's own scripts: puts back any saved key WebKit has lost, then mirrors every
    /// "calc.*" write to the app, which keeps its own copy in Application Support (see Backup).
    func restoreScript() -> String {
        let saved = (try? String(data: JSONEncoder().encode(backup.values), encoding: .utf8)) ?? "{}"
        let pages = (try? String(data: JSONEncoder().encode(history.load()), encoding: .utf8)) ?? "[]"
        return """
        window.__toteNative = { history: \(pages), folder: \(history.hasFolder) };
        (function () {
          var saved = \(saved);
          try { for (var k in saved) if (localStorage.getItem(k) === null) localStorage.setItem(k, saved[k]); } catch (e) {}
          var set = Storage.prototype.setItem, app = window.webkit.messageHandlers.tote;
          Storage.prototype.setItem = function (k, v) {
            set.call(this, k, v);
            if (this === window.localStorage && String(k).indexOf('calc.') === 0)
              app.postMessage({ type: 'store', key: String(k), value: String(v) });
          };
        })();
        """
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let msg = message.body as? [String: Any], let type = msg["type"] as? String else { return }
        switch type {
        case "store":
            if let key = msg["key"] as? String, let value = msg["value"] as? String { backup.set(key, value) }
        case "copy":
            UIPasteboard.general.string = msg["text"] as? String
        case "histSave":
            if let page = msg["page"] as? [String: Any], let data = try? JSONSerialization.data(withJSONObject: page),
               let p = try? JSONDecoder().decode(History.Page.self, from: data) { history.save(p) }
        case "histDelete":
            if let id = msg["id"] as? String { history.delete(id) }
        case "histAskFolder":
            if let top = topController() { history.askForFolder(from: top) }
        case "histChooseFolder":
            if let top = topController() { history.chooseFolder(from: top) }
        case "shareText":
            if let text = msg["text"] as? String { share([text]) }
        case "shareImage":
            if let b64 = msg["png"] as? String, let data = Data(base64Encoded: b64), let image = UIImage(data: data) {
                share([image])
            }
        default:
            break
        }
    }

    private func topController() -> UIViewController? {
        guard var top = webView?.window?.rootViewController else { return nil }
        while let next = top.presentedViewController { top = next }
        return top
    }

    private func share(_ items: [Any]) {
        guard let web = webView, let top = topController() else { return }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = web
        top.present(sheet, animated: true)
    }

    // If iOS ever stops the page's process to free memory, bring the page back (its data is saved).
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // Show the cursor at launch: the page focused itself before the view could take focus, so focus it again.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { refocus() }

    func refocus() {
        guard let web = webView else { return }
        web.becomeFirstResponder()
        web.evaluateJavaScript("window.__calc && window.__calc.refocus && window.__calc.refocus()")
    }

    // The page has no links of its own; anything else opens in Safari.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.scheme == "tote" || url.scheme == "about" {
            decisionHandler(.allow)
        } else {
            if let url = action.request.url { UIApplication.shared.open(url) }
            decisionHandler(.cancel)
        }
    }

    // alert() / confirm() from the page, as native dialogs.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        present(message, cancel: false) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        present(message, cancel: true, done: completionHandler)
    }

    private func present(_ message: String, cancel: Bool, done: @escaping (Bool) -> Void) {
        guard var top = webView?.window?.rootViewController else { done(false); return }
        while let next = top.presentedViewController { top = next }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        if cancel { alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in done(false) }) }
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in done(true) })
        top.present(alert, animated: true)
    }
}

/// The app's own copy of the page's saved data, in Application Support/Tote/storage.json — written half a second
/// after the last change and whenever the app goes to the background.
final class Backup {
    private static let url: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Tote", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("storage.json")
    }()

    private(set) var values: [String: String]
    private var pending: DispatchWorkItem?

    init() {
        values = (try? JSONDecoder().decode([String: String].self, from: Data(contentsOf: Self.url))) ?? [:]
    }

    func set(_ key: String, _ value: String) {
        values[key] = value
        pending?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.flush() }
        pending = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
    }

    func flush() {
        pending?.cancel()
        pending = nil
        if let data = try? JSONEncoder().encode(values) { try? data.write(to: Self.url, options: .atomic) }
    }
}

/// In an app, iOS only starts editing (shows the cursor) when the page focuses a field during a tap. Tote focuses
/// its page at launch so the cursor shows before the first key, so this tells WebKit every focus is "the user's".
/// The keypad page has no keyboard (inputmode none), so nothing pops up. Same workaround Ionic/Cordova apps use;
/// if a future iOS renames the method, it simply does nothing.
enum FocusWithoutTap {
    private static var done = false

    static func enable() {
        guard !done, let cls = NSClassFromString("WKContentView") else { return }
        done = true
        let sel = sel_getUid("_elementDidFocus:userIsInteracting:blurPreviousNode:activityStateChanges:userObject:")
        guard let method = class_getInstanceMethod(cls, sel) else {
            var count: UInt32 = 0
            let names = (class_copyMethodList(cls, &count).map { list in (0..<Int(count)).map { NSStringFromSelector(method_getName(list[$0])) } } ?? [])
            NSLog("Tote: focus method not found; candidates: %@", names.filter { $0.contains("ocus") }.joined(separator: " | "))
            return
        }
        typealias Original = @convention(c) (AnyObject, Selector, UnsafeRawPointer, Bool, Bool, UInt64, AnyObject?) -> Void
        let original = unsafeBitCast(method_getImplementation(method), to: Original.self)
        let replacement: @convention(block) (AnyObject, UnsafeRawPointer, Bool, Bool, UInt64, AnyObject?) -> Void = {
            view, info, _, blur, changes, object in original(view, sel, info, true, blur, changes, object)
        }
        method_setImplementation(method, imp_implementationWithBlock(replacement))
    }
}
