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

// lookup tables
const bySlug = new Map(products.map((p) => [p.slug, p]));
const byTheme = new Map();
for (const p of products) {
  const t = norm(p.name);
  if (!byTheme.has(t)) byTheme.set(t, []);
  byTheme.get(t).push(p);
}
const catSlugs = new Set(categories.map((c) => c.slug));

const files = readdirSync(IN).filter((f) => !f.startsWith('.') && /\.(jpe?g|png|webp|heic|heif)$/i.test(f));

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

function srcWidth(f) {
  try {
    const out = execFileSync('sips', ['-g', 'pixelWidth', f], { encoding: 'utf8' });
    return parseInt(out.match(/pixelWidth:\s*(\d+)/)?.[1] || '0', 10);
  } catch { return 0; }
}

function encode(src, stem) {
  const readable = toReadable(src);
  const w0 = srcWidth(readable);
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

const assigned = new Map();   // stem -> source filename
const unmatched = [];
const catFallbacks = new Map(); // category -> [stem,...]

for (const f of files) {
  const stem = norm(basename(f, extname(f)));
  const src = join(IN, f);

  // 1. exact product slug
  if (bySlug.has(stem)) {
    encode(src, stem);
    assigned.set(stem, f);
    continue;
  }

  // 2. full product name (spacing/case ignored)
  if (byTheme.has(stem)) {
    encode(src, `theme-${stem}`);
    for (const p of byTheme.get(stem)) assigned.set(p.slug, f);
    continue;
  }

  // 3. category fallback (kids-birthday, kids-birthday-2, ...)
  const catMatch = stem.replace(/-\d+$/, '');
  if (catSlugs.has(catMatch)) {
    encode(src, `cat-${stem}`);
    if (!catFallbacks.has(catMatch)) catFallbacks.set(catMatch, []);
    catFallbacks.get(catMatch).push(`cat-${stem}`);
    continue;
  }

  unmatched.push(f);
}

// persist the map the catalogue builder reads
const themeStems = new Set();
for (const f of files) {
  const stem = norm(basename(f, extname(f)));
  if (byTheme.has(stem)) themeStems.add(stem);
}
const map = { products: {}, categories: Object.fromEntries(catFallbacks) };
for (const p of products) {
  if (assigned.has(p.slug)) {
    const stem = bySlug.has(norm(assigned.get(p.slug).replace(/\.[^.]+$/, ''))) ? p.slug : null;
    map.products[p.slug] = stem || `theme-${norm(p.name)}`;
  }
}
// exact-slug files win over theme files
for (const f of files) {
  const stem = norm(basename(f, extname(f)));
  if (bySlug.has(stem)) map.products[stem] = stem;
}

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
