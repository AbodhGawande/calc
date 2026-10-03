import UIKit

/// Pages put away by Clear (iPhone app only). Each page is kept twice:
/// - the app's own copy, Application Support/Napkin/History/<id>.json — what ‹ › show, works offline;
/// - a readable text file in the app's own iCloud folder, iCloud Drive › Napkin/<id>.txt (the page as shared text,
///   answers included). Nothing to set up: it's there whenever the phone is signed in to iCloud with iCloud Drive on.
/// Text files in that folder that the app doesn't have (after a reinstall, on a new phone) come into history, and one
/// changed somewhere else replaces the app's copy. A page the app has but iCloud doesn't is written out again — so a
/// page is only ever deleted from inside the app.
/// The page decides what to keep and when (year limit, order); this only stores what it's told.
final class History: NSObject {
    struct Page: Codable {
        var id: String
        var created: Double   // ms since 1970, like JavaScript's Date.now()
        var edited: Double
        var text: String
        var shared: String?
        var imported: Bool?   // came from a text file: the page strips the answers off
    }

    static let container = "iCloud.com.abodh.napkin"
    private static let deletedKey = "historyDeleted"

    private let localDir: URL
    private let statusFile: URL
    private let io = DispatchQueue(label: "com.abodh.napkin.history")   // iCloud files are only touched here, in order
    private var folder: URL?                // the iCloud folder, once iCloud has answered (io queue only)
    private var query: NSMetadataQuery?     // watches the folder (main queue only)
    private let lock = NSLock()
    private var deleted: Set<String>        // deleted here; never taken back from iCloud, even if the file lingers there

    /// Pages that are in iCloud but not in the app, or newer there. Called on the main queue.
    var onPages: (([Page]) -> Void)?
    /// iCloud came on or went off. Called on the main queue.
    var onICloud: ((Bool) -> Void)?

    override init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Napkin", isDirectory: true)
        localDir = support.appendingPathComponent("History", isDirectory: true)
        statusFile = support.appendingPathComponent("icloud.txt")
        try? FileManager.default.createDirectory(at: localDir, withIntermediateDirectories: true)
        deleted = Set(UserDefaults.standard.stringArray(forKey: Self.deletedKey) ?? [])
        super.init()
        NotificationCenter.default.addObserver(forName: .NSUbiquityIdentityDidChange, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.connect()
            self.onICloud?(self.iCloudOn)
        }
        connect()
    }

    /// Signed in to iCloud, with iCloud Drive on for this app.
    var iCloudOn: Bool { FileManager.default.ubiquityIdentityToken != nil }

    /// The app's own pages. (Pages only iCloud has arrive a moment later, through onPages.)
    func load() -> [Page] { localPages() }

    func save(_ page: Page) {
        var p = page
        p.imported = nil
        setDeleted(p.id, false)
        if let data = try? JSONEncoder().encode(p) {
            try? data.write(to: localDir.appendingPathComponent(p.id + ".json"), options: .atomic)
        }
        io.async { self.writeText(p) }
    }

    func delete(_ id: String) {
        setDeleted(id, true)
        try? FileManager.default.removeItem(at: localDir.appendingPathComponent(id + ".json"))
        io.async {
            guard let folder = self.folder else { return }   // iCloud is away: merge removes the file when it's back
            self.remove(folder.appendingPathComponent(id + ".txt"))
        }
    }

    /// Look at the iCloud folder again now (the app came to the front, or the page has just loaded).
    func refresh() {
        guard let query else { connect(); return }
        if !query.isGathering { listingChanged() }
    }

    // MARK: - the iCloud folder

    private func connect() {
        // The first call sets the folder up and can take a moment, so it never runs on the main queue.
        DispatchQueue.global(qos: .utility).async {
            let docs = FileManager.default.url(forUbiquityContainerIdentifier: Self.container)?
                .appendingPathComponent("Documents", isDirectory: true)
            if let docs { try? FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true) }
            self.io.async {
                self.folder = docs
                self.note(docs == nil ? "iCloud is off (signed out, or iCloud Drive is off for Napkin)" : "iCloud folder ready")
            }
            DispatchQueue.main.async { docs == nil ? self.stopWatching() : self.watch() }
        }
    }

    private func watch() {
        guard query == nil else { refresh(); return }
        let q = NSMetadataQuery()
        q.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
        q.predicate = NSPredicate(format: "%K LIKE '*.txt'", NSMetadataItemFSNameKey)
        for name in [Notification.Name.NSMetadataQueryDidFinishGathering, .NSMetadataQueryDidUpdate] {
            NotificationCenter.default.addObserver(self, selector: #selector(listingChanged), name: name, object: q)
        }
        query = q
        q.start()
    }

    private func stopWatching() {
        guard let q = query else { return }
        q.stop()
        NotificationCenter.default.removeObserver(self, name: nil, object: q)
        query = nil
    }

    private struct Item {
        let url: URL
        let current: Bool      // downloaded and up to date on this phone
        let modified: Double   // ms since 1970
    }

    /// What iCloud lists right now (only asked once the first full listing is in, so nothing is judged "missing" early).
    @objc private func listingChanged() {
        guard let query else { return }
        query.disableUpdates()
        let items: [Item] = query.results.compactMap { result in
            guard let item = result as? NSMetadataItem,
                  let url = item.value(forAttribute: NSMetadataItemURLKey) as? URL,
                  url.deletingLastPathComponent().lastPathComponent == "Documents" else { return nil }
            let status = item.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String
            let date = item.value(forAttribute: NSMetadataItemFSContentChangeDateKey) as? Date ?? Date()
            return Item(url: url, current: status == NSMetadataUbiquitousItemDownloadingStatusCurrent,
                        modified: date.timeIntervalSince1970 * 1000)
        }
        query.enableUpdates()
        io.async { self.merge(items) }
    }

    /// Bring the app's pages and the iCloud folder in line (io queue).
    private func merge(_ items: [Item]) {
        guard folder != nil else { return }
        let local = Dictionary(localPages().map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var listed = Set<String>()
        var fresh: [Page] = []
        var waiting = 0
        for item in items {
            let id = item.url.deletingPathExtension().lastPathComponent
            listed.insert(id)
            if isDeleted(id) { remove(item.url); continue }       // deleted here while iCloud was away
            guard item.current else {                              // not on this phone yet: fetch it, it's listed again when in
                try? FileManager.default.startDownloadingUbiquitousItem(at: item.url)
                waiting += 1
                continue
            }
            let mine = local[id]
            if let mine, item.modified <= mine.edited + 2000 { continue }   // the app's copy is as new
            guard let text = read(item.url) else { continue }
            if let mine, text == mine.shared { continue }
            fresh.append(Page(id: id, created: mine?.created ?? item.modified, edited: item.modified,
                              text: text, shared: text, imported: true))
        }
        // Pages iCloud doesn't have: put away while it was off, or from before the app had iCloud.
        let missing = local.values.filter { !listed.contains($0.id) && !isDeleted($0.id) }
        missing.forEach(writeText)
        note("iCloud lists \(items.count) pages · \(local.count) on this phone · \(fresh.count) taken in · "
             + "\(missing.count) sent up · \(waiting) still downloading")
        if !fresh.isEmpty { DispatchQueue.main.async { self.onPages?(fresh) } }
    }

    // MARK: - files

    private func localPages() -> [Page] {
        let files = (try? FileManager.default.contentsOfDirectory(at: localDir, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "json" }.compactMap {
            try? JSONDecoder().decode(Page.self, from: Data(contentsOf: $0))
        }
    }

    private func isDeleted(_ id: String) -> Bool { lock.withLock { deleted.contains(id) } }

    private func setDeleted(_ id: String, _ on: Bool) {
        lock.withLock {
            guard deleted.contains(id) != on else { return }
            if on { deleted.insert(id) } else { deleted.remove(id) }
            UserDefaults.standard.set(Array(deleted), forKey: Self.deletedKey)
        }
    }

    private func read(_ file: URL) -> String? {
        var text: String?
        NSFileCoordinator().coordinate(readingItemAt: file, options: .withoutChanges, error: nil) { url in
            text = try? String(contentsOf: url, encoding: .utf8)
        }
        return text
    }

    /// The page as a text file in the iCloud folder, dated when the page was last edited (io queue).
    private func writeText(_ page: Page) {
        guard let folder, let shared = page.shared else { return }
        let file = folder.appendingPathComponent(page.id + ".txt")
        let data = Data(shared.utf8)
        let stamp = Date(timeIntervalSince1970: page.edited / 1000)
        NSFileCoordinator().coordinate(writingItemAt: file, options: .forReplacing, error: nil) { url in
            let fm = FileManager.default
            if fm.contents(atPath: url.path) != data { try? data.write(to: url, options: .atomic) }
            let now = (try? fm.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
            if now.map({ abs($0.timeIntervalSince(stamp)) > 1 }) ?? true {
                try? fm.setAttributes([.modificationDate: stamp], ofItemAtPath: url.path)
            }
        }
    }

    private func remove(_ file: URL) {
        NSFileCoordinator().coordinate(writingItemAt: file, options: .forDeleting, error: nil) { url in
            try? FileManager.default.removeItem(at: url)
        }
    }

    /// The last few things that happened with iCloud, in Application Support/Napkin/icloud.txt — for checking a phone
    /// from the Mac (xcrun devicectl device copy from …).
    private func note(_ what: String) {
        let stamp = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withFullDate, .withFullTime])
        var lines = ((try? String(contentsOf: statusFile, encoding: .utf8)) ?? "").split(separator: "\n").map(String.init)
        if lines.last?.hasSuffix(what) == true { lines.removeLast() }   // the same thing again: just its latest time
        lines.append("\(stamp)  \(what)")
        try? lines.suffix(40).joined(separator: "\n").write(to: statusFile, atomically: true, encoding: .utf8)
    }
}
