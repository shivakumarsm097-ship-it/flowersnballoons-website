/**
 * Product description generator.
 *
 * Reads structure out of the real product name (form, palette, motif, scale)
 * and composes copy from that. Deliberately describes what the setup IS —
 * shape, colours, feel, who it suits — and never states item counts or
 * dimensions, because anything specific published here becomes a delivery
 * promise we haven't verified for that product.
 *
 * Variation is functional, not cosmetic: 900+ near-identical descriptions
 * read as thin/boilerplate content and get discounted by search engines.
 */

const FORMS = [
  [/\bring\b|\bhalo\b|\bcircle\b|\bspinny\b/i, 'ring backdrop', 'a circular ring frame dressed in balloons'],
  [/\barch(way)?\b/i, 'balloon arch', 'a sweeping balloon arch'],
  [/\bsequin|sequne|sequence\b/i, 'sequin panel', 'a shimmer-sequin panel wall'],
  [/\bpanel\b/i, 'panel backdrop', 'a clean panel backdrop'],
  [/\bwall\b/i, 'feature wall', 'a full feature wall'],
  [/\bcascade|spiral|garland|bloom\b/i, 'balloon cascade', 'a cascading balloon garland'],
  [/\bcastle\b/i, 'castle backdrop', 'a castle-style backdrop'],
  [/\bflex\b/i, 'flex backdrop', 'a printed flex backdrop'],
  [/\bphoto\s?booth|selfie\b/i, 'photo corner', 'a dedicated photo corner'],
  [/\bstage\b/i, 'stage setup', 'a decorated stage'],
  [/\bentrance\b/i, 'entrance decor', 'an entrance treatment'],
];

const PALETTES = [
  [/rose\s?gold/i, 'rose gold'], [/\bpastel|pastle\b/i, 'soft pastel'], [/\bchrome\b/i, 'chrome'],
  [/\brainbow\b/i, 'rainbow'], [/\bgold(en)?\b/i, 'gold'], [/\bsilver\b/i, 'silver'],
  [/\bblack|blacky\b/i, 'black'], [/\bwhite|whity|whitish\b/i, 'white'], [/\bpink|pinky|pinkish/i, 'pink'],
  [/\bblue|bluish|bluesh|aqua|navy|teal\b/i, 'blue'], [/\bpurple|lavender|violet\b/i, 'purple'],
  [/\bgreen|greeny|mint\b/i, 'green'], [/\bred\b/i, 'red'], [/\bpeach\b/i, 'peach'],
  [/\bcopper\b/i, 'copper'], [/\byellow|sunshine\b/i, 'yellow'], [/\bboho\b/i, 'boho neutral'],
];

const MOTIFS = [
  [/frozen|elsa|anna|snowflake/i, 'ice-and-snowflake'], [/unicorn|unicron|unicoron/i, 'unicorn'],
  [/jungle|safari|animal|zebra|giraffe|lion/i, 'jungle-animal'], [/butterfl/i, 'butterfly'],
  [/space|astronaut|planet|spacecraft|rocket/i, 'space'], [/mermaid|under\s?the\s?sea|nautical|sea\s?queen/i, 'under-the-sea'],
  [/dino/i, 'dinosaur'], [/car\b|racing|race|speedway|furious|porsche/i, 'racing-car'],
  [/cocomelon/i, 'Cocomelon-style'], [/spiderman|avenger|hulk|superhero|marvel/i, 'superhero'],
  [/princess|cinderella|barbie|crown|prince\b/i, 'princess-and-crown'], [/boss\s?baby|tycoon|ceo/i, 'boss-baby'],
  [/moana/i, 'island-adventure'], [/peppa|mickey|minnie|micky|minie|hello\s?kitty|masha|bear|pony|rabbit|bunny|panda|duck|shark|elephant|teddy/i, 'friendly-character'],
  [/farm|fruit/i, 'farmyard'], [/construction/i, 'construction'], [/football|soccer|cricket|target|game/i, 'sports'],
  [/mario|minecraft|transformer|robot/i, 'game-and-robot'], [/paw\s?petrol|paw\s?patrol/i, 'puppy-rescue'],
  [/floral|flower|garden|sun\s?flower/i, 'floral'], [/tropical/i, 'tropical'],
  [/star|moon|night|celestial|cloud/i, 'starry-night'], [/heart|romantic|love/i, 'romantic'],
  [/hot\s?air\s?balloon|parachute|plane|sky|aeroplane|transport|train/i, 'up-in-the-air'],
  [/candy|donut|ice\s?cream|cake/i, 'sweet-treat'], [/circus|cirus|carnival/i, 'carnival'],
  [/boho/i, 'boho'], [/disco|retro|gatsby|hollywood|casino/i, 'retro-glam'],
];

const AUDIENCE = {
  'kids-birthday': ['a child’s birthday', 'kids’ parties at home, in a clubhouse or a party hall'],
  'birthday': ['a grown-up birthday', 'milestone birthdays, surprise parties and terrace evenings'],
  'baby-shower': ['a baby shower', 'baby showers at home or in a banquet hall'],
  'naming-ceremony': ['a naming ceremony', 'naming ceremonies and cradle functions'],
  'house-warming': ['a housewarming', 'griha pravesh and new-home celebrations'],
  'engagement': ['an engagement', 'ring ceremonies and engagement receptions'],
  'haldi': ['a haldi ceremony', 'daytime haldi functions at home or on a terrace'],
  'wedding': ['a wedding function', 'weddings and receptions'],
  'anniversary': ['an anniversary', 'anniversaries and romantic evenings'],
  'corporate': ['a corporate event', 'office celebrations, launches and store openings'],
  'surprise-events': ['a surprise celebration', 'proposals, homecomings and last-minute surprises'],
  'bachelorette': ['a bachelorette party', 'bachelorette and bridal send-off parties'],
  'annaprasan': ['an annaprasan', 'first-rice ceremonies'],
  'upanayanam': ['an upanayanam', 'thread ceremonies and traditional functions'],
  'first-holy-communion': ['a first holy communion', 'communion celebrations'],
  'kids-birthday-simple-home-decor': ['a home birthday', 'smaller birthday celebrations at home'],
  'kids-birthday-fun-activities': ['a children’s party', 'kids’ parties needing entertainment as well as decor'],
  'kids-birthday-fun-eats': ['a children’s party', 'parties where the food counter is part of the setup'],
  'kids-birthday-photography': ['a birthday shoot', 'birthday parties that also need coverage'],
  'baby-shower-photography': ['a baby shower shoot', 'baby showers that also need coverage'],
  'naming-ceremony-photography': ['a naming ceremony shoot', 'naming and cradle ceremonies that also need coverage'],
  'house-warming-photography': ['a housewarming shoot', 'griha pravesh functions that also need coverage'],
  'engagement-photography': ['an engagement shoot', 'ring ceremonies and receptions that also need coverage'],
  'haldi-photography': ['a haldi shoot', 'daytime haldi functions that also need coverage'],
  'wedding-photography': ['a wedding shoot', 'weddings and receptions that also need coverage'],
  'first-holy-communion-photography': ['a communion shoot', 'communion services and the celebration after'],
  'house-lighting': ['a lit-up home', 'festivals, housewarmings and celebrations needing exterior lighting'],
  'shamyana-items': ['an outdoor function', 'outdoor functions needing tenting and seating'],
};

const OPENERS = [
  (f, p, m, occ) => `A ${p ? p + ' ' : ''}${f} built around ${m ? m + ' detail' : 'a clean, uncluttered look'}, styled for ${occ}.`,
  (f, p, m, occ) => `${cap(m ? m + ' styling' : 'Balloon styling')} on ${aOrAn(p ? p + ' ' + f : f)} — a straightforward centrepiece for ${occ}.`,
  (f, p, m, occ) => `This one leads with ${p ? p + ' tones' : 'a balanced palette'} across ${aOrAn(f)}, finished with ${m ? m + ' touches' : 'layered balloon work'}.`,
  (f, p, m, occ) => `${cap(aOrAn(f))} in ${p || 'a palette of your choosing'}, put together for ${occ}.`,
  (f, p, m, occ) => `Designed as ${aOrAn(f)}${p ? ' in ' + p : ''}, with ${m ? m + ' elements' : 'balloon and prop work'} carrying the theme.`,
  (f, p, m, occ) => `${cap(m || 'Balloon')}-led decor on ${aOrAn(f)}${p ? ', kept to ' + p + ' throughout' : ''}.`,
];

const SCALE_LINE = [
  [0, 3000, ['Compact enough for a home celebration, and quick to set up.',
             'A small, focused setup — one good feature wall rather than a whole room.']],
  [3000, 8000, ['A comfortable size for most homes and smaller halls.',
                'Mid-sized: enough presence for photos without crowding a living room.']],
  [8000, 18000, ['Sized to fill a wall properly — the setup most people land on.',
                 'Our most-booked scale, and the point where the decor really starts to carry the room.']],
  [18000, 40000, ['A larger installation that takes over the main wall and reads well from across the room.',
                  'Substantial enough for a banquet hall, with layered work rather than a single flat backdrop.']],
  [40000, Infinity, ['Our largest format, for venues where the decor needs to hold the whole room.',
                     'Full-venue scale, with a dedicated team on site through the setup.']],
];

/** Adjectives already in the product name — reused so copy echoes the listing. */
const STYLES = [
  [/\bgrand\b/i, 'grand'], [/\belegant\b/i, 'elegant'], [/\bclassic\b/i, 'classic'],
  [/\bsimple\b/i, 'pared-back'], [/\bcute|cutest\b/i, 'playful'], [/\broyal\b/i, 'regal'],
  [/\bluxe|luxury|lavish\b/i, 'luxe'], [/\bradiant|glowing|shimmer|glitter\b/i, 'high-shine'],
  [/\bmajestic|magnificent\b/i, 'statement'], [/\bwhimsical|dreamy|magical|mystical|enchant/i, 'whimsical'],
  [/\bcharming|lovely|beautiful|gorgeous\b/i, 'soft'], [/\bvibrant|colou?rful|bold\b/i, 'high-colour'],
  [/\bbliss|serene|serenity\b/i, 'calm'],
];

const CLOSERS = [
  'Colours and scale can be adjusted to your venue — tell us the space and we will size it properly.',
  'We set up before your guests arrive and clear everything afterwards.',
  'Swap the palette or add elements and we will re-quote openly before you commit.',
  'Delivery, setup and cleanup across Bengaluru are included in the quote.',
  'Send us your date and venue and we will confirm the exact plan in writing.',
];

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const aOrAn = (s) => (/^[aeiou]/i.test(s) ? 'an ' : 'a ') + s;
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const find = (list, name) => { for (const row of list) if (row[0].test(name)) return row; return null; };

export function describe(p) {
  const name = p.name;
  if (SERVICE_CATS.has(p.category)) {
    const body = serviceCopy(p);
    const meta = `${name} — ${(AUDIENCE[p.category] || ['your event'])[0]} in Bengaluru at ₹${p.price.toLocaleString('en-IN')}. Booked with Flowers 'N' Balloons alongside your decoration.`;
    return { body, meta: meta.slice(0, 300), form: null, palette: null, motif: null };
  }
  const fm = find(FORMS, name);
  const form = fm ? fm[1] : 'themed backdrop setup';
  let pal = find(PALETTES, name)?.[1] || null;
  const motif = find(MOTIFS, name)?.[1] || null;
  // don't say "boho styling on a boho neutral backdrop"
  if (pal && motif && (pal.includes(motif) || motif.includes(pal.split(' ')[0]))) pal = null;
  const style = find(STYLES, name)?.[1] || null;
  const [occShort, occLong] = AUDIENCE[p.category] || ['your celebration', 'celebrations across Bengaluru'];

  const h = hash(p.slug);
  const open = OPENERS[h % OPENERS.length](form, pal, motif, occShort);
  const scales = SCALE_LINE.find(([lo, hi]) => p.price >= lo && p.price < hi)[2];
  const scale = scales[(h >> 5) % scales.length];
  const close = CLOSERS[(h >> 3) % CLOSERS.length];
  const styleLine = style ? ` The finish leans ${style}.` : '';

  const body = `${open}${styleLine} ${scale} Suits ${occLong}. ${close}`;

  const meta = `${name} — ${occShort} decoration in Bengaluru at ${'₹' + p.price.toLocaleString('en-IN')}. `
    + `${pal ? cap(pal) + ' ' : ''}${form}, set up by Flowers 'N' Balloons. Book online; we confirm your date first.`;

  return { body, meta: meta.slice(0, 300), form, palette: pal, motif };
}

/* ── card colour ──────────────────────────────────────────────────────
   Every product currently shows the same placeholder, so 300 cards on a
   category page read as one grey wall. Deriving the gradient from the
   palette/motif already parsed above makes each card distinct AND
   informative — a blue product looks blue before any photo exists. */

const PAL_COLOR = {
  'pink': ['#ec4899', '#f9a8d4'],       'rose gold': ['#e0846f', '#f7cfc2'],
  'gold': ['#d4a017', '#f6dc8a'],        'silver': ['#8e9bab', '#dbe2ea'],
  'black': ['#3f3f52', '#7a7a92'],       'white': ['#c9cfda', '#f6f8fb'],
  'blue': ['#3b82f6', '#a5c8fd'],        'purple': ['#8b5cf6', '#c9bcfb'],
  'green': ['#10b981', '#8ae8c4'],       'red': ['#ef4444', '#fbb0b0'],
  'peach': ['#fb923c', '#fed9b6'],       'copper': ['#c2703d', '#eec0a0'],
  'yellow': ['#f2b01e', '#fbe28f'],      'soft pastel': ['#c9b6ec', '#f9d8e6'],
  'chrome': ['#94a3b8', '#d6dee8'],      'rainbow': ['#f472b6', '#60a5fa'],
  'boho neutral': ['#c2a37c', '#ecdfc9'],
};

const MOTIF_COLOR = {
  'jungle-animal': ['#2f9e6a', '#9fe0bd'],  'ice-and-snowflake': ['#4aa8d8', '#bfe6f7'],
  'unicorn': ['#c084fc', '#fbcfe8'],        'butterfly': ['#d946ef', '#f6c9f2'],
  'space': ['#4338ca', '#a5b4fc'],          'under-the-sea': ['#0891b2', '#95dce8'],
  'dinosaur': ['#4d9c41', '#b7e3a8'],       'racing-car': ['#dc2626', '#fbaeae'],
  'superhero': ['#2563eb', '#f87171'],      'princess-and-crown': ['#e879a9', '#fbd5e6'],
  'floral': ['#e0568b', '#fbc7d9'],         'tropical': ['#14b8a6', '#9beedf'],
  'starry-night': ['#3730a3', '#a5a1e8'],   'romantic': ['#e11d48', '#fbb6c8'],
  'sweet-treat': ['#f472b6', '#fde0ec'],    'carnival': ['#f59e0b', '#f472b6'],
  'up-in-the-air': ['#38bdf8', '#c3e9fb'],  'sports': ['#16a34a', '#a7e6bd'],
  'farmyard': ['#ca8a04', '#f3dda0'],       'construction': ['#ea9612', '#f9dba6'],
  'game-and-robot': ['#6366f1', '#bcc0fb'], 'boss-baby': ['#475569', '#b4c0d0'],
  'friendly-character': ['#f97316', '#fdd0a8'], 'island-adventure': ['#0d9488', '#8fdcd2'],
  'retro-glam': ['#a21caf', '#e9b6ee'],     'puppy-rescue': ['#0ea5e9', '#b3e2fb'],
  'Cocomelon-style': ['#65a30d', '#cdeb9c'], 'boho': ['#b08968', '#e6d3bd'],
  'carnival ': ['#f59e0b', '#f472b6'],
};

const CAT_COLOR = {
  'kids-birthday': ['#f472b6', '#a5b4fc'],  'birthday': ['#8b5cf6', '#f0abfc'],
  'baby-shower': ['#7dd3fc', '#fbcfe8'],    'naming-ceremony': ['#fb923c', '#fde3c0'],
  'house-warming': ['#f59e0b', '#fbd9a0'],  'engagement': ['#e879a9', '#f5d0e4'],
  'haldi': ['#eab308', '#fbe9a3'],          'wedding': ['#dc2626', '#f7c2b8'],
  'anniversary': ['#e11d48', '#f9c4d2'],    'surprise-events': ['#a855f7', '#e2c7fb'],
  'bachelorette': ['#ec4899', '#f9c8e6'],   'annaprasan': ['#f97316', '#fbd8b4'],
  'upanayanam': ['#ca8a04', '#f0dca4'],     'first-holy-communion': ['#93a4c7', '#e5ecf7'],
  'shamyana-items': ['#0d9488', '#9ad9d1'], 'kids-birthday-fun-activities': ['#f59e0b', '#fbcfe8'],
  'kids-birthday-fun-eats': ['#f472b6', '#fde68a'], 'kids-birthday-photography': ['#64748b', '#cbd5e1'],
  'baby-shower-photography': ['#94a3b8', '#dbe4ee'],
  'naming-ceremony-photography': ['#7c8798', '#cfd8e3'], 'house-warming-photography': ['#8b8177', '#ded5cb'],
  'engagement-photography': ['#9c7f8a', '#e6d6dc'], 'haldi-photography': ['#b8973f', '#f2e3b8'],
  'wedding-photography': ['#6f7b8c', '#d3dbe6'], 'first-holy-communion-photography': ['#8e9bab', '#dce3ec'],
  'house-lighting': ['#c08a3e', '#ffe9b8'], 'kids-birthday-simple-home-decor': ['#a78bfa', '#ddd6fe'],
};

export function cardColors(p) {
  const name = p.name;
  const pal = find(PALETTES, name)?.[1];
  const motif = find(MOTIFS, name)?.[1];
  return PAL_COLOR[pal] || MOTIF_COLOR[motif] || CAT_COLOR[p.category] || ['#a78bfa', '#f0abfc'];
}

/* ── non-decoration categories ────────────────────────────────────────
   Tents, mascots, food counters and photographers are not backdrops, but
   the decoration path described all 137 of them as "a themed backdrop
   setup with balloon and prop work". These get their own copy.
   Nothing asserts staffing, duration or coverage that isn't in the
   product name — anything stated here is a delivery promise. */

const SERVICE_CATS = new Set([
  'shamyana-items', 'kids-birthday-fun-activities', 'kids-birthday-fun-eats',
  'kids-birthday-photography', 'baby-shower-photography',
  'naming-ceremony-photography', 'house-warming-photography',
  'engagement-photography', 'haldi-photography', 'wedding-photography',
  'first-holy-communion-photography', 'house-lighting',
]);

const size = (n) => n.match(/(\d+)\s*[×x]\s*(\d+)\s*(?:feet|ft)?/i)?.slice(1, 3).join('×');
const hours = (n) => n.match(/(\d+)\s*hours?\b/i)?.[1];

const SERVICE_CLOSERS = [
  'Tell us your venue and guest count and we will confirm exactly what is needed.',
  'Delivery and collection across Bengaluru are included in the quote.',
  'Book it on its own or add it to a decoration package.',
  'Availability is confirmed in writing before you pay anything.',
];

function serviceCopy(p) {
  const n = p.name, h = hash(p.slug), sz = size(n), hr = hours(n);
  const close = SERVICE_CLOSERS[(h >> 3) % SERVICE_CLOSERS.length];

  if (p.category === 'shamyana-items') {
    const what = /tent|canopy|shamyana/i.test(n) ? 'Covered shelter'
      : /chair|seating|sofa/i.test(n) ? 'Guest seating'
      : /table/i.test(n) ? 'Table hire'
      : /drum|water/i.test(n) ? 'Water storage'
      : /light|fan|cooler/i.test(n) ? 'On-site utilities'
      : 'Event hire';
    return `${what} for an outdoor or open-air function${sz ? `, ${sz} feet` : ''}. `
      + `Delivered, put up and taken down by our team on the day. `
      + `Usually booked alongside the decor so there is one crew and one quote. ${close}`;
  }

  if (p.category === 'kids-birthday-fun-activities') {
    const kind = /mascot/i.test(n) ? 'A costumed character appearance'
      : /booth|selfie|360/i.test(n) ? 'A photo activity'
      : /pool|slider|bounce|castle|trampoline/i.test(n) ? 'An active play setup'
      : /game|shooting|angry|ring|dart/i.test(n) ? 'A party game'
      : /magic|puppet|tattoo|art|craft|clay|paint/i.test(n) ? 'A hosted activity'
      : 'An add-on activity';
    return `${kind} to run alongside the decor, for the stretch after the cake when children need something to do. `
      + `Set up before guests arrive and cleared afterwards. `
      + `Add it to any birthday package. ${close}`;
  }

  if (p.category === 'kids-birthday-fun-eats') {
    return `A live food counter set up at your venue, made to order in front of guests rather than plated in advance. `
      + `It doubles as part of the decor — counters are dressed to match your theme. `
      + `Quantities are quoted against your guest count. ${close}`;
  }

  if (p.category === 'house-lighting') {
    const what = /villa|bungalow/i.test(n) ? 'a villa'
      : /(\d+)\s*floor/i.test(n) ? `a ${n.match(/(\d+)\s*floor/i)[1]}-floor building`
      : /balcony|terrace/i.test(n) ? 'a balcony or terrace'
      : 'your home';
    // the shared closers ask for a guest count, which means nothing for the
    // outside of a building
    const LIGHT_CLOSERS = [
      'Send us the address and we will confirm the run and the fixing points.',
      'Fitting and removal across Bengaluru are included in the quote.',
      'Book it on its own or add it to a housewarming package.',
      'Availability is confirmed in writing before you pay anything.',
    ];
    return `Exterior lighting for ${what}, run and fitted by our team and taken down afterwards. `
      + `Used for housewarmings, festivals and family celebrations where the outside of the house should read as clearly as the inside. `
      + `Power requirements are checked on a site visit before the day. `
      + LIGHT_CLOSERS[(h >> 5) % LIGHT_CLOSERS.length];
  }

  // photography / videography
  const kind = /drone/i.test(n) ? 'Aerial coverage'
    : /4k|cinematic|video/i.test(n) ? 'Video coverage'
    : /led wall|screen/i.test(n) ? 'A live screen for the venue'
    : /album|print/i.test(n) ? 'Printed output'
    : 'Photography coverage';
  const tail = /in writing/.test(close)
    ? 'Deliverables and turnaround are listed on your quote.'
    : 'Deliverables and turnaround are confirmed in writing with your quote.';
  return `${kind} for your event${hr ? `, booked in a ${hr}-hour slot` : ''}. `
    + `Arranged together with the decoration, so there is one point of contact rather than a separate vendor to chase. `
    + `${tail} ${close}`;
}

/* ── inclusions ───────────────────────────────────────────────────────
   What a setup physically consists of, derived from the product's own
   name (structure, theme, palette) and price band (scale). The wording
   here is ours.

   Counts are given as approximations and the page states that the exact
   list is confirmed on the written quote. A specific figure published
   against 1,000+ listings nobody has audited is a delivery promise, and
   under-delivering against it is a refund. */

function bandOf(price) {
  if (price < 3000) return 0;
  if (price < 8000) return 1;
  if (price < 18000) return 2;
  if (price < 35000) return 3;
  return 4;
}

const BALLOONS = ['A small balloon cluster', 'An organic balloon garland (~100 balloons)',
  'An organic balloon garland (~150 balloons)', 'Layered balloon work (~200 balloons)',
  'Full balloon work across the structure (200+ balloons)'];

function structureFor(name, band) {
  if (/\bring\b|\bhalo\b|\bcircle\b|\bspinny\b/i.test(name))
    return [`A circular ring frame${band >= 2 ? ', floor-standing, dressed on both sides' : ''}`];
  if (/\barch(way)?\b/i.test(name)) return ['A free-standing balloon arch'];
  if (/\bsequin|sequne|sequence\b/i.test(name)) return ['A shimmer-sequin panel wall'];
  if (/\bpanel\b/i.test(name)) return [`${band >= 3 ? 'Multiple panel boards' : 'A panel board backdrop'}, framed`];
  if (/\bcastle\b/i.test(name)) return ['A themed castle backdrop with cut-out detail'];
  if (/\bwall\b/i.test(name)) return ['A full feature wall'];
  if (/\bcascade|spiral|garland\b/i.test(name)) return ['A cascading balloon garland'];
  if (/\bstage\b/i.test(name)) return ['A dressed stage backdrop', 'Stage-front skirting'];
  if (/\bentrance\b/i.test(name)) return ['An entrance frame or arch'];
  if (/\bflex\b/i.test(name)) return ['A printed flex backdrop'];
  return [`A fabric or flex backdrop${band >= 3 ? ', full-wall width' : ''}`];
}

export function inclusionsFor(p) {
  if (SERVICE_CATS.has(p.category)) return null;   // these are hire/coverage, not setups
  const n = p.name, band = bandOf(p.price);
  const out = [...structureFor(n, band)];

  out.push(BALLOONS[band]);

  const motif = find(MOTIFS, n)?.[1];
  if (motif) out.push(`Themed cut-outs and props for the ${motif.replace(/-/g, ' ')} look`);

  const pal = find(PALETTES, n)?.[1];
  if (pal) out.push(`Colour scheme kept to ${pal} throughout`);

  if (/flower|floral|rose|garden|marigold|jasmine/i.test(n) || band >= 3)
    out.push(band >= 3 ? 'Fresh-flower arrangements' : 'Floral accents');

  if (band >= 2) out.push('Focus lighting on the backdrop');
  if (band >= 3) out.push('Fairy lights or additional uplighting');

  if (/cradle/i.test(n)) out.push('A decorated cradle');
  if (/rangoli|toran|pooja/i.test(n)) out.push('Entrance rangoli and door toran');
  if (/name|monogram|letter/i.test(n)) out.push('A personalised name or monogram piece');

  if (p.category !== 'house-warming') out.push(band >= 3 ? 'A styled cake or dessert table' : 'A dressed cake table');
  if (band >= 2) out.push('Photo-booth props');

  out.push(band >= 3 ? 'Delivery, setup, on-site supervision and cleanup' : 'Delivery, setup and cleanup');
  return out;
}
