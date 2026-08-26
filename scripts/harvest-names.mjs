#!/usr/bin/env node
/**
 * Harvest product NAMES + PRICES + CATEGORY only.
 *
 * Deliberately does NOT take images or descriptions — those are the platform's
 * copyrighted work. Short descriptive product titles and price points are not
 * meaningfully protectable, which is why this is limited to those two fields.
 *
 *   node scripts/harvest-names.mjs > /dev/null   (writes data/harvested.json)
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://www.eventzfly.com';

const CATS = [
  // full category list enumerated from the source site (42 paths)
  'kids-birthday', 'kids-birthday-simple-home-decor', 'kids-birthday-fun-activities',
  'kids-birthday-fun-eats', 'kids-birthday-photography', 'boy-themes', 'girl-themes', 'kids-offer',
  'birthday', 'baby-shower', 'baby-shower-catering', 'baby-shower-photography',
  'naming-ceremony', 'naming-ceremony-catering', 'naming-ceremony-photography',
  'house-warming', 'house-warming-catering', 'house-warming-photography', 'house-lighting',
  'engagement', 'engagement-catering', 'engagement-photography',
  'haldi', 'haldi-catering', 'haldi-photography',
  'wedding', 'wedding-catering', 'wedding-photography',
  'anniversary', 'corporate', 'corporate-photography', 'surprise-events', 'bachelorette',
  'annaprasan', 'annaprasan-catering', 'annaprasan-photography',
  'upanayanam', 'upanayanam-catering', 'upanayanam-photography',
  'first-holy-communion', 'first-holy-communion-photography', 'shamyana-items',
];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** WordPress encodes & as &#038;, apostrophes as &#8217; etc. Decode all of it,
 *  otherwise raw entities show up in product titles on the page. */
const decode = (t) => t.trim()
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

/** pull <name, salePrice, regularPrice> out of a WooCommerce listing page */
function parse(html, cat) {
  const out = [];
  // each card starts at class="...product-grid-item..." ; split on it
  const chunks = html.split(/class="[^"]*product-grid-item/).slice(1);
  for (const ch of chunks) {
    const name = ch.match(/wd-entities-title[^>]*>\s*<a[^>]*>([^<]+)</)?.[1]
      || ch.match(/<h3[^>]*class="[^"]*wd-entities-title[^"]*"[^>]*>\s*<a[^>]*>([^<]+)</)?.[1];
    if (!name) continue;
    // The rupee sign ships as the entity &#8377; INSIDE <bdi>. Matching digits
    // straight after <bdi> captures "8377" for every product — strip the
    // currency spans (and any stray entity) before reading numbers.
    const block = (ch.match(/<span class="price">([\s\S]*?)<\/span>\s*<\/div>/)?.[1] || ch.slice(0, 3000))
      .replace(/<span class="woocommerce-Price-currencySymbol">[\s\S]*?<\/span>/g, '')
      .replace(/&#8377;|₹|&nbsp;/g, '');

    const amount = (frag) => {
      const m = frag && frag.match(/<bdi>\s*([\d,]+)/);
      return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
    };
    const sale = amount(block.match(/<ins[^>]*>([\s\S]*?)<\/ins>/)?.[1]);
    const was = amount(block.match(/<del[^>]*>([\s\S]*?)<\/del>/)?.[1]);
    const plain = amount(block);

    out.push({
      name: decode(name),
      price: sale ?? plain,
      compareAt: sale ? was : null,
      cat,
    });
  }
  return out;
}

const all = [];
/* Keyed on category+name, NOT name alone. The source lists the same service
   under several occasions at DIFFERENT prices — 4K Cinematic Videography is
   ₹12,980 for a kids birthday and ₹9,980 for a wedding. Deduping on name let
   whichever category came first in CATS claim the name and silently discard
   every other category's copy along with its price: 65 listings and 7 whole
   categories never made it into the catalogue. */
const seen = new Set();
const key = (r) => `${r.cat}|${r.name}`;

/** Fetch with retries. A bare `break` on a failed request silently truncates a
 *  whole category — that is how 7 categories went missing last time. Retry,
 *  then record the failure so the run can refuse to write a short harvest. */
const failures = [];
async function get(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (res.status === 404) return null;              // genuinely no such page
      if (res.ok) return await res.text();
      if (attempt === 4) { failures.push(`${url} -> HTTP ${res.status}`); return undefined; }
    } catch (e) {
      if (attempt === 4) { failures.push(`${url} -> ${e.message}`); return undefined; }
    }
    await sleep(1200 * attempt);                        // back off before retrying
  }
}

for (const cat of CATS) {
  for (let page = 1; page <= 12; page++) {
    const url = `${BASE}/service-category/${cat}/${page > 1 ? `page/${page}/` : ''}`;
    const html = await get(url);
    if (html === null) break;                           // 404: end of pagination
    if (html === undefined) break;                      // gave up; already recorded

    const rows = parse(html, cat);
    if (!rows.length) break;
    let added = 0;
    for (const r of rows) {
      if (!r.name || seen.has(key(r)) || !r.price) continue;
      seen.add(key(r));
      all.push(r);
      added++;
    }
    process.stderr.write(`  ${cat} p${page}: +${added} (total ${all.length})\n`);
    if (rows.length < 60) break;
    await sleep(400); // be polite
  }
}

if (failures.length) {
  console.error(`\nREFUSING TO WRITE — ${failures.length} request(s) failed after retries:`);
  failures.forEach((f) => console.error('  ' + f));
  console.error('A partial harvest would silently delete listings. Re-run.');
  process.exit(1);
}

const byCat = {};
all.forEach((r) => { byCat[r.cat] = (byCat[r.cat] || 0) + 1; });

/* A soft failure — HTTP 200 with an empty grid — throws no error and would
   quietly shrink the catalogue. Compare against the harvest already on disk
   and refuse to overwrite it with anything smaller. */
try {
  const prev = JSON.parse(readFileSync(join(ROOT, 'data/harvested.json'), 'utf8'));
  const shrunk = Object.entries(prev.byCat || {})
    .filter(([c, n]) => (byCat[c] || 0) < n)
    .map(([c, n]) => `  ${c}: ${n} -> ${byCat[c] || 0}`);
  if (shrunk.length) {
    console.error(`\nREFUSING TO WRITE — ${shrunk.length} categor(y/ies) came back smaller:`);
    shrunk.forEach((l) => console.error(l));
    console.error('Existing harvest left untouched. Re-run.');
    process.exit(1);
  }
} catch { /* no previous harvest — first run */ }
writeFileSync(join(ROOT, 'data/harvested.json'), JSON.stringify({ count: all.length, byCat, products: all }, null, 2));

const p = all.map((r) => r.price);
process.stderr.write(`\n✓ ${all.length} products → data/harvested.json\n`);
process.stderr.write(`  ₹${Math.min(...p).toLocaleString('en-IN')} – ₹${Math.max(...p).toLocaleString('en-IN')}\n`);
Object.entries(byCat).forEach(([c, n]) => process.stderr.write(`  ${c.padEnd(24)}${n}\n`));
