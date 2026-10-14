#!/usr/bin/env node
/**
 * Catalogue builder.
 *
 *   node scripts/build-catalog.mjs
 *
 * Reads  data/components.json + data/catalog-spec.json
 * Writes data/products.json          (computed catalogue, single source of truth)
 *        shop/index.html             (all categories)
 *        shop/<category>/index.html  (category listing)
 *        shop/<category>/<slug>.html (product page)
 *
 * Prices are always derived: sum(component cost) * margin, rounded.
 * Nobody types a price. Change a cost in components.json, re-run, done.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { describe, cardColors, inclusionsFor } from './describe.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const HARV = read('data/harvested.json');

/* Exact old-name -> new-name pairs from scripts/generic-names.mjs. Only
   generically-named listings appear there; ones named after a character or
   franchise keep their source name because that is the search term. Products
   keep sourceName/sourceSlug either way, so image pairings survive a rename. */
let RENAME = { names: {} };
try { RENAME = read('data/rename-rules.json'); } catch { /* optional */ }

const NAME_MAP = new Map(Object.entries(RENAME.names || {}));

function renameProduct(name) {
  return (NAME_MAP.get(name) || name).replace(/\s+/g, ' ').trim();
}

/* Content hash on stylesheet URLs. Without it, returning visitors keep a
   cached stylesheet after a deploy and see the old design against new markup. */
const cssVer = (f) => createHash('sha1').update(readFileSync(join(ROOT, f))).digest('hex').slice(0, 8);
const V_REFINED = cssVer('css/refined.css');
const V_SHOP = cssVer('css/shop.css');

// written by scripts/import-images.mjs; absent until photos are imported
/* hand-written from the product photo; overrides name-inferred copy */
let CURATED = { products: {} };
try { CURATED = read('data/curated.json'); } catch { /* optional */ }

let IMG = { products: {}, categories: {} };
try { IMG = read('data/image-map.json'); } catch { /* no photos yet */ }

const PHONE = '+918867121207';
const PHONE_H = '+91 88671 21207';
const inr = (n) => '₹' + n.toLocaleString('en-IN');
const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Photo resolution, in order of honesty. Fallbacks are labelled, never passed
 *  off as the specific setup. */
/* image-map.json and curated.json are keyed by slug, and a rename changes the
   slug. Fall back to sourceSlug so renaming a listing never orphans its photo
   or its hand-written copy. */
const bySlugOrSource = (table, p) => table[p.slug] || table[p.sourceSlug] || undefined;

/* Category header images, generated rather than photographed. They are
   atmosphere for a category page; on a listing they appear only as a clearly
   labelled illustration, never passed off as a photograph of a setup we built. */
const CATEGORY_ART = new Set(['annaprasan', 'anniversary', 'baby-shower', 'baby-shower-photography', 'bachelorette', 'birthday', 'engagement', 'engagement-photography', 'first-holy-communion', 'first-holy-communion-photography', 'haldi', 'haldi-photography', 'house-lighting', 'house-warming', 'house-warming-photography', 'kids-birthday', 'kids-birthday-fun-activities', 'kids-birthday-fun-eats', 'kids-birthday-photography', 'kids-birthday-simple-home-decor', 'naming-ceremony', 'naming-ceremony-photography', 'shamyana-items', 'surprise-events', 'upanayanam', 'wedding', 'wedding-photography']);
const categoryArt = (slug) => (CATEGORY_ART.has(slug) ? 'images/categories/' + slug + '.webp' : null);

function photoFor(p) {
  const own = bySlugOrSource(IMG.products, p);
  if (own) return { stem: own, exact: true };
  const pool = IMG.categories[p.category];
  if (pool && pool.length) return { stem: pool[Math.abs(hash(p.slug)) % pool.length], exact: false };
  return null;
}
/** real pixel ratio of the photo, so the page never crops or stretches it */
function ratioStyle(p) {
  const ph = photoFor(p);
  const r = ph && IMG.ratios && IMG.ratios[ph.stem];
  if (r) return ` style="aspect-ratio:${r[0]}/${r[1]}"`;
  // the generated category art is 16:9; without this the media box collapses
  // and the disclaimer under it rides up over the image
  if (!ph && categoryArt(p.category)) return ' style="aspect-ratio:1376/768"';
  return '';
}
function media(p, depth, size, cls = 'prod-ph') {
  const ph = photoFor(p);
  if (!ph) {
    // Only on the product page. In a grid every listing in a category would
    // show the same picture twenty times over, which reads worse than the
    // per-product gradient cards and buries the real photos we do have.
    const art = size === 'full' ? categoryArt(p.category) : null;
    if (art) {
      return `<img src="${depth}${art}" alt="Illustration of ${esc(p.categoryName.toLowerCase())} decoration" loading="lazy" width="1376" height="768">`
        + `<span class="ph-tag ph-tag-art">Illustration</span>`;
    }
    return `<div class="${cls}" style="--c1:${p.c1};--c2:${p.c2}" aria-hidden="true"><span>${esc(p.name)}</span></div>`;
  }
  const alt = ph.exact ? `${esc(p.name)} by Flowers N Balloons`
                       : `Example of our ${esc(p.categoryName.toLowerCase())} decoration work`;
  return `<img src="${depth}images/products/${ph.stem}-${size}.webp" alt="${alt}" loading="lazy" width="${size === 'full' ? 1200 : 600}" height="${size === 'full' ? 900 : 450}">`
    + (ph.exact ? '' : `<span class="ph-tag">Representative photo</span>`);
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
const hasExactPhoto = (p) => !!bySlugOrSource(IMG.products, p);

const ADVANCE_PCT = 0.30;

const CATMETA = {
  'kids-birthday':       ['Kids Birthday', "Themed setups built around what your child actually loves — backdrop, arch, cutouts and a cake table that photographs well."],
  'birthday':            ['Adult Birthday', 'Grown-up palettes and cleaner lines, for milestone birthdays, surprise parties and terrace celebrations.'],
  'baby-shower':         ['Baby Shower', 'Soft-palette backdrops, balloon clouds and dessert-table styling for the photos everyone will want.'],
  'naming-ceremony':     ['Naming Ceremony', 'Traditional touches with a modern finish — cradle decoration, name boards and warm floral work.'],
  'house-warming':       ['Housewarming', 'Entrance rangoli, torans and pooja-area styling to welcome everyone into the new home.'],
  'engagement':          ['Engagement', 'Ring-ceremony stages, floral arches and lighting designed to photograph well from every angle.'],
  'haldi':               ['Haldi Ceremony', 'Bright daytime setups — marigold work, seating, umbrellas and colour-forward backdrops.'],
  'wedding':             ['Wedding', 'Stage and mandap design, entrance styling, fresh-flower work and lighting, scaled to your venue.'],
  'anniversary':         ['Anniversary', 'Candlelight, florals and quiet detail for anniversaries and romantic evenings.'],
  'corporate':           ['Corporate', 'Branded stages, launch setups and entrance styling for office celebrations and store openings.'],
  'surprise-events':     ['Surprise Parties', 'Quick-turnaround setups for proposals, homecomings and surprise celebrations.'],
  'bachelorette':        ['Bachelorette', 'Bold, playful setups for the send-off before the wedding.'],
  'annaprasan':          ['Annaprasan', 'First-rice ceremony decoration — traditional detail, gentle palettes and a styled seating area.'],
  'upanayanam':          ['Upanayanam', 'Thread-ceremony decoration with traditional floral and mandap work.'],
  'first-holy-communion':['First Holy Communion', 'Calm, elegant white-and-gold setups for the communion celebration.'],
  'kids-birthday-simple-home-decor': ['Simple Home Decor', 'Smaller, budget-friendly setups designed for a living room or balcony rather than a hall.'],
  'kids-birthday-fun-activities': ['Party Activities', 'Entertainment and activity add-ons — the things that keep children busy once the photos are done.'],
  'kids-birthday-fun-eats': ['Party Food & Treats', 'Food counters and treat stations that double as part of the decor.'],
  'kids-birthday-photography': ['Party Photography', 'Photography and video coverage, booked alongside the decoration so there is one point of contact.'],
  'baby-shower-photography': ['Baby Shower Photography', 'Coverage for the shower, arranged together with the decor.'],
  'naming-ceremony-photography': ['Naming Ceremony Photography', 'Coverage for the naming and cradle ceremony, booked alongside the decoration.'],
  'house-warming-photography': ['Housewarming Photography', 'Photography and video for griha pravesh, arranged with the decor.'],
  'engagement-photography': ['Engagement Photography', 'Coverage for the ring ceremony and reception, on the same booking as the decor.'],
  'haldi-photography':      ['Haldi Photography', 'Daytime coverage for the haldi function, booked together with the setup.'],
  'wedding-photography':    ['Wedding Photography', 'Photography and video for the wedding and reception, arranged alongside the decoration.'],
  'first-holy-communion-photography': ['Communion Photography', 'Coverage for the communion service and the celebration after it.'],
  'house-lighting':         ['House Lighting', 'Exterior and interior lighting for festivals, housewarmings and celebrations.'],
  'shamyana-items': ['Shamiana & Tent Items', 'Tenting, seating, canopies and the structural pieces an outdoor function needs.'],
};

/** Scale description derived from the price band — never invents a specific
 *  item count, because every inclusion listed is a delivery promise. */
function scaleOf(price) {
  if (price < 3000)  return ['Compact', 'A small, focused setup — ideal for a home celebration or a single feature wall.'];
  if (price < 8000)  return ['Standard', 'A full backdrop or ring setup with balloon work, sized for a typical home or hall celebration.'];
  if (price < 18000) return ['Large', 'A larger installation with layered balloon work, themed elements and props.'];
  if (price < 35000) return ['Premium', 'A full-wall treatment with extensive balloon and themed work, lighting and styled table.'];
  return ['Grand', 'Our largest format — full-venue treatment with premium materials, lighting and a dedicated setup team.'];
}

/* ---------------- build products from harvested data ---------------- */
const products = [];
const usedSlugs = new Map();   // slug -> category of the listing holding it
let n = 0;

for (const r of HARV.products) {
  const meta = CATMETA[r.cat];
  if (!meta) continue;
  const displayName = renameProduct(r.name);
  /* The same service is sold under several occasions at different prices, so
     names repeat across categories. Disambiguate with the occasion, not a
     counter: `n` doubles as the SKU sequence, so a counter suffix produced
     URLs like `4k-cinematic-videography-748` that moved on every rebuild.
     Slugs stay globally unique because image-map.json and curated.json are
     keyed by slug alone. */
  const base = slugify(displayName);
  let slug = base;
  if (usedSlugs.has(slug)) {
    // A clash across categories means the same service sold for a different
    // occasion — say which. A clash inside one category means two variants that
    // differ only in scale, where the occasion tells the buyer nothing and the
    // price does. Both are stable across rebuilds; a counter was not.
    slug = usedSlugs.get(base) === r.cat
      ? `${base}-${r.price}`
      : `${base}-${r.cat.replace(/-(photography|catering)$/, '')}`;
    let dup = 1;
    const attempt = slug;
    while (usedSlugs.has(slug)) slug = `${attempt}-${++dup}`;
  }
  usedSlugs.set(slug, r.cat);
  if (!usedSlugs.has(base)) usedSlugs.set(base, r.cat);
  const [scale, scaleBlurb] = scaleOf(r.price);
  products.push({
    sku: `FNB-${r.cat.slice(0, 2).toUpperCase()}-${String(++n).padStart(4, '0')}`,
    name: displayName,
    sourceName: r.name,
    sourceSlug: slugify(r.name),
    slug,
    category: r.cat,
    categoryName: meta[0],
    tier: scale,
    tierBlurb: scaleBlurb,
    price: r.price,
    compareAt: r.compareAt && r.compareAt > r.price ? r.compareAt : null,
    advance: Math.max(500, Math.round((r.price * ADVANCE_PCT) / 100) * 100),
  });
}

for (const p of products) { const c = cardColors(p); p.c1 = c[0]; p.c2 = c[1]; p.inclusions = inclusionsFor(p); const d = describe(p); p.description = d.body; p.metaDescription = d.meta;
  const cur = bySlugOrSource(CURATED.products, p);
  if (cur) { if (cur.description) p.description = cur.description; if (cur.inclusions) p.inclusions = cur.inclusions; p.curated = true; } p.form = d.form; p.palette = d.palette; p.motif = d.motif; }

const CATEGORIES = Object.entries(CATMETA)
  .filter(([slug]) => products.some((p) => p.category === slug))
  .map(([slug, m]) => ({ slug, name: m[0], intro: m[1] }));

writeFileSync(
  join(ROOT, 'data/products.json'),
  JSON.stringify({ generatedFrom: 'harvested.json', count: products.length, categories: CATEGORIES, products }, null, 2)
);

/* ---------------- shared page chrome ---------------- */
const SITE = 'https://www.flowersnballoons.com';

/* Coverage, hire and lighting are not "decoration setups" and are not chosen by
   "theme". Calling a videographer a setup reads as copy nobody proofread. */
const SERVICE_CATS = new Set([
  'shamyana-items', 'kids-birthday-fun-activities', 'kids-birthday-fun-eats',
  'house-lighting',
]);
const isService = (slug) => SERVICE_CATS.has(slug) || slug.endsWith('-photography');
const unitOf = (slug) => (isService(slug) ? 'option' : 'setup');

/* The source sells the same service under several occasions. Where those copies
   carry the SAME price they are genuinely one product on two URLs, and left
   uncanonicalised they compete with each other in search. Point every copy at
   the first one. Copies priced differently are distinct offers and each keeps
   its own canonical. */
const canonicalOf = new Map();
{
  const primary = new Map();
  for (const p of products) {
    const k = `${p.sourceName.toLowerCase().trim()}|${p.price}`;
    if (!primary.has(k)) primary.set(k, p);
    canonicalOf.set(p, primary.get(k));
  }
}
const canonUrl = (p) => {
  const c = canonicalOf.get(p) || p;
  return `/shop/${c.category}/${c.slug}.html`;
};

const head = (title, desc, depth, extra = '', canonical = '') => `<!DOCTYPE html>
<html lang="en-IN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${canonical ? `<link rel="canonical" href="${SITE}${canonical}">` : ''}
<link rel="icon" href="${depth}images/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" media="print" onload="this.media='all'">
<link rel="stylesheet" href="${depth}css/refined.css?v=${V_REFINED}">
<link rel="stylesheet" href="${depth}css/shop.css?v=${V_SHOP}">
${extra}
</head>
<body>`;

const header = (depth) => `
<header class="header" role="banner">
  <div class="shell header-inner">
    <a class="logo" href="${depth}index.html" aria-label="Flowers N Balloons — home">
      <img src="${depth}images/logo.svg" alt="" width="38" height="38">
      <span class="logo-text"><span class="logo-name">Flowers 'N' Balloons</span><span class="logo-sub">Bengaluru</span></span>
    </a>
    <nav class="nav" aria-label="Primary">
      <a href="${depth}shop/index.html">Shop</a>
      <a href="${depth}index.html#how">How it works</a>
      <a href="${depth}index.html#faq">FAQ</a>
      <a href="${depth}index.html#enquire">Contact</a>
    </nav>
    <div class="header-actions">
      <a class="btn btn-ghost btn-sm" href="tel:${PHONE}">${PHONE_H}</a>
      <a class="btn btn-primary btn-sm js-cart-open" href="#cart">Cart <span class="cart-count">0</span></a>
    </div>
    <button class="hamburger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-nav"><span></span><span></span><span></span></button>
  </div>
  <nav class="mobile-nav" id="mobile-nav" aria-label="Mobile">
    <a href="${depth}shop/index.html">Shop</a>
    <a href="${depth}index.html#how">How it works</a>
    <a href="${depth}index.html#faq">FAQ</a>
    <a href="${depth}index.html#enquire">Contact</a>
    <a class="btn btn-primary btn-block js-cart-open" href="#cart">View cart (<span class="cart-count">0</span>)</a>
  </nav>
</header>`;

const footer = (depth) => `
<footer class="footer" role="contentinfo">
  <div class="shell">
    <div class="footer-grid">
      <div class="footer-brand">
        <a class="logo" href="${depth}index.html">
          <img src="${depth}images/logo.svg" alt="" width="38" height="38" loading="lazy">
          <span class="logo-text"><span class="logo-name">Flowers 'N' Balloons</span><span class="logo-sub">Bengaluru</span></span>
        </a>
        <p>Decoration across Bengaluru. Every price on this site is a starting point for that setup — your final quote is confirmed in writing.</p>
      </div>
      <div class="footer-col"><h4>Shop</h4><ul>
        ${CATEGORIES.slice(0, 5).map((c) => `<li><a href="${depth}shop/${c.slug}/index.html">${esc(c.name)}</a></li>`).join('\n        ')}
      </ul></div>
      <div class="footer-col"><h4>More</h4><ul>
        ${CATEGORIES.slice(5).map((c) => `<li><a href="${depth}shop/${c.slug}/index.html">${esc(c.name)}</a></li>`).join('\n        ')}
      </ul></div>
      <div class="footer-col"><h4>Get in touch</h4><ul>
        <li><a href="tel:${PHONE}">${PHONE_H}</a></li>
        <li><a href="https://wa.me/918867121207" target="_blank" rel="noopener">WhatsApp enquiry</a></li>
        <li><a href="${depth}index.html#enquire">Request a quote</a></li>
        <li><a href="${depth}privacy-policy.html">Privacy policy</a></li>
      </ul></div>
    </div>
    <div class="footer-bottom">
      <span>© 2026 Flowers 'N' Balloons, Bengaluru.</span>
      <span>Prices cover the listed inclusions. Travel beyond 12&nbsp;km may be charged extra.</span>
    </div>
  </div>
</footer>
<div class="float-actions">
  <a class="float-btn float-wa" href="https://wa.me/918867121207" target="_blank" rel="noopener" aria-label="Chat on WhatsApp"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.1-.7.1s-.7 1-.9 1.2c-.2.2-.3.2-.6.1-1.7-.9-2.9-1.6-4-3.6-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5s-.7-1.6-.9-2.2c-.2-.5-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1.1 2.8 1.2 3c.1.2 2.1 3.2 5 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.7-.7 1.9-1.3.2-.7.2-1.2.2-1.3-.1-.2-.3-.3-.6-.4M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2"/></svg></a>
  <a class="float-btn float-call" href="tel:${PHONE}" aria-label="Call us"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg></a>
</div>
<div class="cart-drawer" id="cart" aria-hidden="true">
  <div class="cart-panel" role="dialog" aria-label="Your cart">
    <div class="cart-head"><h3>Your setup</h3><button class="cart-close" type="button" aria-label="Close cart">&times;</button></div>
    <div class="cart-items"></div>
    <div class="cart-foot">
      <div class="cart-total"><span>Total</span><b class="cart-total-amt">₹0</b></div>
      <p class="cart-note">Next step checks your date is free before any payment.</p>
      <a class="btn btn-primary btn-block js-checkout" href="${depth}shop/checkout.html">Check date &amp; continue</a>
    </div>
  </div>
</div>
<script src="${depth}js/main.min.js" defer></script>
<script src="${depth}js/shop.js" defer></script>
</body>
</html>`;

const card = (p, depth, i = 0) => `
<a class="prod-card reveal" href="${depth}shop/${p.category}/${p.slug}.html" data-tier="${esc(p.tier)}" data-theme="${esc(p.name.toLowerCase())}" data-price="${p.price}" style="--c1:${p.c1};--c2:${p.c2};--i:${i % 12}">
  <div class="prod-media">
    ${media(p, depth, 'card')}
    ${p.compareAt ? `<span class="prod-off">-${Math.round((1 - p.price / p.compareAt) * 100)}%</span>` : ''}
  </div>
  <div class="prod-body">
    <span class="prod-tier">${esc(p.tier)}</span>
    <h3>${esc(p.name)}</h3>
    <p class="prod-incl">${esc(p.categoryName)}</p>
    <div class="prod-price">
      ${p.compareAt ? `<s>${inr(p.compareAt)}</s>` : ''}
      <b>${inr(p.price)}</b>
    </div>
  </div>
</a>`;

/* ---------------- write pages ---------------- */
const shopDir = join(ROOT, 'shop');
if (existsSync(shopDir)) rmSync(shopDir, { recursive: true });
mkdirSync(shopDir, { recursive: true });

// shop index
const catCards = CATEGORIES.map((c) => {
  const items = products.filter((p) => p.category === c.slug);
  return `
  <a class="occ-card reveal" href="${c.slug}/index.html">
    <div class="occ-media"><div class="prod-ph" aria-hidden="true">${esc(c.name)}</div></div>
    <div class="occ-body">
      <h3>${esc(c.name)}</h3>
      <p>${esc(c.intro)}</p>
      <span class="occ-link">${items.length} ${unitOf(c.slug)}s
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </span>
    </div>
  </a>`;
}).join('');

writeFileSync(join(shopDir, 'index.html'), `${head(
  `Shop Decoration Setups in Bangalore | Flowers N Balloons`,
  `Browse ${products.length} decoration setups with prices and full inclusions. Birthday, baby shower, haldi, housewarming and corporate decor in Bengaluru.`,
  '../',
    '',
    '/shop/index.html'
)}
${header('../')}
<main>
  <section class="section">
    <div class="shell">
      <nav class="crumbs"><a href="../index.html">Home</a> <span>/</span> Shop</nav>
      <div class="section-head">
        <span class="eyebrow">The full catalogue</span>
        <h2>Every setup, with the price and what's in it</h2>
        <p>${products.length} setups across ${CATEGORIES.length} categories. Each listing shows exactly what's included — no "call for price".</p>
      </div>
      <div class="occasions">${catCards}</div>
    </div>
  </section>
</main>
${footer('../')}`);

// checkout — availability gate, NOT a payment page
writeFileSync(join(shopDir, 'checkout.html'), `${head(
  'Check your date | Flowers N Balloons',
  'Confirm your event date is available before paying anything.',
  '../',
    '',
    '/shop/checkout.html'
)}
${header('../')}
<main>
  <section class="section">
    <div class="shell" style="max-width:760px">
      <nav class="crumbs"><a href="../index.html">Home</a> <span>/</span> <a href="index.html">Shop</a> <span>/</span> Check date</nav>
      <div class="section-head">
        <span class="eyebrow">Step 1 of 2</span>
        <h2>Let's check your date first</h2>
        <p>We cap how many events we take per day, so we confirm the date is genuinely free <em>before</em> asking for any payment. Nothing is charged on this page.</p>
      </div>

      <div class="form-card">
        <h3>Your setup</h3>
        <div class="checkout-summary"></div>

        <form class="js-checkout-form" novalidate style="margin-top:22px">
          <div class="form-row">
            <div class="form-group">
              <label for="co-name">Your name <span class="req">*</span></label>
              <input class="input" type="text" id="co-name" name="name" autocomplete="name" placeholder="e.g. Priya Sharma" data-required>
              <span class="field-err" data-err="name" role="alert"></span>
            </div>
            <div class="form-group">
              <label for="co-phone">Mobile number <span class="req">*</span></label>
              <input class="input" type="tel" id="co-phone" name="phone" autocomplete="tel" placeholder="98765 43210"
                data-required data-pattern="^[6-9]\\\\d{9}$" data-pattern-msg="Enter a valid 10-digit mobile number.">
              <span class="field-err" data-err="phone" role="alert"></span>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="co-date">Event date <span class="req">*</span></label>
              <input class="input" type="date" id="co-date" name="event_date" data-required>
              <span class="field-err" data-err="event_date" role="alert"></span>
            </div>
            <div class="form-group">
              <label for="co-area">Area in Bengaluru</label>
              <input class="input" type="text" id="co-area" name="area" placeholder="e.g. Koramangala">
            </div>
          </div>
          <div class="form-group">
            <label for="co-notes">Anything else?</label>
            <textarea class="input" id="co-notes" name="message" placeholder="Colours, guest count, venue type…"></textarea>
          </div>

          <button class="btn btn-primary btn-block" type="submit">Check availability</button>
          <p class="form-legal">This does not book or charge anything. We reply with a written quote and a payment link only if your date is free.</p>
          <p class="form-success-msg" hidden></p>
        </form>
      </div>
    </div>
  </section>
</main>
${footer('../')}`);

// category pages
for (const c of CATEGORIES) {
  const items = products.filter((p) => p.category === c.slug).sort((a, b) => a.price - b.price);
  mkdirSync(join(shopDir, c.slug), { recursive: true });
  writeFileSync(join(shopDir, c.slug, 'index.html'), `${head(
    isService(c.slug)
      ? `${c.name} in Bangalore | Flowers N Balloons`
      : `${c.name} Decoration in Bangalore | Flowers N Balloons`,
    `${items.length} ${c.name.toLowerCase()} ${unitOf(c.slug)}s in Bengaluru, each one priced with what you get listed on it.`,
    '../../',
    '',
    `/shop/${c.slug}/index.html`
  )}
${header('../../')}
<main>
  <section class="section">
    <div class="shell">
      <nav class="crumbs"><a href="../../index.html">Home</a> <span>/</span> <a href="../index.html">Shop</a> <span>/</span> ${esc(c.name)}</nav>
      ${categoryArt(c.slug) ? `<div class="cat-hero"><img src="../../${categoryArt(c.slug)}" alt="" width="1376" height="768" loading="eager" fetchpriority="high"></div>` : ''}
      <div class="section-head">
        <span class="eyebrow">${esc(c.name)}</span>
        <h2>${esc(c.name)}${isService(c.slug) ? '' : ' setups'}</h2>
        <p>${esc(c.intro)}</p>
      </div>
      <div class="shop-bar">
        <span class="js-count">${items.length} ${unitOf(c.slug)}s</span>
        <label class="sort-wrap">Sort
          <select class="input js-sort">
            <option value="low">Price: low to high</option>
            <option value="high">Price: high to low</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <div class="filter-bar">
        <div class="chips">
          <button class="chip is-on" type="button" data-tier="">All</button>
          ${[...new Set(items.map((p) => p.tier))].map((t) => `<button class="chip" type="button" data-tier="${esc(t)}">${esc(t)}</button>`).join('')}
        </div>
        <input class="input js-search" type="search" placeholder="Search ${esc(c.name.toLowerCase())}…" aria-label="Search themes">
      </div>
      <p class="no-hits" hidden>No setups match that. <button type="button" class="js-clear">Clear filters</button></p>
      <div class="prod-grid js-grid">${items.map((p, i) => card(p, '../../', i)).join('')}</div>
    </div>
  </section>
</main>
${footer('../../')}`);

  // product pages
  for (const p of items) {
    const ld = {
      '@context': 'https://schema.org', '@type': 'Product',
      name: p.name, sku: p.sku, category: p.categoryName,
      description: p.description,
      brand: { '@type': 'Brand', name: "Flowers 'N' Balloons" },
      offers: { '@type': 'Offer', price: p.price, priceCurrency: 'INR', availability: 'https://schema.org/InStock', url: `https://www.flowersnballoons.com/shop/${p.category}/${p.slug}.html` },
    };
    writeFileSync(join(shopDir, c.slug, `${p.slug}.html`), `${head(
      `${p.name} — ${inr(p.price)} | Flowers N Balloons Bangalore`,
      p.metaDescription,
      '../../',
      `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
      canonUrl(p)
    )}
${header('../../')}
<main>
  <section class="section">
    <div class="shell">
      <nav class="crumbs"><a href="../../index.html">Home</a> <span>/</span> <a href="../index.html">Shop</a> <span>/</span> <a href="index.html">${esc(c.name)}</a> <span>/</span> ${esc(p.name)}</nav>

      <div class="pdp" style="--c1:${p.c1};--c2:${p.c2}">
        <div class="pdp-media"${ratioStyle(p)}>
          ${media(p, '../../', 'full', 'prod-ph pdp-ph')}
          ${hasExactPhoto(p) ? '' : `<p class="ph-note">${photoFor(p) ? 'Shown: an example of our ' + esc(p.categoryName.toLowerCase()) + ' work. This exact theme has not been photographed yet.' : (categoryArt(p.category) ? 'Illustration, not a photograph — this setup has not been photographed yet. We will send real photos of comparable work with your quote.' : "Photo coming soon — this setup hasn't been photographed yet.")}</p>`}
        </div>

        <div class="pdp-info">
          <span class="prod-tier">${esc(p.tier)} · ${esc(c.name)}</span>
          <h1>${esc(p.name)}</h1>
          <p class="pdp-blurb">${esc(p.description)}</p>

          <div class="pdp-price">
            ${p.compareAt ? `<s>${inr(p.compareAt)}</s>` : ''}
            <b>${inr(p.price)}</b>
            <span class="pdp-tax">Book with a ${inr(p.advance)} advance \u00b7 balance on the event day</span>
          </div>

          <button class="btn btn-primary btn-block js-add"
            data-sku="${p.sku}" data-name="${esc(p.name)}" data-price="${p.price}"
            data-url="shop/${p.category}/${p.slug}.html">Add to my setup</button>
          <a class="btn btn-ghost btn-block" style="margin-top:10px" href="https://wa.me/918867121207?text=${encodeURIComponent(`Hi, I'm interested in "${p.name}" (${p.sku}) at ${inr(p.price)}.`)}" target="_blank" rel="noopener">Ask about this on WhatsApp</a>

          <h3 class="incl-h">What's included</h3>
          ${p.inclusions && p.inclusions.length
            ? `<ul class="incl-list">${p.inclusions.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
               <p style="font-size:.84rem;color:var(--muted);margin-top:12px">${p.curated
                 ? 'As shown in the photograph. Sizes are adjusted to your venue and confirmed on your written quote.'
                 : 'Indicative for a setup at this size — quantities and exact items are confirmed on your written quote, sized to your venue.'}</p>`
            : `<ul class="incl-list">
                 <li>Delivered, set up and collected by our team</li>
                 <li>Booked on its own or alongside a decoration package</li>
                 <li>Itemised written quote before you pay anything</li>
               </ul>`}

          <details class="pdp-det"><summary>Travel &amp; setup</summary><p>Free within 12&nbsp;km of our base in Bengaluru. Beyond that, travel is quoted before you pay — never added afterwards. Setup takes 2–4 hours depending on size; we arrive well before your guests.</p></details>
          <details class="pdp-det"><summary>Changes &amp; cancellation</summary><p>Swap colours or add items any time before setup day and we'll re-quote openly. Cancel more than 5 days ahead for a full refund of your advance; closer than that we'll do our best, since materials are usually already bought.</p></details>
          <details class="pdp-det"><summary>How payment works</summary><p>A small advance confirms your date. Balance is due on the event day. We check the date is genuinely free before taking any money.</p></details>
        </div>
      </div>

      <div class="section-head" style="margin-top:64px"><h2 style="font-size:1.5rem">More ${esc(c.name.toLowerCase())} setups</h2></div>
      <div class="prod-grid">${items.filter((x) => x.slug !== p.slug).slice(0, 3).map((x) => card(x, '../../')).join('')}</div>
    </div>
  </section>
</main>
${footer('../../')}`);
  }
}

const min = Math.min(...products.map((p) => p.price));
const max = Math.max(...products.map((p) => p.price));
console.log(`✓ ${products.length} products across ${CATEGORIES.length} categories`);
console.log(`  price range ${inr(min)} – ${inr(max)}  (real prices, harvested)`);
console.log(`  wrote data/products.json + shop/`);
