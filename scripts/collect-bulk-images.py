#!/usr/bin/env python3
"""Take a folder of bulk-downloaded Flow images and file them against the plan.

    python3 scripts/collect-bulk-images.py ~/Downloads/flow-export --dry-run
    python3 scripts/collect-bulk-images.py ~/Downloads/flow-export

Bulk tools name their output in whatever way they like, so there are two ways
to line images up with data/listing-image-plan.json:

  --by name      the file name contains the plan's file key (best, unambiguous)
  --by position  sort files and pair them with the plan in order (default)

Position matching only holds if every prompt produced exactly one image and
none failed, so it ALWAYS prints the pairing and refuses to run when the
counts differ unless you pass --allow-partial. Check a dry run before writing.
"""
import argparse, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = os.path.join(ROOT, 'images/listings')
PLAN = os.path.join(ROOT, 'data/listing-image-plan.json')
MAP  = os.path.join(ROOT, 'data/listing-image-map.json')
EXT  = ('.png', '.jpg', '.jpeg', '.webp')

ap = argparse.ArgumentParser()
ap.add_argument('folder', help='folder the bulk download wrote into')
ap.add_argument('--by', choices=['position', 'name'], default='position')
ap.add_argument('--dry-run', action='store_true')
ap.add_argument('--allow-partial', action='store_true')
ap.add_argument('--width', type=int, default=1200)
ap.add_argument('--quality', type=int, default=82)
a = ap.parse_args()

plan = json.load(open(PLAN))['clusters']
folder = os.path.expanduser(a.folder)
if not os.path.isdir(folder):
    sys.exit(f'not a folder: {folder}')

def natural(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', s)]

files = sorted((f for f in os.listdir(folder) if f.lower().endswith(EXT)), key=natural)
if not files:
    sys.exit(f'no images in {folder}')

pairs = []
if a.by == 'name':
    for c in plan:
        hit = next((f for f in files if c['file'] in f.lower()), None)
        if hit:
            pairs.append((c, hit))
else:
    if len(files) != len(plan) and not a.allow_partial:
        sys.exit(f'{len(files)} images but {len(plan)} prompts.\n'
                 'Position matching needs them equal, or the mapping silently shifts.\n'
                 'Re-export, use --by name, or pass --allow-partial if you accept the risk.')
    pairs = list(zip(plan, files))

print(f'{len(files)} images, {len(plan)} prompts, pairing {len(pairs)} by {a.by}\n')
for c, f in pairs[:5]:
    print(f'  {f[:40]:42} -> {c["file"][:44]:46} ({c["listings"]} listings)')
if len(pairs) > 5:
    print(f'  …and {len(pairs)-5} more')

if a.dry_run:
    print('\ndry run, nothing written'); sys.exit(0)

os.makedirs(OUT, exist_ok=True)
made = 0
for c, f in pairs:
    src  = os.path.join(folder, f)
    dest = os.path.join(OUT, c['file'] + '.webp')
    w = int(subprocess.run(['sips', '-g', 'pixelWidth', src], capture_output=True, text=True)
            .stdout.strip().split(':')[-1])
    subprocess.run(['cwebp', '-q', str(a.quality), '-resize', str(min(a.width, w)), '0',
                    '-m', '6', src, '-o', dest], capture_output=True, check=True)
    made += 1

mapping = {}
for c in plan:
    if os.path.exists(os.path.join(OUT, c['file'] + '.webp')):
        for s in c['slugs']:
            mapping[s] = c['file']
json.dump({'images': len(set(mapping.values())), 'listings': len(mapping), 'bySlug': mapping},
          open(MAP, 'w'), indent=1)

print(f'\nencoded {made} -> images/listings/')
print(f'{len(mapping)} listings now have an image. Next: node scripts/build-catalog.mjs')
