import UIKit
import UniformTypeIdentifiers

/// Pages put away by Clear (iPhone app only). Each page is kept twice:
/// - the app's own copy, Application Support/Tote/History/<id>.json — what ‹ › show, works offline;
/// - once a folder is chosen, a readable text file in iCloud Drive › Abodh Apps Data Sync › Tote › iPhone/<id>.txt
///   (the page as shared text, answers included). Text files found there that the app doesn't know (e.g. after a
///   reinstall) come back into history.
/// The page decides what to keep and when (year limit, order); this only stores what it's told.
final class History: NSObject, UIDocumentPickerDelegate {
    struct Page: Codable {
        var id: String
        var created: Double   // ms since 1970, like JavaScript's Date.now()
        var edited: Double
        var text: String
        var shared: String?
        var imported: Bool?   // came from a text file: the page strips the answers off
    }

    private static let bookmarkKey = "historyFolderBookmark"
    private let localDir: URL
    private var folder: URL?        // …/Tote/iPhone, while access to the chosen folder is open
    private var access: URL?        // the chosen folder itself (security-scoped)
    var onChosen: (([Page]) -> Void)?

    override init() {
        localDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Tote/History", isDirectory: true)
        try? FileManager.default.createDirectory(at: localDir, withIntermediateDirectories: true)
        super.init()
        openFolder()
    }

    var hasFolder: Bool { folder != nil }

    /// Everything to show: the app's own pages, plus text files in the iCloud folder it doesn't have yet.
    func load() -> [Page] {
        var pages = localPages()
        let known = Set(pages.map(\.id))
        pages += folderPages().filter { !known.contains($0.id) }
        return pages
    }

    func save(_ page: Page) {
        var p = page
        p.imported = nil
        if let data = try? JSONEncoder().encode(p) {
            try? data.write(to: localDir.appendingPathComponent(p.id + ".json"), options: .atomic)
        }
        writeText(p)
    }

    func delete(_ id: String) {
        try? FileManager.default.removeItem(at: localDir.appendingPathComponent(id + ".json"))
        guard let folder else { return }
        let file = folder.appendingPathComponent(id + ".txt")
        NSFileCoordinator().coordinate(writingItemAt: file, options: .forDeleting, error: nil) { url in
            try? FileManager.default.removeItem(at: url)
        }
    }

    // MARK: - the iCloud Drive folder

    func askForFolder(from host: UIViewController) {
        let alert = UIAlertController(title: "Keep history in iCloud Drive?",
            message: "Tote keeps every cleared page. Choose iCloud Drive › Abodh Apps Data Sync › Tote to also keep "
                + "them there, so they're safe and readable in Files.",
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Not Now", style: .cancel))
        alert.addAction(UIAlertAction(title: "Choose Folder", style: .default) { [weak self] _ in
            self?.chooseFolder(from: host)
        })
        host.present(alert, animated: true)
    }

    func chooseFolder(from host: UIViewController) {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
        picker.delegate = self
        picker.allowsMultipleSelection = false
        host.present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) else { return }
        UserDefaults.standard.set(data, forKey: Self.bookmarkKey)
        access?.stopAccessingSecurityScopedResource()
        access = nil
        folder = nil
        openFolder()
        // Copy what the app already has out to the folder, and bring back what's only in the folder.
        let local = localPages()
        local.forEach(writeText)
        let known = Set(local.map(\.id))
        onChosen?(folderPages().filter { !known.contains($0.id) })
    }

    private func openFolder() {
        guard folder == nil, let data = UserDefaults.standard.data(forKey: Self.bookmarkKey) else { return }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale),
              url.startAccessingSecurityScopedResource() else { return }
        if stale, let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
            UserDefaults.standard.set(fresh, forKey: Self.bookmarkKey)
        }
        access = url
        // Picked "Abodh Apps Data Sync" instead of its Tote folder? Use the Tote folder inside it.
        let tote = url.lastPathComponent == "Tote" ? url : url.appendingPathComponent("Tote", isDirectory: true)
        let device = tote.appendingPathComponent("iPhone", isDirectory: true)
        try? FileManager.default.createDirectory(at: device, withIntermediateDirectories: true)
        folder = device
    }

    // MARK: - files

    private func localPages() -> [Page] {
        let files = (try? FileManager.default.contentsOfDirectory(at: localDir, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "json" }.compactMap {
            try? JSONDecoder().decode(Page.self, from: Data(contentsOf: $0))
        }
    }

    /// Text files in the folder (only ones already on the phone; iCloud is asked to fetch the rest for next time).
    private func folderPages() -> [Page] {
        guard let folder else { return [] }
        let keys: [URLResourceKey] = [.contentModificationDateKey, .creationDateKey]
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: keys)) ?? []
        var pages: [Page] = []
        for file in files {
            let name = file.lastPathComponent
            if name.hasPrefix("."), name.hasSuffix(".txt.icloud") {      // not downloaded yet
                try? FileManager.default.startDownloadingUbiquitousItem(at: file)
                continue
            }
            guard file.pathExtension == "txt", let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            let values = try? file.resourceValues(forKeys: Set(keys))
            let edited = (values?.contentModificationDate ?? Date()).timeIntervalSince1970 * 1000
            let created = (values?.creationDate ?? values?.contentModificationDate ?? Date()).timeIntervalSince1970 * 1000
            pages.append(Page(id: file.deletingPathExtension().lastPathComponent, created: created, edited: edited,
                              text: text, shared: text, imported: true))
        }
        return pages
    }

    private func writeText(_ page: Page) {
        guard let folder, let shared = page.shared else { return }
        let file = folder.appendingPathComponent(page.id + ".txt")
        NSFileCoordinator().coordinate(writingItemAt: file, options: .forReplacing, error: nil) { url in
            try? Data(shared.utf8).write(to: url, options: .atomic)
            try? FileManager.default.setAttributes(
                [.modificationDate: Date(timeIntervalSince1970: page.edited / 1000)], ofItemAtPath: url.path)
        }
    }
}
