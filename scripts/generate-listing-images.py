#!/usr/bin/env python3
"""Generate the listing images planned by scripts/plan-listing-images.mjs.

    python3 scripts/generate-listing-images.py            # all remaining
    python3 scripts/generate-listing-images.py --limit 5  # try a handful first

Needs GEMINI_API_KEY with image quota. The free tier grants NONE (every image
model returns 'limit: 0'); billing must be enabled on the Google Cloud project
behind the key. Without that this exits immediately rather than half-running.

Resumable: an image already on disk is skipped, so re-running after a failure
or a rate-limit costs nothing.
"""
import argparse, json, os, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = os.path.join(ROOT, 'images/listings')
PLAN = os.path.join(ROOT, 'data/listing-image-plan.json')
MAP  = os.path.join(ROOT, 'data/listing-image-map.json')
MODEL_FALLBACKS = ['gemini-3.1-flash-image', 'gemini-2.5-flash-image']

ap = argparse.ArgumentParser()
ap.add_argument('--limit', type=int, default=0, help='stop after N new images')
ap.add_argument('--width', type=int, default=1200)
ap.add_argument('--quality', type=int, default=82)
args = ap.parse_args()

try:
    from google import genai
except ImportError:
    sys.exit('pip install google-genai')

key = os.environ.get('GEMINI_API_KEY')
if not key:
    sys.exit('GEMINI_API_KEY not set')
client = genai.Client(api_key=key)

plan = json.load(open(PLAN))['clusters']
os.makedirs(OUT, exist_ok=True)

def encode(png_bytes, dest):
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as t:
        t.write(png_bytes); tmp = t.name
    try:
        w = int(subprocess.run(['sips','-g','pixelWidth',tmp], capture_output=True, text=True)
                .stdout.strip().split(':')[-1])
        subprocess.run(['cwebp','-q',str(args.quality),'-resize',str(min(args.width,w)),'0',
                        '-m','6',tmp,'-o',dest], capture_output=True, check=True)
    finally:
        os.unlink(tmp)

def generate(prompt):
    last = None
    for model in MODEL_FALLBACKS:
        try:
            r = client.models.generate_content(model=model, contents=prompt)
            for part in (r.candidates[0].content.parts or []):
                blob = getattr(part, 'inline_data', None)
                if blob and blob.data:
                    return blob.data
            last = f'{model}: no image part in response'
        except Exception as e:
            last = f'{model}: {e}'
            if 'limit: 0' in str(e):
                sys.exit('\nGEMINI_API_KEY has no image quota (limit: 0).\n'
                         'Enable billing on the Google Cloud project behind the key, then re-run.')
    raise RuntimeError(last)

remaining = [c for c in plan if not os.path.exists(os.path.join(OUT, c['file'] + '.webp'))]
done = len(plan) - len(remaining)
todo = remaining[:args.limit] if args.limit else remaining
print(f'{len(plan)} planned, {done} already on disk, generating {len(todo)}'
      + (f' (--limit {args.limit})' if args.limit else '') + '\n')

made = failed = 0
for i, c in enumerate(todo, 1):
    dest = os.path.join(OUT, c['file'] + '.webp')
    try:
        encode(generate(c['prompt']), dest)
        made += 1
        print(f'  [{i}/{len(todo)}] {c["file"][:52]:54} {os.path.getsize(dest)//1024} KB  ({c["listings"]} listings)')
    except Exception as e:
        failed += 1
        print(f'  [{i}/{len(todo)}] FAILED {c["file"][:46]:48} {str(e)[:60]}')
    time.sleep(0.6)   # be gentle on the quota

# slug -> image stem, for the catalogue builder
mapping = {}
for c in plan:
    if os.path.exists(os.path.join(OUT, c['file'] + '.webp')):
        for s in c['slugs']:
            mapping[s] = c['file']
json.dump({'images': len(set(mapping.values())), 'listings': len(mapping), 'bySlug': mapping},
          open(MAP, 'w'), indent=1)

print(f'\ngenerated {made}, failed {failed}')
print(f'{len(mapping)} of 1191 listings now have a cluster image -> {os.path.relpath(MAP, ROOT)}')
