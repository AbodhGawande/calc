# Calc

A calculator page in the style of Apple's Math Notes, with a calculator keypad, free editing,
brackets anywhere, and USD ⇄ INR conversion. Built as a Home Screen web app (PWA): plain
HTML/CSS/JS, no build step, no dependencies.

## Install on iPhone
1. Open https://abodhgawande.github.io/calc/ in **Safari**.
2. Share ▸ **Add to Home Screen**.
3. Launch it from the Home Screen icon. It runs full screen and works offline.
   (The Home Screen app keeps its own storage, separate from Safari's.)

## How it works
- **One running page.** Each line is a calculation, and words are allowed ("Hotel (120+95)×2 ="). When a line
  ends with `=`, its answer appears in orange. The trash button clears the page (Undo brings it back).
- **Edit anything.** Tap anywhere to place the cursor and change a number; answers update instantly.
- **Brackets** `(` `)` go anywhere. A missing `)` is added for you, and `2(3+4)` multiplies.
- **Calculator habits:** a number typed after an answer starts a new line. An operator after an answer
  continues the same line, adding brackets when needed (`50+25+60=` then `×2` → `(50+25+60)×2=`).
- **Tap an orange answer** to insert it at the cursor.
- **ABC** brings up the iPhone keyboard for words. The orange calculator button (top right) brings the keypad back.
- **$₹** turns the current line into a conversion (`100 $→₹=`). Tap again to flip the direction.
  Rates come from the ECB via Frankfurter, with ExchangeRate-API as a fallback. The last rate is saved for
  offline use, and the rate line turns orange once it is more than a day old. Tap it to refresh.

## Data & backups
The page lives in the browser's storage on the phone, and iOS can wipe that.
**Backup ▸ Export** saves a copy (use "Save to Files", e.g. iCloud Drive), and **Import** adds a saved copy to the
end of the page. A red dot on the Backup button means a backup is overdue.

## Files
- `engine.js`: all maths (pure, tested)
- `app.js`: editor, keypad, currency, backup
- `style.css`, `index.html`, `manifest.webmanifest`, `icons/`
- `sw.js`: offline cache
- `tests/engine.test.js`: run `node --test tests/engine.test.js`
- `tools/make_icons.py`: regenerates the icons (needs Pillow)

## Deploying a change
Bump `VERSION` in `sw.js` (e.g. `calc-v3`) with every change, otherwise phones keep the cached old version.
Commit and push; GitHub Pages redeploys in about a minute, and the app reloads itself into the new version the
next time it's opened.
