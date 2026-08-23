#!/usr/bin/env node
/**
 * Image import pipeline.
 *
 *   1. Drop photos into  images/incoming/
 *   2. node scripts/import-images.mjs
 *   3. node scripts/build-catalog.mjs
 *
 * Produces web-sized .webp at two widths into images/products/ and tells you
 * exactly which products got covered and which are still bare.
 *
 * FILENAME RULES (case/spacing/underscores don't matter):
 *
 *   jungle-safari-standard.jpg   -> that exact product
 *   3D Butterfly Theme Decor.jpg -> that product (name match, spacing/case ignored)
 *   kids-birthday.jpg            -> fallback for any Kids Birthday product with no own photo
 *   kids-birthday-2.jpg          -> second fallback for that category (rotates)
 *
 * Anything that matches nothing is REPORTED, never silently dropped.
 *
 * Handles .heic/.heif (iPhone) via sips, plus jpg/jpeg/png/webp.
 * Requires: cwebp + sips (both already present on this machine).
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IN = join(ROOT, 'images/incoming');
const OUT = join(ROOT, 'images/products');
const TMP = join(ROOT, '.img-tmp');

const WIDTHS = { card: 600, full: 1200 };
const QUALITY = 82;

const norm = (s) => s.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');

if (!existsSync(IN)) {
  mkdirSync(IN, { recursive: true });
  console.log(`Created ${IN.replace(ROOT + '/', '')}/ — drop photos in there and re-run.`);
  process.exit(0);
}

const catalogPath = join(ROOT, 'data/products.json');
if (!existsSync(catalogPath)) {
  console.error('data/products.json missing — run: node scripts/build-catalog.mjs');
  process.exit(1);
}
const { products, categories } = JSON.parse(readFileSync(catalogPath, 'utf8'));

/* filename -> listing, harvested from the source category pages by
   scripts/harvest-pairings.mjs. This is what lets "12-1.png" land on the
   right listing instead of being guessed at from appearance. */
let PAIR = { map: {} };
try { PAIR = JSON.parse(readFileSync(join(ROOT, 'data/source-filenames.json'), 'utf8')); } catch { /* optional */ }

// lookup tables
const bySlug = new Map(products.map((p) => [p.slug, p]));
const byTheme = new Map();
for (const p of products) {
  const t = norm(p.name);
  if (!byTheme.has(t)) byTheme.set(t, []);
  byTheme.get(t).push(p);
}
const catSlugs = new Set(categories.map((c) => c.slug));

const IMG_RE = /\.(jpe?g|png|webp|heic|heif)$/i;
/* one level deep: images/incoming/<category>/<file> — the folder name
   disambiguates filenames reused across categories (81 of them) */
const files = [];
for (const entry of readdirSync(IN, { withFileTypes: true })) {
  if (entry.name.startsWith('.')) continue;
  if (entry.isDirectory()) {
    for (const f of readdirSync(join(IN, entry.name))) {
      if (!f.startsWith('.') && IMG_RE.test(f)) files.push(join(entry.name, f));
    }
  } else if (IMG_RE.test(entry.name)) {
    files.push(entry.name);
  }
}

if (!files.length) {
  console.log(`No images in images/incoming/.\n`);
  console.log(`Drop photos there named after the product or category, e.g.`);
  console.log(`  3d-butterfly-theme-decor.jpg  (one product — see FILENAMES.csv)`);
  console.log(`  3D Butterfly Theme Decor.jpg  (same, by full name)`);
  console.log(`  kids-birthday-1.jpg          (category fallback)`);
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

/** decode to a cwebp-readable file (handles HEIC) */
function toReadable(src) {
  const ext = extname(src).toLowerCase();
  if (ext !== '.heic' && ext !== '.heif') return src;
  const out = join(TMP, basename(src, ext) + '.jpg');
  execFileSync('sips', ['-s', 'format', 'jpeg', src, '--out', out], { stdio: 'pipe' });
  return out;
}

function dims(f) {
  try {
    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', f], { encoding: 'utf8' });
    return {
      w: parseInt(out.match(/pixelWidth:\s*(\d+)/)?.[1] || '0', 10),
      h: parseInt(out.match(/pixelHeight:\s*(\d+)/)?.[1] || '0', 10),
    };
  } catch { return { w: 0, h: 0 }; }
}
const srcWidth = (f) => dims(f).w;

/* Real aspect ratio per image stem. Without this the product page forces a
   fixed 4:3 box, which crops the sides off a 3:2 photo and upscales it. */
const ratios = {};

function encode(src, stem) {
  const readable = toReadable(src);
  const d0 = dims(readable);
  const w0 = d0.w;
  if (d0.w && d0.h) ratios[stem] = [d0.w, d0.h];
  const made = [];
  for (const [label, w] of Object.entries(WIDTHS)) {
    // never upscale — enlarging a 600px source to 1200px just blurs it and
    // triples the file size for no visible gain
    const target = w0 && w0 < w ? w0 : w;
    const dest = join(OUT, `${stem}-${label}.webp`);
    execFileSync('cwebp', ['-q', String(QUALITY), '-resize', String(target), '0', '-m', '6', readable, '-o', dest], { stdio: 'pipe' });
    made.push(dest);
  }
  if (w0 && w0 < WIDTHS.full) lowRes.push({ file: basename(src), width: w0 });
  return made;
}

const lowRes = [];

const assigned = new Map();   // slug -> { file, stem }  (stem is what encode() actually wrote)
const unmatched = [];
const ambiguous = [];
const catFallbacks = new Map(); // category -> [stem,...]

for (const f of files) {
  const stem = norm(basename(f, extname(f)));
  const src = join(IN, f);

  // 1. exact product slug
  if (bySlug.has(stem)) {
    encode(src, stem);
    assigned.set(stem, { file: f, stem });
    continue;
  }

  // 2. full product name (spacing/case ignored)
  if (byTheme.has(stem)) {
    encode(src, `theme-${stem}`);
    for (const p of byTheme.get(stem)) assigned.set(p.slug, { file: f, stem: `theme-${stem}` });
    continue;
  }

  // 3. source filename -> listing (uses the folder name to disambiguate)
  const base = basename(f);
  const hits = PAIR.map[base] || [];
  const folder = f.includes('/') ? f.split('/')[0] : null;
  const narrowed = folder ? hits.filter((h) => h.category === folder) : hits;
  const uniq = [...new Map((narrowed.length ? narrowed : hits).map((h) => [h.slug, h])).values()];
  if (uniq.length === 1) {
    encode(src, uniq[0].slug);
    assigned.set(uniq[0].slug, { file: f, stem: uniq[0].slug });
    continue;
  }
  if (uniq.length > 1) {
    ambiguous.push({ file: f, options: uniq.map((h) => `${h.category}/${h.name}`) });
    continue;
  }

  // 4. category fallback (kids-birthday, kids-birthday-2, ...)
  const catMatch = stem.replace(/-\d+$/, '');
  if (catSlugs.has(catMatch)) {
    encode(src, `cat-${stem}`);
    if (!catFallbacks.has(catMatch)) catFallbacks.set(catMatch, []);
    catFallbacks.get(catMatch).push(`cat-${stem}`);
    continue;
  }

  unmatched.push(f);
}

// persist the map the catalogue builder reads.
// The stem is whatever encode() actually wrote — reconstructing it here from
// the product name silently pointed every pairing-matched image at a file
// that does not exist.
const map = { products: {}, categories: Object.fromEntries(catFallbacks), ratios };
for (const [slug, rec] of assigned) map.products[slug] = rec.stem;

writeFileSync(join(ROOT, 'data/image-map.json'), JSON.stringify(map, null, 2));
rmSync(TMP, { recursive: true, force: true });

/* ---------------- report ---------------- */
const covered = products.filter((p) => map.products[p.slug] || catFallbacks.has(p.category)).length;
console.log(`\n✓ processed ${files.length} file(s) → ${OUT.replace(ROOT + '/', '')}/`);
console.log(`  ${Object.keys(map.products).length} product(s) with their own photo`);
console.log(`  ${catFallbacks.size} category fallback set(s): ${[...catFallbacks.keys()].join(', ') || '—'}`);
console.log(`  ${covered}/${products.length} products now show a real photo\n`);

if (lowRes.length) {
  console.log(`ℹ ${lowRes.length} image(s) below ${WIDTHS.full}px wide — shown at source size rather than upscaled:`);
  lowRes.slice(0, 6).forEach((x) => console.log(`    ${x.file} (${x.width}px)`));
  if (lowRes.length > 6) console.log(`    …and ${lowRes.length - 6} more`);
  console.log('');
}

if (ambiguous.length) {
  console.log(`⚠ ${ambiguous.length} file(s) match more than one listing — NOT used:`);
  ambiguous.slice(0, 8).forEach((a) => {
    console.log(`    ${a.file}  ->  ${a.options.slice(0, 3).join('  |  ')}${a.options.length > 3 ? ' …' : ''}`);
  });
  console.log(`  Put these in a category subfolder to disambiguate, e.g. images/incoming/wedding/${basename(ambiguous[0].file)}`);
  console.log('');
}

if (unmatched.length) {
  console.log(`⚠ ${unmatched.length} file(s) matched no product or category — NOT used:`);
  unmatched.forEach((f) => console.log(`    ${f}`));
  console.log(`  Rename using FILENAMES.csv, or use a category slug. Valid categories:`);
  console.log(`    ${[...catSlugs].join(', ')}\n`);
}

const bare = products.filter((p) => !map.products[p.slug] && !catFallbacks.has(p.category));
if (bare.length) {
  const byCat = {};
  bare.forEach((p) => { byCat[p.category] = (byCat[p.category] || 0) + 1; });
  console.log(`Still on placeholders (${bare.length}):`);
  Object.entries(byCat).forEach(([c, n]) => console.log(`    ${c.padEnd(22)} ${n}`));
  console.log('');
}

console.log(`Next: node scripts/build-catalog.mjs\n`);
