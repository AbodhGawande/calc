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
- **One running page.** Each line is a calculation. Answers appear on the right as you type (30% dimmer) once
  there are two numbers and an operator; `=` finishes the line (the answer turns solid). The trash button clears
  the page (Undo brings it back). The text starts large and shrinks as the page fills, never below 22px.
- **Words:** words before the maths are a label ("Hotel (120+95)×2"). A word right after a number is left out of the
  maths and names that number (`700 rent + 500 food` = 1,200, and rent = 700, food = 500); small words like "for"
  are skipped. A word after `=` names the total (`… = expense`). Typing a letter straight after a number or `=` adds
  the space for you.
- **Several lines:** a line starting with `+ − × ÷` carries on from the line above (× and ÷ apply to the running
  total); the total shows on the last line. A blank line or a line starting with a number or word starts afresh.
- **Edit anything.** Tap anywhere to place the cursor and change a number; answers update instantly.
- **Brackets** `(` `)` go anywhere. A missing `)` is added for you, and `2(3+4)` multiplies.
- **Calculator habits:** a number typed after an answer starts a new line; an operator after an answer starts a new
  line that carries on from it (`50+25+60=` then `×2`).
- **Live answers are not calculated** for a `-` or `/` typed between digits with no spaces (dates, phone numbers)
  until you press `=`. The keypad's `−` and `÷` always count.
- **Answers** sit in a column on the right as orange tags. Tap one for **Use** (puts the number on your line, or a new
  line if that one is finished), **Name**, or **Copy**. A plain number needs no answer; a grey `?` means the line
  can't be worked out (tap it for why).
- **Names:** lines below can use a name (`rent×12`); editing the original line updates them all, and the same name
  set again further down takes over from there. Names are one word starting with a letter; capitals don't matter.
  Names show in blue; their chips above the keypad (most recent first) insert them (after a number, `×` is added).
  **Name…** above the keypad, or an answer's **Name**, names a line without the keyboard (writes `… = rent`, or
  `200 rent` for a plain number). Older `→ rent` / `=rent` lines are rewritten the current way on launch.
- **Help:** the `?` button in the top bar opens a short guide. It also opens once after an update that changes how
  things work (`HELP_VERSION` in `app.js`).
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
Bump `VERSION` in `sw.js` (e.g. `calc-v6`) with every change, otherwise phones keep the cached old version.
Commit and push; GitHub Pages redeploys in about a minute, and the app reloads itself into the new version the
next time it's opened.
