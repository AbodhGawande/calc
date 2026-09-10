# Calc

An iOS-style calculator with chained stages and USD ⇄ INR conversion, built as a
Home Screen web app (PWA). Plain HTML/CSS/JS, no build step, no dependencies.

## Install on iPhone
1. Open the site in **Safari**.
2. Share ▸ **Add to Home Screen**.
3. Always launch it from the Home Screen icon. It runs full screen and works offline.
   (The Home Screen app keeps its own storage, separate from Safari's.)

## How it works
- **Chaining:** `=` locks in what you have so far. Pressing an operator right after `=`
  carries on from that result, and every stage stays on the tape:
  `2 + 3 + 4 = 9`, then `× 5 = 45`, then `+ 10 = 55`. A digit after `=` starts a new calculation.
- **Reuse a number:** tap any result on the tape or in History to drop it into the current calculation.
- **Pin:** hold any number to pin it. The chip above the keypad shows its value. Tap it to use it, hold it to unpin.
- **Currency (`$₹` key):** shows a live converted line under the number.
  Tap the converted amount to make it the main number (the direction flips).
  Tap `USD → INR` to swap. Tap the rate line to refresh it.
  Rates come from the ECB via Frankfurter, with ExchangeRate-API as a fallback. The last rate is saved
  for offline use, and the line turns orange once it is more than a day old.
- **Swipe** left/right on the number to delete a digit (as on iOS).

## Data & backups
History lives in the browser's storage on the phone, and iOS can wipe that.
**History ▸ Export** saves a backup file (use "Save to Files", e.g. iCloud Drive), and
**Import** merges one back in. A red dot on the History icon means the backup is overdue
(10+ new entries and more than 14 days since the last export).

## Files
- `engine.js`: all calculator maths (pure, tested)
- `app.js`: screen, gestures, history, pin, currency, backup
- `style.css`, `index.html`, `manifest.webmanifest`, `icons/`
- `sw.js`: offline cache
- `tests/engine.test.js`: run `node --test tests/engine.test.js`
- `tools/make_icons.py`: regenerates the icons (needs Pillow)

## Deploying a change
Bump `VERSION` in `sw.js` (e.g. `calc-v2`) with every change, otherwise phones keep the
cached old version. Commit and push; GitHub Pages redeploys in about a minute, and the phone
picks up the new version the next time the app is opened (sometimes it takes two launches).
