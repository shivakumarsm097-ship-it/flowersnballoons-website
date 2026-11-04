#!/usr/bin/env python3
"""Turn an original photo into small, fast web images for a site slot.

Every output is: rotated upright (EXIF), stripped of all metadata (camera,
GPS location), cropped to the slot's shape, resized to the widths the page
actually shows, and saved as WebP (plus a JPG fallback for the largest size).

Usage (from the repo root):
  python3 scripts/optimize_image.py PHOTO SLOT NAME [--focus X,Y]

  SLOT   card    4:3,  widths 1200 + 600   (service cards, gallery tiles)
         hero    16:9, widths 1920 + 1280 + 768  (page background)
         square  1:1,  widths 800 + 400
         og      1200x630 JPG only          (WhatsApp / social share preview)
  NAME   output base name in images/, e.g. birthday-balloon-arch
  --focus  where to keep when cropping, as fractions (0.5,0.5 = centre;
           0.5,0.3 = keep the upper part)

Writes images/NAME.webp (largest), images/NAME-<w>.webp (smaller sizes) and
images/NAME.jpg (fallback), and prints each file's size.
"""
import argparse
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SLOTS = {
    "card":   {"ratio": (4, 3),    "widths": [1200, 600]},
    "hero":   {"ratio": (16, 9),   "widths": [1920, 1280, 768]},
    "square": {"ratio": (1, 1),    "widths": [800, 400]},
    "og":     {"ratio": (1200, 630), "widths": [1200], "jpg_only": True},
}
WEBP_Q, JPG_Q = 74, 80


def crop_to(im, ratio, fx, fy):
    w, h = im.size
    tw, th = ratio
    if w / h > tw / th:                      # too wide: trim sides
        nw = round(h * tw / th)
        x = round((w - nw) * fx)
        return im.crop((x, 0, x + nw, h))
    nh = round(w * th / tw)                  # too tall: trim top/bottom
    y = round((h - nh) * fy)
    return im.crop((0, y, w, y + nh))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("photo")
    ap.add_argument("slot", choices=SLOTS)
    ap.add_argument("name")
    ap.add_argument("--focus", default="0.5,0.5")
    a = ap.parse_args()
    fx, fy = (float(v) for v in a.focus.split(","))
    cfg = SLOTS[a.slot]

    im = ImageOps.exif_transpose(Image.open(a.photo)).convert("RGB")   # upright, no alpha
    im = crop_to(im, cfg["ratio"], fx, fy)
    out = ROOT / "images"
    written = []
    # never upscale (it only adds bytes); a small photo's own width becomes the largest size.
    # og is the exception: share previews must be exactly 1200x630.
    widths = cfg["widths"] if cfg.get("jpg_only") else ([w for w in cfg["widths"] if w <= im.width] or [im.width])
    for i, w in enumerate(widths):
        r = im.resize((w, round(w * im.height / im.width)), Image.LANCZOS) if im.width != w else im
        if cfg.get("jpg_only"):
            p = out / f"{a.name}.jpg"
            r.save(p, "JPEG", quality=JPG_Q, optimize=True, progressive=True)
            written.append(p)
            continue
        p = out / (f"{a.name}.webp" if i == 0 else f"{a.name}-{w}.webp")
        r.save(p, "WEBP", quality=WEBP_Q, method=6)
        written.append(p)
        if i == 0:
            jp = out / f"{a.name}.jpg"
            r.save(jp, "JPEG", quality=JPG_Q, optimize=True, progressive=True)
            written.append(jp)
    src_kb = Path(a.photo).stat().st_size / 1024
    print(f"{Path(a.photo).name} ({src_kb:,.0f} KB, {Image.open(a.photo).size[0]}px) ->")
    for p in written:
        with Image.open(p) as x:
            print(f"  images/{p.name:40s} {x.size[0]}x{x.size[1]}  {p.stat().st_size/1024:6.0f} KB")


if __name__ == "__main__":
    main()
