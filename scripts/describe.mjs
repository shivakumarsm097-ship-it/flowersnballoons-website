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

  const meta = `${name} — ${occShort} decoration in Bengaluru from ${'₹' + p.price.toLocaleString('en-IN')}. `
    + `${pal ? cap(pal) + ' ' : ''}${form}, set up by Flowers 'N' Balloons. Book online; we confirm your date first.`;

  return { body, meta: meta.slice(0, 300), form, palette: pal, motif };
}
