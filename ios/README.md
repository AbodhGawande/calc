# Tote — native iPhone app

The same Tote page as the web version, bundled inside a native app (works offline, no Safari):
- `Tote/ToteApp.swift` + `Tote/ToteWebView.swift`: a full-screen web view that serves the repo's web files
  from the app bundle at `tote://app/` (a build step, "Copy the web app", copies them in — `sw.js` excluded).
- Share and Copy go through the iOS share sheet / clipboard (the page posts to `window.webkit.messageHandlers.tote`;
  the web version falls back to the Web Share API as before).
- The page's saved data (`calc.*` in localStorage) is also mirrored to `Application Support/Tote/storage.json` and put
  back at launch if WebKit ever loses it.
- The cursor shows at launch: WebKit normally only starts editing after a tap, so `FocusWithoutTap` treats the
  page's own focus as the user's (same workaround Ionic/Cordova use).

Bundle id `com.abodh.tote.dev`, free team RF67S757MX → signing lasts 7 days.

## Build and install (over Wi-Fi; phones paired once by cable, Developer Mode on)
```
xcodebuild -project ios/Tote.xcodeproj -scheme Tote -configuration Release \
  -destination id=<UDID> -derivedDataPath ios/build/device -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
xcrun devicectl device install app --device <UDID> ios/build/device/Build/Products/Release-iphoneos/Tote.app
```
Phones: Abodh's iPhone 00008130-000C358900698D3A · Amruta's iPhone 00008130-001428D41E90001C.

## Auto-renew
`tools/install-renewer.sh` installs a LaunchAgent (com.abodh.tote.renew) that runs `renew.py renew` every 3 hours:
it builds the last commit **pushed** to GitHub and reinstalls over Wi-Fi when signing has < 3 days left (overnight
unless < 1 day). `renew.py status` · `renew.py renew --now` · `renew.py add <UDID> [name] [--push-updates]`.
Abodh's phone has `--push-updates` (gets every pushed version). Always `git push` after committing.
Log: `~/Library/Logs/Tote/renew.log`.
