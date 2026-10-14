#!/usr/bin/env node
/**
 * Work out the smallest set of pictures that still gives every listing a
 * relevant one, and write a prompt for each.
 *
 * 1,191 listings do not need 1,191 photographs: "Pastel Unicorn Ring Decor"
 * and "Pastel Unicorn Ring Theme" want the same picture. Clustering on
 * category + form + motif + palette collapses them to ~371 while keeping a
 * median cluster size of 1, so most listings still get something specific.
 *
 *   node scripts/plan-listing-images.mjs     -> data/listing-image-plan.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

const { products } = JSON.parse(readFileSync('data/products.json', 'utf8'));

const FORM = [
  [/\bring\b|\bhalo\b|\bcircle\b/i, 'ring',     'a circular ring frame dressed in flowers and balloons'],
  [/\barch(way)?\b/i,               'arch',     'a sweeping balloon arch'],
  [/sequin|sequne|sequence/i,       'sequin',   'a shimmering sequin panel wall'],
  [/\bpanel\b/i,                    'panel',    'a clean panel backdrop'],
  [/\bwall\b/i,                     'wall',     'a full feature wall'],
  [/cascade|spiral|garland|bloom/i, 'garland',  'a cascading balloon and flower garland'],
  [/castle/i,                       'castle',   'a castle-shaped backdrop'],
  [/flex/i,                         'flex',     'a printed flex backdrop'],
  [/photo\s?booth|selfie/i,         'booth',    'a dedicated photo corner'],
  [/stage/i,                        'stage',    'a decorated stage'],
  [/entrance|door/i,                'entrance', 'a decorated entrance and doorway'],
  [/mascot/i,                       'mascot',   'a costumed character greeting children'],
  [/cradle/i,                       'cradle',   'a decorated ceremonial cradle'],
  [/backdrop/i,                     'backdrop', 'a decorated backdrop'],
  [/table/i,                        'table',    'a dressed table setting'],
];
const MOTIF = [
  [/frozen|elsa|anna|snowflake/i,'ice','ice-and-snowflake detailing in white and pale blue'],
  [/unicorn|unicron/i,'unicorn','unicorn detailing with a horn, ears and pastel mane'],
  [/jungle|safari|animal|zebra|giraffe|lion/i,'jungle','jungle foliage and animal figures'],
  [/butterfl/i,'butterfly','paper butterflies in flight'],
  [/space|astronaut|rocket|planet/i,'space','planets, stars and a rocket'],
  [/mermaid|under\s?the\s?sea|nautical/i,'sea','shells, coral and under-the-sea detailing'],
  [/dino/i,'dino','dinosaur figures and tropical leaves'],
  [/car\b|racing|race/i,'cars','racing-car detailing and chequered flags'],
  [/cocomelon/i,'melon','a bright green watermelon-and-nursery motif'],
  [/spider|avenger|hulk|superhero|marvel/i,'hero','bold comic-book superhero styling'],
  [/princess|cinderella|barbie|crown/i,'princess','a crown, tulle and princess styling'],
  [/boss\s?baby/i,'boss','a tiny suit-and-tie motif'],
  [/moana/i,'island','tropical island and ocean styling'],
  [/peppa|mickey|micky|minnie|kitty|masha|bluey/i,'character','friendly cartoon-character cutouts'],
  [/farm|fruit/i,'farm','farmyard animals and fruit'],
  [/construction/i,'construction','toy diggers and traffic cones'],
  [/football|cricket|sport/i,'sport','sports equipment and pennants'],
  [/mario|minecraft|robot|transformer/i,'game','video-game and robot styling'],
  [/paw\s?p[ae]trol/i,'puppy','cartoon rescue-puppy styling'],
  [/floral|flower|garden|rose|marigold|jasmine/i,'floral','dense fresh-flower work'],
  [/tropical|palm/i,'tropical','palm leaves and tropical blooms'],
  [/star|moon|night|celestial|cloud/i,'star','stars, moons and soft clouds'],
  [/heart|romantic|love/i,'romantic','hearts, candles and romantic styling'],
  [/hot\s?air\s?balloon|plane|train|transport/i,'transport','hot-air balloons and toy vehicles'],
  [/candy|donut|ice\s?cream|cake/i,'sweet','oversized candy, donuts and sweets'],
  [/circus|cirus|carnival/i,'circus','circus stripes and carnival bunting'],
  [/boho/i,'boho','boho pampas, macrame and neutral tones'],
  [/disco|retro|gatsby|hollywood/i,'retro','retro glamour with mirror and gold'],
  [/mandala|arabian|moroccan/i,'mandala','mandala and arabesque patterning'],
  [/peacock/i,'peacock','peacock feather detailing'],
  [/rangoli/i,'rangoli','a coloured rangoli on the floor'],
];
const PAL = [
  [/rose\s?gold/i,'rosegold','rose gold'],[/pastel|pastle/i,'pastel','soft pastels'],
  [/chrome/i,'chrome','chrome and metallics'],[/rainbow/i,'rainbow','full rainbow colours'],
  [/gold/i,'gold','gold'],[/silver/i,'silver','silver'],[/black/i,'black','black and white'],
  [/white|ivory/i,'white','white and ivory'],[/pink/i,'pink','pink'],
  [/blue|aqua|navy|teal/i,'blue','blue'],[/purple|lavender|violet/i,'purple','purple'],
  [/green|mint/i,'green','green'],[/red|maroon/i,'red','red'],[/peach/i,'peach','peach'],
  [/yellow/i,'yellow','yellow'],[/orange/i,'orange','orange'],
];
const pick = (table, name) => { for (const row of table) if (row[0].test(name)) return row; return null; };

const SERVICE = new Set(['shamyana-items','kids-birthday-fun-activities','kids-birthday-fun-eats','house-lighting']);
const isService = (s) => SERVICE.has(s) || s.endsWith('-photography');

/* A service category is not one look. Collapsing all 103 party activities into
   a single picture puts a bouncy castle on a magic show. Split by what the
   thing actually is. */
const KIND = [
  [/mascot|costume/i,        'mascot',   'a costumed character entertaining children at a party'],
  [/booth|selfie|360/i,      'booth',    'a photo booth set up at a party'],
  [/pool|slider|bounce|castle|trampoline|play/i, 'play', 'an inflatable bouncy castle and play area on grass'],
  [/game|shooting|dart|ring\s?toss/i, 'game', 'party game stalls set up for children'],
  [/magic|puppet|clown/i,    'show',     'a magician performing for seated children'],
  [/tattoo|art|craft|clay|paint|mehendi/i, 'craft', 'a craft and art activity table for children'],
  [/popcorn|candy\s?floss|chaat|ice\s?cream|live|counter|stall/i, 'counter', 'a decorated live food counter at a party'],
  [/tent|canopy|shamyana|pandal/i, 'tent', 'a large white shamiana tent over an outdoor function'],
  [/chair|seating|sofa|table/i, 'seating', 'rows of covered chairs and tables for an outdoor function'],
  [/light/i,                 'lighting', 'a building exterior outlined in warm string lights at dusk'],
  [/drone|video|4k|cinemat/i,'video',    'a videographer filming an Indian family celebration'],
  [/led\s?wall|screen|projector/i, 'screen', 'a large LED screen at an event venue'],
  [/album|print|frame/i,     'print',    'printed photo albums and framed prints on a table'],
  [/photograph|candid|camera/i, 'photo', 'a photographer shooting an Indian family celebration'],
];

const clusters = new Map();
for (const p of products) {
  const f = pick(FORM, p.name), m = pick(MOTIF, p.name), c = pick(PAL, p.name);
  // services are sold as a service, not a look: one picture per category is right
  const k = isService(p.category) ? pick(KIND, p.name) : null;
  const key = isService(p.category)
    ? [p.category, k?.[1] || 'general'].join('|')
    : [p.category, f?.[1] || 'generic', m?.[1] || 'plain', c?.[1] || 'any'].join('|');
  if (!clusters.has(key)) {
    clusters.set(key, {
      key, category: p.category, categoryName: p.categoryName,
      form: (isService(p.category) ? (pick(KIND, p.name)?.[2] || 'the service set up at an event venue')
                                   : (f?.[2] || 'a decorated backdrop setup')),
      service: isService(p.category),
      motif: m?.[2] || null,
      palette: c?.[2] || null,
      slugs: [], example: p.name,
    });
  }
  clusters.get(key).slugs.push(p.slug);
}

const OCCASION = {
  'kids-birthday':"a child's birthday party", 'birthday':'a grown-up birthday',
  'baby-shower':'a baby shower', 'naming-ceremony':'a naming ceremony',
  'house-warming':'a housewarming', 'engagement':'an engagement',
  'haldi':'a haldi ceremony', 'wedding':'a wedding', 'anniversary':'an anniversary',
  'surprise-events':'a surprise celebration', 'bachelorette':'a bachelorette party',
  'annaprasan':'a first-rice ceremony', 'upanayanam':'a thread ceremony',
  'first-holy-communion':'a first holy communion',
  'kids-birthday-simple-home-decor':'a small birthday at home',
};
const STYLE = 'Photographic, 4:3, Indian setting in Bengaluru, warm natural light, '
  + 'shallow depth of field, editorial event-photography feel. '
  + 'No text, no lettering, no signage, no watermark, no logo, no borders, no clutter on the floor.';

const plan = [...clusters.values()].map((c) => {
  const occ = OCCASION[c.category] || c.categoryName.toLowerCase();
  const bits = [c.form];
  if (!c.service && c.motif) bits.push('with ' + c.motif);
  if (!c.service && c.palette) bits.push('in ' + c.palette);
  return {
    key: c.key,
    file: c.key.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
    listings: c.slugs.length,
    example: c.example,
    slugs: c.slugs,
    prompt: `${bits.join(' ')}, styled for ${occ}. ${STYLE}`,
  };
}).sort((a, b) => b.listings - a.listings);

writeFileSync('data/listing-image-plan.json', JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  listings: products.length,
  images: plan.length,
  clusters: plan,
}, null, 2) + '\n');

const sizes = plan.map((p) => p.listings).sort((a, b) => b - a);
console.log(`${products.length} listings -> ${plan.length} images`);
console.log(`  largest cluster ${sizes[0]}, median ${sizes[Math.floor(sizes.length / 2)]}, singletons ${sizes.filter((n) => n === 1).length}`);
console.log(`\nexamples:`);
plan.slice(0, 3).forEach((p) => console.log(`  [${String(p.listings).padStart(3)}] ${p.example}\n        ${p.prompt.slice(0, 110)}…`));
