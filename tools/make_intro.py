"""Makes the first-launch guide's pictures (intro/*.webp) and where its notes go (intro/data.js) — real screenshots
of the app running in the iOS Simulator. intro.js shows them inside a drawn phone, with the notes as small labels.

  python3 tools/make_intro.py            photograph every picture that needs no tap, then build
  python3 tools/make_intro.py 1a 5c      just those, then build
  python3 tools/make_intro.py seed 6c    set that picture's page up in the simulator and stop (to tap something first) …
  python3 tools/make_intro.py shoot 6c   … then photograph it and build
  python3 tools/make_intro.py build      only rebuild intro/ from the photos already taken (after changing a note)

The web version looks the same, so both use these pictures. For each picture the app is reinstalled empty in the
simulator, given a saved page (and history), opened and photographed (photos are kept in /tmp/napkin-intro-shots). `build` saves each photo small, finds the written lines / answers / name chips in it, and writes data.js:
for each guide page, its pictures and its notes (words, the spot they point at, where the label sits).
Titles and order are in intro.js.

Needs the simulator build first (it photographs that app):
  xcodebuild -project ios/Napkin.xcodeproj -scheme Napkin -configuration Debug \
    -destination 'platform=iOS Simulator,id=<SIM>' -derivedDataPath ios/build/sim build
and Pillow. The measurements below are for the iPhone 18 Pro simulator (1206 × 2622)."""
import json, subprocess, sys, time
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "intro"
SIM = "C603D1E3-1E78-40C9-80B0-3819E696BA8C"          # iPhone 18 Pro
BID = "com.abodh.napkin"
APP = ROOT / "ios/build/sim/Build/Products/Debug-iphonesimulator/Napkin.app"
SHOTS = Path("/tmp/napkin-intro-shots")

# where things are on that screen, in pixels
W, CUT = 1206, 2622                                             # the picture is the whole screen
BELOW_BAR, CHIPS_TOP = 354, 1333                                # the writing starts / the name chips' row
BUTTONS = {                                                     # (left, top, right, bottom)
    "conv": (329, 1640, 590, 1791),      # ⇄
    "open": (329, 1464, 590, 1615),      # (
    "close": (615, 1464, 877, 1615),     # )
    "clear": (337, 207, 648, 333),       # Clear/New
    "older": (42, 207, 174, 333),        # ‹
    "histbar": (40, 352, 640, 442),      # the blue "Fri, Oct 2 · 1 of 3" bar (its date)
}
WIDTH = 720                                                     # saved width
LABEL = 0.046 * W                                               # a label's letter height on the photo (see style.css)

BILL = "45 food + 18 tip\nfood + tip = bill\nbill ÷ 4"       # short lines: the writing stays one size throughout
HOUR = 3600 * 1000


def old_pages(now):
    """Two earlier pages, so ‹ has somewhere to go."""
    return [
        {"id": "2026-09-28 18.05.10", "created": now - 96 * HOUR, "edited": now - 96 * HOUR, "text": "320 flight\n+ 85 hotel\n+ 40 food",
         "shared": "320 flight\n+ 85 hotel (405)\n+ 40 food (445)"},
        {"id": "2026-09-30 09.12.44", "created": now - 50 * HOUR, "edited": now - 50 * HOUR, "text": "1500 $ to ₹", "shared": "1500 $ to ₹"},
    ]


def with_bill(now):
    return old_pages(now) + [{"id": "2026-10-02 19.30.00", "created": now - 60000, "edited": now - 60000, "text": "\n" + BILL,
                              "shared": "\n45 food + 18 tip (63)\nfood + tip = bill (63)\nbill ÷ 4 (15.75)"}]


# One entry per picture. text: the page; caret: where its cursor sits (the end, unless given); history: pages already put away; ring: a button to ring (BUTTONS);
# tap: needs a tap in the simulator before the photo (seed, tap, shoot); hide: a patch of the photo to paint over;
# notes: (words, what they point at, where the label's middle sits from that spot: right, down). Spots:
#   line N (middle of line N) · start N (its first letter) · word N K (its K-th blue word) · answer N · chip K ·
#   a BUTTONS name. Lines, words and chips count from 1.
JUST, ANSWER = ("Just type", "start 1", 160, 200), ("Answer appears", "answer 1", -190, 400)
LIST = ("Or pick from a list", "conv", 150, -236)
FRAMES = {
    "1a": dict(text="45 +", notes=[JUST]),
    "1b": dict(text="45 + 18", notes=[JUST, ANSWER]),
    "1c": dict(text="45 + 18 + 12", notes=[JUST, ANSWER]),
    # the cursor is put back where it was (caret), so the bracket being added shows where you tapped
    "2a": dict(text="5 + 65 × 8", notes=[("Tap where you want", "start 1", 190, 200)]),
    "2b": dict(text="(5 + 65 × 8", caret=1, ring="open", notes=[("Add a bracket", "open", -120, -236)]),
    "2c": dict(text="(5 + 65) × 8", caret=8, ring="close", notes=[("Answer updates", "answer 1", -190, 400)]),
    "3a": dict(text="45 food + 18 tip", notes=[("A word names it", "word 1 1", 60, 200)]),
    "3b": dict(text="45 food + 18 tip\nfood + tip = bill", notes=[("Use the names", "word 2 1", 130, 200), ("Names the total", "word 2 3", 60, 400)]),
    "3c": dict(text=BILL, notes=[("Or tap a name", "chip 1", 190, -210)]),
    "4a": dict(text="320 flight", notes=[("First number", "start 1", 200, 200)]),
    "4b": dict(text="320 flight\n+ 85 hotel", notes=[("Start with +", "start 2", 190, 200), ("Running total", "answer 2", -190, 400)]),
    "4c": dict(text="320 flight\n+ 85 hotel\n+ 40 food", notes=[("Start with +", "start 3", 190, 200), ("Running total", "answer 3", -190, 400)]),
    "5a": dict(text="320 mi to km", ring="conv", notes=[("Units", "line 1", 0, 200), LIST]),
    "5b": dict(text="320 mi to km\n1500 $ to ₹", ring="conv", notes=[("Money", "line 2", 0, 200), LIST]),
    "5c": dict(text="320 mi to km\n1500 $ to ₹\n5 pm cst to ist", ring="conv", notes=[("Time zones", "line 3", 0, 200), LIST]),
    # the last page leaves the first line empty, so the labels under the top bar have room
    "6a": dict(text="\n" + BILL, history=old_pages, ring="clear", notes=[("New page", "clear", 0, 78)]),
    "6b": dict(text="", history=with_bill, ring="older", notes=[("Go back", "older", 90, 78)]),
    "6c": dict(text="", history=with_bill, tap="‹ (older page)", hide=(646, 358, 880, 436), notes=[("Your old page", "histbar", 0, 84)]),
}
PAGES = ["1", "2", "3", "4", "5", "6"]


def simctl(*args, check=True):
    return subprocess.run(["xcrun", "simctl", *args], capture_output=True, text=True, check=check).stdout.strip()


def seed(name):
    """A fresh copy of the app in the simulator with this picture's page saved in it, then opened."""
    f = FRAMES[name]
    now = int(time.time() * 1000)
    simctl("status_bar", SIM, "override", "--time", "9:41", "--dataNetwork", "wifi", "--wifiMode", "active", "--wifiBars", "3",
           "--cellularMode", "active", "--cellularBars", "4", "--batteryState", "charged", "--batteryLevel", "100", check=False)
    simctl("terminate", SIM, BID, check=False)
    simctl("uninstall", SIM, BID, check=False)
    simctl("install", SIM, str(APP))
    home = Path(simctl("get_app_container", SIM, BID, "data")) / "Library/Application Support/Napkin"
    (home / "History").mkdir(parents=True, exist_ok=True)
    text = f["text"]
    saved = {
        "calc.note": json.dumps({"text": text, "sel": [f.get("caret", len(text))] * 2, "updatedAt": now}),
        "calc.settings": json.dumps({"intro": 1}),                 # the guide itself stays out of the picture
    }
    (home / "storage.json").write_text(json.dumps(saved))
    for page in (f["history"](now) if f.get("history") else []):
        (home / "History" / (page["id"] + ".json")).write_text(json.dumps(page))
    simctl("launch", SIM, BID)
    time.sleep(3.5)                                                # the page, and the exchange rates, load


def cursor(im):
    """How much cursor-orange is in the writing area's left half — the photo with the cursor showing has the most."""
    box = im.crop((0, 180, im.width // 2, CHIPS_TOP)).convert("RGB")
    return sum(1 for r, g, b in box.getdata() if r > 230 and 130 < g < 185 and b < 60)


def shoot(name):
    """Photograph the simulator; the cursor blinks, so keep the photo where it shows."""
    SHOTS.mkdir(exist_ok=True)
    best = None
    for i in range(6):
        path = SHOTS / "try.png"
        simctl("io", SIM, "screenshot", str(path))
        im = Image.open(path).convert("RGB")
        score = cursor(im)
        if best is None or score > best[0]:
            best = (score, im)
        time.sleep(0.27)
    best[1].save(SHOTS / f"{name}.png")
    print(f"{name}: photographed")


# ---------- finding things in a photo ----------

def is_white(p): return p[0] > 185 and p[1] > 185 and p[2] > 185
def is_blue(p): return p[2] > 200 and p[1] > 150 and p[0] < 170
def is_answer(p): return p[0] > 120 and 60 < p[1] < 175 and p[2] < 70 and p[0] - p[2] > 90


def runs(flags, gap):
    """[(first, last)] stretches of True, joining stretches less than `gap` apart."""
    out, start, last = [], None, None
    for i, on in enumerate(flags):
        if not on:
            continue
        if start is None:
            start = i
        elif i - last > gap:
            out.append((start, last))
            start = i
        last = i
    if start is not None:
        out.append((start, last))
    return out


def layout(im):
    """The written lines: for each, its box, its blue words and its answer tag — and the name chips."""
    px = im.load()
    y0 = (BUTTONS["histbar"][3] + 6) if px[60, 400] != (0, 0, 0) else BELOW_BAR
    lines = []
    for a, b in runs([any(is_white(px[x, y]) or is_blue(px[x, y]) for x in range(30, 1000, 3)) for y in range(y0, CHIPS_TOP - 30)], 14):
        a, b = a + y0, b + y0
        if b - a < 30:
            continue                                               # the exchange-rate line, not writing
        ys = range(a, b + 1, 3)
        ink = [any(is_white(px[x, y]) or is_blue(px[x, y]) for y in ys) for x in range(W)]
        answer = runs([any(is_answer(px[x, y]) for y in ys) for x in range(W)], 60)
        answer = [r for r in answer if r[0] > W // 2 and r[1] - r[0] > 12]
        text = [r for r in runs(ink, 40) if not answer or r[1] < answer[-1][0]]
        words = [r for r in runs([any(is_blue(px[x, y]) for y in ys) for x in range(W)], 22) if r[1] - r[0] > 20]
        lines.append(dict(top=a, bottom=b, left=text[0][0], right=text[-1][1], words=words,
                          answer=(answer[-1][0] - 22, a - 6, answer[-1][1] + 22, b + 10) if answer else None))
    y = CHIPS_TOP + 50
    chips = [r for r in runs([px[x, y] != (0, 0, 0) for x in range(W)], 12) if r[1] - r[0] > 60]
    return lines, chips[1:]                                        # the first chip is "Name…"


def spot(spec, lines, chips):
    """The point a note points at: just under what's written, just above a key or chip."""
    kind, *n = spec.split()
    n = [int(v) for v in n]
    if kind in BUTTONS:
        x0, y0, x1, y1 = BUTTONS[kind]
        return ((x0 + x1) // 2, y0 - 26) if kind in ("conv", "open", "close") else ((x0 + x1) // 2, y1 + 24)
    if kind == "chip":
        a, b = chips[n[0] - 1]
        return (a + b) // 2, CHIPS_TOP - 16
    ln = lines[n[0] - 1]
    under = ln["bottom"] + 36
    if kind == "line":
        return (ln["left"] + ln["right"]) // 2, under
    if kind == "start":
        return ln["left"] + 26, under
    if kind == "word":
        a, b = ln["words"][n[1] - 1]
        return (a + b) // 2, under
    if kind == "answer":
        x0, _, x1, y1 = ln["answer"]
        return (x0 + x1) // 2, y1 + 30
    raise ValueError(spec)


def build():
    """intro/<name>.webp for every photo taken, and intro/data.js."""
    OUT.mkdir(exist_ok=True)
    data = {"size": [W, CUT], "pages": []}
    for page in PAGES:
        shots = [n for n in FRAMES if n[0] == page]
        notes, rings = [], []
        for i, name in enumerate(shots):
            f = FRAMES[name]
            im = Image.open(SHOTS / f"{name}.png").convert("RGB")
            if f.get("hide"):
                x0, y0, x1, y1 = f["hide"]
                im.paste(im.getpixel((x0 - 8, (y0 + y1) // 2)), f["hide"])
            small = im.crop((0, 0, W, CUT)).resize((WIDTH, round(CUT * WIDTH / W)), Image.LANCZOS)
            small.save(OUT / f"{name}.webp", "WEBP", quality=84, method=6)
            lines, chips = layout(im)
            for words, spec, dx, dy in f.get("notes", []):
                tx, ty = spot(spec, lines, chips)
                half = (len(words) * 0.52 + 1.7) * LABEL / 2       # about half the label's width
                cx = min(max(tx + dx, half + 26), W - half - 26)   # keep the whole label on the screen
                note = {"text": words, "tip": [round(tx / W, 4), round(ty / CUT, 4)], "at": [round(cx / W, 4), round((ty + dy) / CUT, 4)]}
                same = next((n for n in notes if n["text"] == words and i - 1 in n["frames"]
                             and abs(n["tip"][0] - note["tip"][0]) < 0.015 and abs(n["tip"][1] - note["tip"][1]) < 0.008), None)
                if same:
                    same["frames"].append(i)                       # the same note stays up across pictures
                else:
                    notes.append({**note, "frames": [i]})
            if f.get("ring"):
                x0, y0, x1, y1 = BUTTONS[f["ring"]]
                box = [round(x0 / W, 4), round(y0 / CUT, 4), round(x1 / W, 4), round(y1 / CUT, 4)]
                same = next((r for r in rings if r["box"] == box), None)
                if same:
                    same["frames"].append(i)
                else:
                    rings.append({"box": box, "frames": [i]})
        data["pages"].append({"shots": shots, "notes": notes, "rings": rings})
    (OUT / "data.js").write_text("/* Made by tools/make_intro.py: the guide's pictures and where their notes go (fractions of the picture). */\n"
                                 "window.INTRO_SHOTS = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    size = sum(p.stat().st_size for p in OUT.glob("*.webp")) // 1024
    print(f"built intro/: {len(list(OUT.glob('*.webp')))} pictures, {size} KB")


if __name__ == "__main__":
    args = sys.argv[1:]
    every = list(FRAMES)
    if args[:1] == ["seed"]:
        seed(args[1])
        tap = FRAMES[args[1]].get("tap")
        print(f"{args[1]}: ready" + (f" — tap {tap}, then: make_intro.py shoot {args[1]}" if tap else ""))
    elif args[:1] == ["shoot"]:
        shoot(args[1])
        build()
    elif args[:1] == ["build"]:
        build()
    else:
        for name in args or [n for n in every if not FRAMES[n].get("tap")]:
            seed(name)
            shoot(name)
        if all((SHOTS / f"{n}.png").exists() for n in every):
            build()
        else:
            print("not built yet — still to photograph:", " ".join(n for n in every if not (SHOTS / f"{n}.png").exists()))
