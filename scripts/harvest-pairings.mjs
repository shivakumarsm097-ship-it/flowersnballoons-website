#!/usr/bin/env node
/**
 * Harvest product -> image-filename pairings from the source category pages.
 *
 * This takes NO image data — only the mapping between a listing and the
 * filename its photo uses. That mapping is what makes supplied images
 * self-filing: drop in "12-1.png" and it lands on the right listing instead
 * of being guessed at from appearance (which failed on 16 of 19 attempts).
 *
 *   node scripts/harvest-pairings.mjs      -> data/source-filenames.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://www.eventzfly.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const products = JSON.parse(readFileSync(join(ROOT, 'data/products.json'), 'utf8')).products;
const byName = new Map(products.map((p) => [p.name, p]));
const cats = [...new Set(products.map((p) => p.category))];

const dec = (t) => t.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

const map = {};          // filename -> [{slug, category}]
let paired = 0, pages = 0;

for (const cat of cats) {
  for (let page = 1; page <= 12; page++) {
    const url = `${BASE}/service-category/${cat}/${page > 1 ? `page/${page}/` : ''}`;
    let html;
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (!res.ok) break;
      html = await res.text();
    } catch { break; }
    pages++;

    const chunks = html.split(/class="[^"]*product-grid-item/).slice(1);
    if (!chunks.length) break;

    for (const ch of chunks) {
      const raw = ch.match(/wd-entities-title[^>]*>\s*<a[^>]*>([^<]+)</)?.[1];
      const img = ch.match(/<img[^>]+src="([^"]+\.(?:png|jpe?g|webp))"/i)?.[1];
      if (!raw || !img) continue;
      const p = byName.get(dec(raw));
      if (!p) continue;
      // strip the WordPress size suffix: foo-430x287.png -> foo.png
      const file = img.split('/').pop().replace(/-\d+x\d+(\.\w+)$/, '$1');
      (map[file] ||= []).push({ slug: p.slug, category: p.category, name: p.name });
      paired++;
    }
    if (chunks.length < 60) break;
    await sleep(350);
  }
  process.stderr.write(`  ${cat.padEnd(34)} ${paired} pairings so far\n`);
}

const ambiguous = Object.entries(map).filter(([, v]) => new Set(v.map(x => x.slug)).size > 1);
writeFileSync(join(ROOT, 'data/source-filenames.json'),
  JSON.stringify({ pairs: paired, files: Object.keys(map).length, ambiguous: ambiguous.length, map }, null, 2));

process.stderr.write(`\n✓ ${paired} pairings across ${pages} pages -> data/source-filenames.json\n`);
process.stderr.write(`  ${Object.keys(map).length} distinct filenames\n`);
process.stderr.write(`  ${ambiguous.length} filename(s) used by more than one listing (need disambiguating by folder)\n`);
