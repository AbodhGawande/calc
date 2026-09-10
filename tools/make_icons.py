"""Draws the app icons (run once; output is committed): python3 tools/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

S = 1024
OUT = Path(__file__).resolve().parent.parent / "icons"


def draw(scale=1.0):
    img = Image.new("RGB", (S, S), "#000")
    d = ImageDraw.Draw(img)
    for y in range(S):  # subtle top-to-bottom gradient
        c = round(0x24 * (1 - y / S) + 0x04 * (y / S))
        d.line([(0, y), (S, y)], fill=(c, c, c + 1))

    r = 0.165 * S * scale
    off = 0.205 * S * scale
    c = S / 2
    w = 0.03 * S * scale       # glyph stroke
    L = 0.07 * S * scale       # glyph half-length

    def bar(x0, y0, x1, y1):
        d.line([(x0, y0), (x1, y1)], fill="white", width=round(w))
        for x, y in ((x0, y0), (x1, y1)):
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill="white")

    cells = [
        ((c - off, c - off), "#5c5c5f", "plus"),
        ((c + off, c - off), "#5c5c5f", "minus"),
        ((c - off, c + off), "#5c5c5f", "times"),
        ((c + off, c + off), "#ff9f0a", "equals"),
    ]
    for (x, y), col, glyph in cells:
        d.ellipse([x - r, y - r, x + r, y + r], fill=col)
        if glyph in ("plus", "minus"):
            bar(x - L, y, x + L, y)
        if glyph == "plus":
            bar(x, y - L, x, y + L)
        if glyph == "times":
            k = L * 0.75
            bar(x - k, y - k, x + k, y + k)
            bar(x - k, y + k, x + k, y - k)
        if glyph == "equals":
            g = 0.036 * S * scale
            bar(x - L, y - g, x + L, y - g)
            bar(x - L, y + g, x + L, y + g)
    return img


OUT.mkdir(exist_ok=True)
full = draw()
full.resize((512, 512), Image.LANCZOS).save(OUT / "icon-512.png")
full.resize((192, 192), Image.LANCZOS).save(OUT / "icon-192.png")
full.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png")
draw(scale=0.82).resize((512, 512), Image.LANCZOS).save(OUT / "icon-maskable-512.png")
print("icons written to", OUT)
