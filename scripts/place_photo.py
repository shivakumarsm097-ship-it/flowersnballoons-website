#!/usr/bin/env python3
"""Place a real event photo on the site for one occasion.

  python3 scripts/place_photo.py PHOTO OCCASION --alt "description" [--focus X,Y] [--no-card] [--no-gallery]

OCCASION: birthday wedding babyshower babywelcome namingceremony housewarming
          engagement haldi corporate community

What it does (images are compressed by scripts/optimize_image.py):
  * Homepage occasion card: if that card still shows its emoji icon, the icon is
    replaced by a photo banner (images/occasion-<occasion>.webp, 4:3).
  * Occasion page gallery (lp-<occasion>.html): the next tile that isn't one of
    your photos yet gets this photo (images/gallery-<occasion>-<n>.webp, square).
    Generic stock tiles are replaced first, then emoji tiles.
"""
import argparse
import html
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OCCASIONS = ["birthday", "wedding", "babyshower", "babywelcome", "namingceremony",
             "housewarming", "engagement", "haldi", "corporate", "community"]


def optimize(photo, slot, name, focus):
    subprocess.run([sys.executable, str(ROOT / "scripts/optimize_image.py"), photo, slot, name, "--focus", focus],
                   check=True)


def webp_sources(name):
    """srcset for every width variant that was written for NAME."""
    imgs = ROOT / "images"
    from PIL import Image
    main = imgs / f"{name}.webp"
    entries = []
    for p in sorted(imgs.glob(f"{name}-*.webp")):
        if re.fullmatch(rf"{re.escape(name)}-\d+\.webp", p.name):
            entries.append((Image.open(p).width, f"images/{p.name}"))
    w = Image.open(main).width
    entries.append((w, f"images/{name}.webp"))
    entries.sort()
    return entries, w, Image.open(main).height


def picture(name, alt, sizes):
    entries, w, h = webp_sources(name)
    srcset = ", ".join(f"{src} {width}w" for width, src in entries)
    a = html.escape(alt, quote=True)
    return (f'<picture><source srcset="{srcset}" sizes="{sizes}" type="image/webp">'
            f'<img src="images/{name}.jpg" alt="{a}" loading="lazy" decoding="async" width="{w}" height="{h}"></picture>')


def place_card(photo, occ, alt, focus):
    p = ROOT / "index.html"
    t = p.read_text(encoding="utf-8")
    # the usp-card whose Explore button links to /lp-<occ>
    m = re.search(r'(<div class="usp-card[^"]*">\n)((?:(?!<div class="usp-card).)*?href="/lp-' + occ + r'")', t, re.S)
    if not m:
        print(f"homepage card for {occ}: not found"); return
    card = m.group(2)
    icon = re.search(r'( *)<div class="usp-icon" aria-hidden="true">[^<]*</div>\n', card)
    if not icon:
        print(f"homepage card for {occ}: already has a photo (kept)"); return
    name = f"occasion-{occ}"
    optimize(photo, "card", name, focus)
    new = f'{icon.group(1)}<div class="occasion-photo">{picture(name, alt, "(min-width:1024px) 230px, (min-width:640px) 45vw, 92vw")}</div>\n'
    card2 = card[:icon.start()] + new + card[icon.end():]
    t = t[:m.start(2)] + card2 + t[m.end(2):]
    p.write_text(t, encoding="utf-8")
    print(f"homepage card for {occ}: photo added")


def place_gallery(photo, occ, alt, focus):
    p = ROOT / f"lp-{occ}.html"
    t = p.read_text(encoding="utf-8")
    tiles = list(re.finditer(r'( *)<div class="lp-gallery-item([^"]*)"[^>]*>.*?</div>\n', t))
    def is_ours(mt): return f"images/gallery-{occ}-" in mt.group(0)
    def is_stock(mt): return "lp-gallery-photo" in mt.group(2) and not is_ours(mt)
    target = next((mt for mt in tiles if is_stock(mt)), None) or next((mt for mt in tiles if "lp-gallery-photo" not in mt.group(2)), None)
    if not target:
        print(f"lp-{occ}.html gallery: all tiles already have your photos (nothing replaced)"); return
    n = 1 + sum(1 for mt in tiles if is_ours(mt))
    name = f"gallery-{occ}-{n}"
    optimize(photo, "square", name, focus)
    delay = re.search(r'reveal-delay-\d', target.group(2))
    cls = "lp-gallery-item lp-gallery-photo reveal" + (f" {delay.group(0)}" if delay else "")
    new = f'{target.group(1)}<div class="{cls}">{picture(name, alt, "(min-width:1024px) 190px, 33vw")}</div>\n'
    t = t[:target.start()] + new + t[target.end():]
    p.write_text(t, encoding="utf-8")
    print(f"lp-{occ}.html gallery: photo {n} added")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("photo")
    ap.add_argument("occasion", choices=OCCASIONS)
    ap.add_argument("--alt", required=True, help="what the photo shows (for screen readers and Google Images)")
    ap.add_argument("--focus", default="0.5,0.5")
    ap.add_argument("--no-card", action="store_true")
    ap.add_argument("--no-gallery", action="store_true")
    a = ap.parse_args()
    if not a.no_card:
        place_card(a.photo, a.occasion, a.alt, a.focus)
    if not a.no_gallery:
        place_gallery(a.photo, a.occasion, a.alt, a.focus)


if __name__ == "__main__":
    main()
