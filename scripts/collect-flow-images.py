#!/usr/bin/env python3
"""Map Google Flow downloads to category slugs and encode them as web webp.

Flow names each download after its own caption, so the mapping is by content
rather than by the order things were clicked -- which drifted badly when the
media grid turned out to be virtualised.
"""
import os, re, glob, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DL   = os.path.expanduser('~/Downloads')
OUT  = os.path.join(ROOT, 'images/categories')
SRC  = os.path.join(ROOT, '.img-src')

CAPTION_TO_CATEGORY = {
    'Haldi_ceremony_terrace_setup':        'haldi',
    'Chairs_under_white_shamiana_tent':    'shamyana-items',
    'South_Indian_villa_at_dusk':          'house-lighting',
    'Floral_ring_backdrop_on_stage':       'engagement',
    'Anniversary_dinner_setup':            'anniversary',
    'Surprise_celebration_with_balloo':    'surprise-events',
    'Bachelorette_party_balloon_setup':    'bachelorette',
    'First_rice_ceremony_setup':           'annaprasan',
    'Traditional_thread_ceremony_setup':   'upanayanam',
    'Holy_communion_celebration_table':    'first-holy-communion',
    'Apartment_birthday_setup':            'kids-birthday-simple-home-decor',
    'Children_playing_in_bouncy_castle':   'kids-birthday-fun-activities',
    'Food_counter_at_children':            'kids-birthday-fun-eats',
    'Photographer_capturing_child_blo':    'kids-birthday-photography',
    'Photographer_taking_photos_at_sh':    'baby-shower-photography',
    'Photographer_capturing_cradle_ce':    'naming-ceremony-photography',
    'Photographer_shooting_family_at':     'house-warming-photography',
    'Photographer_photographing_flora':    'engagement-photography',
    'Photographer_shooting_outdoor_event': 'haldi-photography',
    'Photographer_at_wedding_mandap':      'wedding-photography',
    'Photographer_at_communion_celebr':    'first-holy-communion-photography',
}

os.makedirs(OUT, exist_ok=True)
os.makedirs(SRC, exist_ok=True)

files = [f for f in glob.glob(os.path.join(DL, '*.jpg')) if re.search(r'_2026\d{10}\.jpg$', f)]
done, missing = [], []

for prefix, slug in CAPTION_TO_CATEGORY.items():
    cands = [f for f in files if os.path.basename(f).startswith(prefix)]
    if not cands:
        missing.append((slug, prefix)); continue
    src = max(cands, key=os.path.getmtime)          # newest if a tile was grabbed twice
    dest = os.path.join(OUT, slug + '.webp')
    # 1600 is the widest the header is ever rendered; cwebp will not upscale a
    # narrower source because -resize keeps aspect and we cap at the source width
    w = int(subprocess.run(['sips','-g','pixelWidth',src], capture_output=True, text=True)
            .stdout.strip().split(':')[-1])
    target = min(1600, w)
    subprocess.run(['cwebp','-q','82','-resize',str(target),'0','-m','6',src,'-o',dest],
                   capture_output=True, check=True)
    os.replace(src, os.path.join(SRC, slug + '.jpg'))
    done.append((slug, w, os.path.getsize(dest)//1024))

for slug, w, kb in sorted(done):
    print(f'  {slug:36} {w}px -> {kb} KB')
print(f'\nconverted {len(done)}')
if missing:
    print('MISSING:')
    for slug, p in missing: print(f'  {slug:36} (no file starting {p})')
