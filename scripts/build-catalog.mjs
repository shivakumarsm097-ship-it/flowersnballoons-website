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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const COMP = read('data/components.json');
const SPEC = read('data/catalog-spec.json');
const { components, margin, roundTo } = COMP;

const PHONE = '+918867121207';
const PHONE_H = '+91 88671 21207';
const inr = (n) => '₹' + n.toLocaleString('en-IN');
const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function priceOf(keys) {
  let cost = 0;
  for (const k of keys) {
    if (!components[k]) throw new Error(`Unknown component "${k}" — check catalog-spec.json`);
    cost += components[k].cost;
  }
  return Math.round((cost * margin) / roundTo) * roundTo;
}
const inclusionsOf = (keys) => keys.map((k) => components[k].label);

/* ---------------- expand spec into products ---------------- */
const products = [];
let n = 0;

for (const cat of SPEC.categories) {
  for (const theme of cat.themes) {
    for (const tierKey of cat.tiers) {
      const tier = SPEC.tiers[tierKey];
      // dedupe: a theme extra may repeat something already in the tier base
      const keys = [...new Set([...tier.base, ...(theme.extra || [])])];
      const price = priceOf(keys);
      const name = `${theme.name} — ${tier.label}`;
      products.push({
        sku: `FNB-${cat.slug.slice(0, 2).toUpperCase()}-${String(++n).padStart(3, '0')}`,
        name,
        slug: slugify(`${theme.name}-${tier.label}`),
        category: cat.slug,
        categoryName: cat.name,
        theme: theme.name,
        tier: tier.label,
        tierBlurb: tier.blurb,
        price,
        // shown struck-through; honest framing = "if bought separately"
        compareAt: Math.round((price * 1.22) / roundTo) * roundTo,
        components: keys,
        inclusions: inclusionsOf(keys),
        image: null,
      });
    }
  }
}

for (const a of SPEC.addons) {
  const price = priceOf(a.components);
  products.push({
    sku: `FNB-AD-${String(++n).padStart(3, '0')}`,
    name: a.name,
    slug: a.slug,
    category: 'addons',
    categoryName: 'Add-ons',
    theme: a.name,
    tier: 'Add-on',
    tierBlurb: 'Add to any setup, or book on its own.',
    price,
    compareAt: null,
    components: a.components,
    inclusions: inclusionsOf(a.components),
    image: null,
  });
}

const CATEGORIES = [
  ...SPEC.categories.map((c) => ({ slug: c.slug, name: c.name, intro: c.intro })),
  { slug: 'addons', name: 'Add-ons', intro: 'Small extras that can be added to any setup, or booked on their own.' },
];

writeFileSync(
  join(ROOT, 'data/products.json'),
  JSON.stringify({ generatedFrom: 'catalog-spec.json + components.json', margin, count: products.length, categories: CATEGORIES, products }, null, 2)
);

/* ---------------- shared page chrome ---------------- */
const head = (title, desc, depth, extra = '') => `<!DOCTYPE html>
<html lang="en-IN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="icon" href="${depth}images/logo.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" media="print" onload="this.media='all'">
<link rel="stylesheet" href="${depth}css/refined.css">
<link rel="stylesheet" href="${depth}css/shop.css">
${extra}
</head>
<body>`;

const header = (depth) => `
<header class="header" role="banner">
  <div class="shell header-inner">
    <a class="logo" href="${depth}index.html" aria-label="Flowers N Balloons — home">
      <img src="${depth}images/logo.webp" alt="" width="38" height="38">
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
          <img src="${depth}images/logo.webp" alt="" width="38" height="38" loading="lazy">
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

const card = (p, depth) => `
<a class="prod-card reveal" href="${depth}shop/${p.category}/${p.slug}.html">
  <div class="prod-media">
    <div class="prod-ph" aria-hidden="true">${esc(p.theme.split(' ')[0])}</div>
    ${p.compareAt ? `<span class="prod-off">-${Math.round((1 - p.price / p.compareAt) * 100)}%</span>` : ''}
  </div>
  <div class="prod-body">
    <span class="prod-tier">${esc(p.tier)}</span>
    <h3>${esc(p.theme)}</h3>
    <p class="prod-incl">${p.inclusions.length} inclusions</p>
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
  const from = Math.min(...items.map((p) => p.price));
  return `
  <a class="occ-card reveal" href="${c.slug}/index.html">
    <div class="occ-media"><div class="prod-ph" aria-hidden="true">${esc(c.name)}</div><span class="occ-price">From ${inr(from)}</span></div>
    <div class="occ-body">
      <h3>${esc(c.name)}</h3>
      <p>${esc(c.intro)}</p>
      <span class="occ-link">${items.length} setups
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </span>
    </div>
  </a>`;
}).join('');

writeFileSync(join(shopDir, 'index.html'), `${head(
  `Shop Decoration Setups in Bangalore | Flowers N Balloons`,
  `Browse ${products.length} decoration setups with prices and full inclusions. Birthday, baby shower, haldi, housewarming and corporate decor in Bengaluru.`,
  '../'
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
  '../'
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
    `${c.name} Decoration in Bangalore — Prices & Inclusions | Flowers N Balloons`,
    `${items.length} ${c.name.toLowerCase()} decoration setups in Bengaluru from ${inr(Math.min(...items.map((p) => p.price)))}. Full inclusions listed on every setup.`,
    '../../'
  )}
${header('../../')}
<main>
  <section class="section">
    <div class="shell">
      <nav class="crumbs"><a href="../../index.html">Home</a> <span>/</span> <a href="../index.html">Shop</a> <span>/</span> ${esc(c.name)}</nav>
      <div class="section-head">
        <span class="eyebrow">${esc(c.name)}</span>
        <h2>${esc(c.name)} setups</h2>
        <p>${esc(c.intro)}</p>
      </div>
      <div class="shop-bar">
        <span>${items.length} setups · from ${inr(Math.min(...items.map((p) => p.price)))}</span>
        <label class="sort-wrap">Sort
          <select class="input js-sort">
            <option value="low">Price: low to high</option>
            <option value="high">Price: high to low</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <div class="prod-grid js-grid">${items.map((p) => card(p, '../../')).join('')}</div>
    </div>
  </section>
</main>
${footer('../../')}`);

  // product pages
  for (const p of items) {
    const ld = {
      '@context': 'https://schema.org', '@type': 'Product',
      name: p.name, sku: p.sku, category: p.categoryName,
      description: `${p.theme} decoration setup — ${p.tierBlurb} Includes: ${p.inclusions.join(', ')}.`,
      brand: { '@type': 'Brand', name: "Flowers 'N' Balloons" },
      offers: { '@type': 'Offer', price: p.price, priceCurrency: 'INR', availability: 'https://schema.org/InStock', url: `https://www.flowersnballoons.com/shop/${p.category}/${p.slug}.html` },
    };
    writeFileSync(join(shopDir, c.slug, `${p.slug}.html`), `${head(
      `${p.name} — ${inr(p.price)} | Flowers N Balloons Bangalore`,
      `${p.theme} ${c.name.toLowerCase()} decoration in Bengaluru at ${inr(p.price)}. ${p.inclusions.length} inclusions listed. Book online, we confirm your date first.`,
      '../../',
      `<script type="application/ld+json">${JSON.stringify(ld)}</script>`
    )}
${header('../../')}
<main>
  <section class="section">
    <div class="shell">
      <nav class="crumbs"><a href="../../index.html">Home</a> <span>/</span> <a href="../index.html">Shop</a> <span>/</span> <a href="index.html">${esc(c.name)}</a> <span>/</span> ${esc(p.theme)}</nav>

      <div class="pdp">
        <div class="pdp-media">
          <div class="prod-ph pdp-ph" aria-hidden="true">${esc(p.theme)}</div>
          <p class="ph-note">Photo coming soon — this setup hasn't been photographed yet.</p>
        </div>

        <div class="pdp-info">
          <span class="prod-tier">${esc(p.tier)} · ${esc(c.name)}</span>
          <h1>${esc(p.theme)}</h1>
          <p class="pdp-blurb">${esc(p.tierBlurb)}</p>

          <div class="pdp-price">
            ${p.compareAt ? `<s>${inr(p.compareAt)}</s>` : ''}
            <b>${inr(p.price)}</b>
            <span class="pdp-tax">all-inclusive for the items listed below</span>
          </div>

          <button class="btn btn-primary btn-block js-add"
            data-sku="${p.sku}" data-name="${esc(p.name)}" data-price="${p.price}"
            data-url="shop/${p.category}/${p.slug}.html">Add to my setup</button>
          <a class="btn btn-ghost btn-block" style="margin-top:10px" href="https://wa.me/918867121207?text=${encodeURIComponent(`Hi, I'm interested in "${p.name}" (${p.sku}) at ${inr(p.price)}.`)}" target="_blank" rel="noopener">Ask about this on WhatsApp</a>

          <h3 class="incl-h">What's included</h3>
          <ul class="incl-list">${p.inclusions.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>

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
console.log(`  price range ${inr(min)} – ${inr(max)}  (margin ${margin}x)`);
console.log(`  wrote data/products.json + shop/`);
