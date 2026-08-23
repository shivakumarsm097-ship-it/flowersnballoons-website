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
import { writeFileSync } from 'node:fs';
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
const seen = new Set();

for (const cat of CATS) {
  for (let page = 1; page <= 12; page++) {
    const url = `${BASE}/service-category/${cat}/${page > 1 ? `page/${page}/` : ''}`;
    let html;
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (!res.ok) break;
      html = await res.text();
    } catch { break; }

    const rows = parse(html, cat);
    if (!rows.length) break;
    let added = 0;
    for (const r of rows) {
      if (!r.name || seen.has(r.name) || !r.price) continue;
      seen.add(r.name);
      all.push(r);
      added++;
    }
    process.stderr.write(`  ${cat} p${page}: +${added} (total ${all.length})\n`);
    if (rows.length < 60) break;
    await sleep(400); // be polite
  }
}

const byCat = {};
all.forEach((r) => { byCat[r.cat] = (byCat[r.cat] || 0) + 1; });
writeFileSync(join(ROOT, 'data/harvested.json'), JSON.stringify({ count: all.length, byCat, products: all }, null, 2));

const p = all.map((r) => r.price);
process.stderr.write(`\n✓ ${all.length} products → data/harvested.json\n`);
process.stderr.write(`  ₹${Math.min(...p).toLocaleString('en-IN')} – ₹${Math.max(...p).toLocaleString('en-IN')}\n`);
Object.entries(byCat).forEach(([c, n]) => process.stderr.write(`  ${c.padEnd(24)}${n}\n`));
