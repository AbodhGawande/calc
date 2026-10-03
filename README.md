# Napkin

(Named "Calc" until version 10 and "Tote" until version 25. The repo, web address and saved-data keys still say
`calc`, on purpose: changing them would move the app to a new address and lose what's saved on the phone.)

A calculator page in the style of Apple's Math Notes, with a calculator keypad, free editing,
brackets anywhere, and USD ⇄ INR conversion. Built as a Home Screen web app (PWA): plain
HTML/CSS/JS, no build step, no dependencies.

## Native iPhone app
`ios/` wraps these same files in a native app (`ios/README.md`): built and installed over Wi-Fi (paid developer
team, signing lasts a year), kept up to date by `ios/tools/renew.py`. The app keeps its history of put-away pages
in its own iCloud folder too (iCloud Drive › Napkin). The web version below is the same app for sharing; its history
stays on the phone only (a web page can't write to iCloud Drive).

## Install on iPhone (web version)
1. Open https://abodhgawande.github.io/calc/ in **Safari**.
2. Share ▸ **Add to Home Screen**.
3. Launch it from the Home Screen icon. It runs full screen and works offline.
   (The Home Screen app keeps its own storage, separate from Safari's.)

## How it works
- **One running page.** Each line is a calculation. Answers appear on the right as you type (30% dimmer) once
  there are two numbers and an operator; `=` finishes the line (the answer turns solid). The text starts large and
  shrinks as the page fills, never below 22px.
- **History:** **Clear/New** puts the page away and starts a fresh one (Undo brings it back); ‹ › step through
  put-away pages, newest first. An old page can be edited (it moves up at the next Clear/New) or deleted; a page goes a
  year after its last edit. Web version: `calc.pages` in localStorage, on that phone only. iPhone app: `ios/README.md`.
- **Words:** words before the maths are a label ("Hotel (120+95)×2"). A word right after a number is left out of the
  maths and names that number (`700 rent + 500 food` = 1,200, and rent = 700, food = 500); small words like "for"
  are skipped. A word after `=` names the total (`… = expense`). Typing a letter straight after a number or `=` adds
  the space for you.
- **Several lines:** a line starting with `+ − × ÷` (or a line ending with one) carries on from the line above (× and ÷
  apply to the running total); each row shows the total so far. A blank line or a line starting with a number or word starts afresh.
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
- **Help:** the `?` button opens a guide made of example cards (`help.js`).
- **First-launch guide** (`intro.js`): shown once (`settings.intro`; raise `INTRO` in `app.js` to show it again to
  everyone), replayable from the top of the help page. A few pages to swipe through, each a title of four words at
  most over a drawn phone that plays real screenshots in a loop, with small labels pointing at what matters. The
  screenshots and label positions (`intro/*.webp`, `intro/data.js`) are made from the simulator by
  `tools/make_intro.py` — rerun it when the look of the app changes. The page starts blank behind the guide.
- **Add to Home Screen** (web version only; never in the iPhone app, nor once it runs from the Home Screen): a page
  can't add itself on an iPhone — only Safari's own menu can — so there the guide ends with a page playing those taps
  (page menu ▸ Share ▸ View More ▸ Add to Home Screen; real Safari screenshots, `intro/7a–7d`), and the help page has
  an **Add to Home Screen** button that opens it. In browsers that let a page offer it (Android, Chrome on a
  computer: `beforeinstallprompt`), the same button, and the guide's last page, do it in one tap.
- **ABC** brings up the iPhone keyboard for words. The orange calculator button in the top bar brings the keypad back.
- **Conversions** (`units.js`): type `50 km to mi`, `5 ft 10 in to cm`, `180 cm to ft` (feet always show as feet and
  inches), `72 f to c`, `100 $ to ₹`, `3 pm cst to ist`. Weight, length, speed, volume, area, fuel, temperature,
  11 currencies and 16 time zones. The `⇄` key opens a sheet of two-way rows (`convert.js`); `+` writes the row onto
  the page. Rates come from the ECB via Frankfurter, with ExchangeRate-API as a fallback; the last rate is saved for
  offline use and the rate line turns orange once it is more than a day old (tap to refresh). The old `100 $→₹=`
  form still works.
- Answers show 2 decimals; the tap menu shows the full number.
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
- `convert.js`: the ⇄ sheet · `help.js`: the help cards · `intro.js` + `intro/`: the first-launch guide
- `style.css`, `index.html`, `manifest.webmanifest`, `icons/`
- `sw.js`: offline cache
- `tests/`: run `node --test tests/engine.test.js tests/units.test.js`
- `tools/make_icons.py`: regenerates the icons (needs Pillow) · `tools/make_intro.py`: the guide's screenshots

## The link's preview
Pasting https://abodhgawande.github.io/calc/ into Notes, Messages, Telegram and the like shows a card with a picture:
the `og:` lines in `index.html` name the title, a line of description and `icons/share.jpg` (1200 × 630, drawn by
`tools/make_intro.py` from one of the guide's screenshots). Apps keep their own copy of a link's preview for a while;
Telegram's can be refreshed by sending the link to @WebpageBot.

## Opening fast, and offline
`sw.js` keeps the whole app on the phone and serves it from there; the internet is only used to look for a new version
(and for exchange rates). A new version's own files are stored first; the guide's pictures are stored afterwards, when
the page asks (`postMessage('pictures')`), and anything else is kept the first time it's fetched. So that the Home
Screen app opens on black rather than iOS's white launch screen, `index.html` sets a black background inline and lists
a plain black launch picture per iPhone size (`icons/launch/`, made by `tools/make_icons.py`). iOS only picks launch
pictures up when the app is added to the Home Screen, so an existing icon has to be removed and added again to get
them (that deletes that copy's saved page and history). A copy opened as a plain Safari tab is wiped by iOS after about
a week unused; the Home Screen app's copy is kept.

## Deploying a change
Bump `VERSION` in `sw.js` (e.g. `calc-v10`) with every change, otherwise phones keep the cached old version, and
set `APP_VERSION` in `app.js` to the same number (it's shown at the bottom of the help page).
Commit and push; GitHub Pages redeploys in about a minute, and the app reloads itself into the new version the
next time it's opened.
