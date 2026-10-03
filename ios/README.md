# Napkin — native iPhone app

The same Napkin page as the web version, bundled inside a native app (works offline, no Safari):
- `Napkin/NapkinApp.swift` + `Napkin/NapkinWebView.swift`: a full-screen web view that serves the repo's web files
  from the app bundle at `napkin://app/` (a build step, "Copy the web app", copies them in — `sw.js` excluded).
- Share and Copy go through the iOS share sheet / clipboard (the page posts to `window.webkit.messageHandlers.napkin`;
  the web version falls back to the Web Share API as before).
- The page's saved data (`calc.*` in localStorage) is also mirrored to `Application Support/Napkin/storage.json` and
  put back at launch if WebKit ever loses it.
- The cursor shows at launch: WebKit normally only starts editing after a tap, so `FocusWithoutTap` treats the
  page's own focus as the user's (same workaround Ionic/Cordova use).

Bundle id `com.abodh.napkin`, iCloud container `iCloud.com.abodh.napkin` (both permanent), paid developer team
RF67S757MX → signing lasts a year. (Until v25 this was "Tote", `com.abodh.tote.dev`, free 7-day signing.)

## Build and install (over Wi-Fi; phones paired once by cable, Developer Mode on)
```
xcodebuild -project ios/Napkin.xcodeproj -scheme Napkin -configuration Release \
  -destination generic/platform=iOS -derivedDataPath ios/build/device -allowProvisioningUpdates build
xcrun devicectl device install app --device <UDID> ios/build/device/Build/Products/Release-iphoneos/Napkin.app
```
Phones: Abodh's iPhone 00008130-000C358900698D3A · Amruta's iPhone 00008130-001428D41E90001C.

## Updates
`tools/install-renewer.sh` installs a LaunchAgent (com.abodh.napkin.renew) that runs `renew.py renew` every 3 hours:
it builds the last commit **pushed** to GitHub and installs it over Wi-Fi on every phone that is behind (and renews the
signing when < 3 days are left). A phone is skipped while Napkin is open on it and the phone is unlocked (it waits for
the phone to be locked), except Abodh's (`--push-updates`).
`renew.py status` · `renew.py renew --now` · `renew.py add <UDID> [name] [--push-updates]`.
Always `git push` after committing. Log: `~/Library/Logs/Napkin/renew.log`.

## History (iPhone app only)
Clear/New puts the page away and starts a fresh one; ‹ › in the top bar step through put-away pages (newest first),
like Antinote. Old pages can be edited (they move up at the next Clear/New) or deleted (Delete in the bar, with Undo);
a page goes a year after its last edit. Stored by `Napkin/History.swift`:
- the app's own copy, `Application Support/Napkin/History/<id>.json` (what ‹ › show; works offline);
- `<id>.txt` (the page with answers) in the app's iCloud folder — iCloud Drive › Napkin in Files, on the Mac
  `~/Library/Mobile Documents/iCloud~com~abodh~napkin/Documents`. No setup; each person's pages go to their own iCloud.

The folder is watched (NSMetadataQuery): text files there that the app doesn't have come into history (a reinstall,
a new phone), and one edited elsewhere replaces the app's copy. A page the app has but iCloud doesn't is written out
again, so **a page is only ever deleted from inside the app** (deleting the file in Files/Finder brings it back).
If a second device ever shares the folder, deletes will need to travel too (a "deleted" list in the folder).
With iCloud off, history stays on the phone and the history bar says "Not in iCloud".
`Application Support/Napkin/icloud.txt` logs what the app last did with iCloud; read it from the Mac with
`xcrun devicectl device copy from --device <UDID> --domain-type appDataContainer --domain-identifier com.abodh.napkin
--source "Library/Application Support/Napkin/icloud.txt" --destination /tmp/icloud.txt`.
The web version has the same history, kept on the phone only (`calc.pages` in localStorage).

## Moving a phone from Tote (done 2026-10-02 on both phones)
Napkin is a different app to iOS, so Tote's page and history were copied across with `devicectl device copy from`
(`com.abodh.tote.dev`, `Library/Application Support/Tote`) → `copy to` (`com.abodh.napkin`,
`Library/Application Support/Napkin`) before Napkin's first launch; it restores them when it opens.
