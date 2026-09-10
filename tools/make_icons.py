"""Draws the app icons (run once; output is committed): python3 tools/make_icons.py

An original drawing in the style of a classic calculator app icon: a light tile, a dark calculator
with a grey display, light grey keys and an orange column. iOS rounds the corners itself."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

S = 1024
OUT = Path(__file__).resolve().parent.parent / "icons"


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def vgradient(top, bottom):
    """Full-size vertical gradient (built as a 1-px column, then stretched)."""
    col = Image.new("RGB", (1, S))
    a, b = rgb(top), rgb(bottom)
    for y in range(S):
        t = y / (S - 1)
        col.putpixel((0, y), tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3)))
    return col.resize((S, S))


def mask(draw_fn):
    m = Image.new("L", (S, S), 0)
    draw_fn(ImageDraw.Draw(m))
    return m


def draw(scale=1.0):
    k = S * scale
    X = lambda f: S / 2 + (f - 0.5) * k  # position on the canvas for a 0..1 design coordinate

    img = vgradient("#f8f8fa", "#d2d2d7")

    body = (X(0.28), X(0.155), X(0.72), X(0.845))
    radius = 0.075 * k
    # soft shadow under the calculator
    drop = 0.02 * k
    shadow = mask(lambda d: d.rounded_rectangle((body[0], body[1] + drop, body[2], body[3] + drop), radius, fill=120))
    img.paste(Image.new("RGB", (S, S), (70, 70, 78)), (0, 0), shadow.filter(ImageFilter.GaussianBlur(0.028 * k)))
    # body
    img.paste(vgradient("#505055", "#1d1d20"), (0, 0), mask(lambda d: d.rounded_rectangle(body, radius, fill=255)))
    # display
    disp = (X(0.335), X(0.215), X(0.665), X(0.355))
    img.paste(vgradient("#b9b9be", "#8c8c92"), (0, 0), mask(lambda d: d.rounded_rectangle(disp, 0.028 * k, fill=255)))
    # keys: 3 × 3, orange right-hand column
    r = 0.047 * k
    light, orange = vgradient("#f0f0f3", "#c3c3c9"), vgradient("#ffb547", "#ff9500")
    for yf in (0.47, 0.6, 0.73):
        for col, xf in enumerate((0.375, 0.5, 0.625)):
            x, y = X(xf), X(yf)
            img.paste(orange if col == 2 else light, (0, 0), mask(lambda d: d.ellipse((x - r, y - r, x + r, y + r), fill=255)))
    return img


OUT.mkdir(exist_ok=True)
full = draw()
full.resize((512, 512), Image.LANCZOS).save(OUT / "icon-512.png")
full.resize((192, 192), Image.LANCZOS).save(OUT / "icon-192.png")
full.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png")
draw(scale=0.8).resize((512, 512), Image.LANCZOS).save(OUT / "icon-maskable-512.png")
print("icons written to", OUT)
