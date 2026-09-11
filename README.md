# Tote

(Named "Calc" until version 10. The repo, web address and saved-data keys still say `calc`, on purpose:
changing them would move the app to a new address and lose what's saved on the phone.)

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
- **Help:** the `?` button opens a guide made of example cards (`help.js`). The very first launch seeds the page with a
  worked example (`EXAMPLE_PAGE` in `app.js`) instead.
- **ABC** brings up the iPhone keyboard for words. The orange calculator button (top right) brings the keypad back.
- **Conversions** (`units.js`): type `50 km to mi`, `5 ft 10 in to cm`, `180 cm to ft` (feet always show as feet and
  inches), `72 f to c`, `100 $ to ₹`, `3 pm cst to ist`. Weight, length, speed, volume, area, fuel, temperature,
  11 currencies and 16 time zones. The `⇄` key opens a sheet of two-way rows (`convert.js`); `+` writes the row onto
  the page. Rates come from the ECB via Frankfurter, with ExchangeRate-API as a fallback; the last rate is saved for
  offline use and the rate line turns orange once it is more than a day old (tap to refresh). The old `100 $→₹=`
  form still works.
- **Clear** wipes the page at once; the toast's Undo (or ↶) brings it back. Answers show 2 decimals; the tap menu
  shows the full number.
- **Date lines:** the first thing typed at the end of the page on a new day is preceded by `— Fri, Sep 11, 2026`
  (`dividerFor` in `engine.js`). A date line counts as a blank line: it breaks multi-line sums and sets no names.
- The page is focused at launch, so the cursor shows before the first key.

## Share, and keeping a copy
The share button sends the page **as text** (answers included: `45 pizza + 18 drinks = bill (63)`) or **as a picture**.
Text shared to Notes or Messages doubles as a copy: paste it back onto the page and the answers are stripped off
(`stripAnswers` in `engine.js`), so the lines calculate again. The page lives in the browser's storage on the phone,
which iOS can wipe, so share it to Notes now and then.

## Files
- `engine.js`: the page rules and maths (pure, tested)
- `units.js`: conversion table, currency and time zones (pure, tested)
- `app.js`: editor, keypad, answers, names
- `rates.js`: exchange rates (fetch, cache, rate line) · `share.js`: share as text/picture
- `convert.js`: the ⇄ sheet · `help.js`: the help cards
- `style.css`, `index.html`, `manifest.webmanifest`, `icons/`
- `sw.js`: offline cache
- `tests/`: run `node --test tests/engine.test.js tests/units.test.js`
- `tools/make_icons.py`: regenerates the icons (needs Pillow)

## Deploying a change
Bump `VERSION` in `sw.js` (e.g. `calc-v10`) with every change, otherwise phones keep the cached old version, and
set `APP_VERSION` in `app.js` to the same number (it's shown at the bottom of the help page).
Commit and push; GitHub Pages redeploys in about a minute, and the app reloads itself into the new version the
next time it's opened.
