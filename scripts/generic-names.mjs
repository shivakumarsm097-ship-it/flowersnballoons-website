#!/usr/bin/env node
/**
 * Vary the filler adjective on GENERIC listing names.
 *
 * Rules:
 *   - Themed listings (named after a character, franchise or named concept
 *     people actually search for) are left VERBATIM. Renaming those costs
 *     search traffic — nobody types "Refined Cocomelon".
 *   - Generic listings led by a filler adjective ("Elegant", "Grand",
 *     "Classic" — 142 listings between those three alone) get that one word
 *     varied. Nothing else in the name is touched.
 *
 * Selection is a stable hash of the slug, so the same listing always gets the
 * same word across rebuilds and image pairings never shift.
 *
 * Writes data/rename-rules.json (exact "old name" -> "new name" pairs) which
 * build-catalog.mjs applies. Editing a single pair there by hand is safe.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const THEME = /frozen|elsa|anna|unicorn|unicron|unicoron|jungle|safari|mermaid|dino|cocomelon|spider\s?man|avenger|hulk|superhero|marvel|barbie|cinderella|boss\s?baby|moana|pe+p+a|mickey|micky|minnie|minie|hello\s?kitty|masha|bluey|paw\s?p[ea]trol|mario|minecraft|transformer|pokemon|doraemon|chhota\s?bheem|motu|tom\s?(and|&)\s?jerry|winnie|pooh|shinchan|ben\s?10|angry\s?bird|among\s?us|squid|encanto|luca|toy\s?story|lightning\s?mcqueen|batman|superman|iron\s?man|captain\s?america|krishna|ganesh|construction|astronaut|space|rocket|circus|cirus|carnival|casino|gatsby|hollywood|harry\s?potter|sonic|roblox|naruto|dragon|mandala|arabian|moroccan|little\s?man|little\s?miss|under\s?the\s?sea|hot\s?air\s?balloon|boho|tropical|farm|jungle/i;

/* Pools are ordered so the first entry is the most natural direct swap.
   All are words a decorator would plausibly write — no thesaurus reaches. */
const POOLS = {
  elegant:      ['Refined', 'Polished', 'Understated', 'Poised'],
  grand:        ['Statement', 'Showpiece', 'Standout', 'Sweeping'],
  classic:      ['Timeless', 'Signature', 'Enduring', 'Familiar'],
  traditional:  ['Heritage', 'Time-Honoured', 'Classical'],
  royal:        ['Regal', 'Palatial', 'Stately', 'Noble'],
  cute:         ['Playful', 'Sweet', 'Cheerful', 'Bright'],
  cutest:       ['Playful', 'Sweet', 'Cheerful'],
  lovely:       ['Soft', 'Warm', 'Gentle', 'Pretty'],
  simple:       ['Pared-Back', 'Minimal', 'Fuss-Free', 'Clean'],
  lavish:       ['Opulent', 'Generous', 'Layered', 'Rich'],
  radiant:      ['Glowing', 'Bright', 'Luminous', 'Gleaming'],
  colorful:     ['Multicolour', 'Bright', 'Vivid', 'Punchy'],
  colourful:    ['Multicolour', 'Bright', 'Vivid', 'Punchy'],
  graceful:     ['Flowing', 'Soft', 'Fluid', 'Delicate'],
  best:         ['Complete', 'Full-Spec', 'Signature'],
  charming:     ['Warm', 'Inviting', 'Sweet'],
  creative:     ['Inventive', 'Custom', 'Original'],
  beautiful:    ['Pretty', 'Soft', 'Graceful', 'Striking'],
  gorgeous:     ['Striking', 'Rich', 'Lush'],
  amazing:      ['Standout', 'Striking', 'Impressive'],
  awesome:      ['Standout', 'Bold', 'Striking'],
  stunning:     ['Striking', 'Head-Turning', 'Dramatic'],
  magnificent:  ['Statement', 'Imposing', 'Sweeping'],
  majestic:     ['Stately', 'Statement', 'Imposing'],
  wonderful:    ['Delightful', 'Warm', 'Cheerful'],
  attractive:   ['Eye-Catching', 'Appealing', 'Neat'],
  fabulous:     ['Standout', 'Lively', 'Bold'],
  fantastic:    ['Standout', 'Lively', 'Bold'],
  exclusive:    ['Limited', 'Bespoke', 'Signature'],
  special:      ['Signature', 'Standout', 'Distinctive'],
  unique:       ['Distinctive', 'Bespoke', 'Individual'],
  nice:         ['Neat', 'Tidy', 'Pleasing'],
  pretty:       ['Soft', 'Delicate', 'Sweet'],
  superb:       ['Standout', 'Strong', 'Polished'],
  excellent:    ['Standout', 'Strong', 'Polished'],
  perfect:      ['Well-Judged', 'Balanced', 'Considered'],
  marvelous:    ['Standout', 'Striking'],
  marvellous:   ['Standout', 'Striking'],
  delightful:   ['Cheerful', 'Warm', 'Sweet'],
  adorable:     ['Sweet', 'Playful', 'Cheerful'],
  vibrant:      ['Bright', 'Vivid', 'Punchy'],
  dazzling:     ['Sparkling', 'Glittering', 'Gleaming'],
  splendid:     ['Rich', 'Standout', 'Lush'],
  exquisite:    ['Fine', 'Detailed', 'Intricate'],
  premium:      ['Upgraded', 'Top-Tier', 'Elevated'],
  luxury:       ['Luxe', 'High-End', 'Upscale'],
  luxurious:    ['Luxe', 'High-End', 'Upscale'],
  modern:       ['Contemporary', 'Current', 'Clean-Lined'],
  trendy:       ['Contemporary', 'Current', 'Fresh'],
  stylish:      ['Sharp', 'Considered', 'Well-Styled'],
  sweet:        ['Gentle', 'Soft', 'Warm'],
  pleasant:     ['Easy', 'Warm', 'Relaxed'],
  impressive:   ['Standout', 'Striking', 'Commanding'],
  extraordinary:['Standout', 'Exceptional'],
  remarkable:   ['Standout', 'Notable'],
  outstanding:  ['Standout', 'Strong'],
  brilliant:    ['Bright', 'Vivid', 'Standout'],
  glorious:     ['Rich', 'Radiant', 'Lush'],
  enchanting:   ['Whimsical', 'Storybook', 'Dreamlike'],
  blissful:     ['Serene', 'Calm', 'Tranquil'],
  serene:       ['Calm', 'Quiet', 'Tranquil'],
  dreamy:       ['Cloudlike', 'Soft-Focus', 'Hazy'],
  magical:      ['Storybook', 'Whimsical', 'Spellbinding'],
  mystical:     ['Storybook', 'Otherworldly'],
  whimsical:    ['Storybook', 'Playful', 'Fanciful'],
  bold:         ['Strong', 'Punchy', 'High-Contrast'],
  chic:         ['Sharp', 'Polished', 'Considered'],
  divine:       ['Serene', 'Uplifting'],
  ultimate:     ['Top-Tier', 'Full-Spec', 'Complete'],
  supreme:      ['Top-Tier', 'Full-Spec'],
  deluxe:       ['Upgraded', 'Top-Tier', 'Elevated'],
};

const LEAD = new RegExp('^(' + Object.keys(POOLS).join('|') + ')\\b', 'i');

/* FNV-1a — stable across runs and machines, unlike hashing object order. */
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

const slugify = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const { products } = JSON.parse(readFileSync('data/products.json', 'utf8'));
const taken = new Set(products.map((p) => slugify(p.sourceName || p.name)));

/* Existing assignments are STICKY. Re-running against a larger catalogue used
   to shuffle collision resolution and hand listings a different adjective —
   which changes the slug, which changes the URL. 50 live pages moved that way
   the first time. Keep every pair already on disk and only assign new ones. */
const pairs = {};
if (existsSync('data/rename-rules.json')) {
  const prev = JSON.parse(readFileSync('data/rename-rules.json', 'utf8')).names || {};
  const stillPresent = new Set(products.map((p) => p.sourceName || p.name));
  for (const [from, to] of Object.entries(prev)) {
    if (!stillPresent.has(from)) continue;   // listing gone from the source
    pairs[from] = to;
    taken.add(slugify(to));
  }
}
const kept = Object.keys(pairs).length;
let skippedThemed = 0, collisions = 0;

for (const p of products) {
  const src = p.sourceName || p.name;
  if (pairs[src]) continue;                  // already assigned on a previous run
  if (THEME.test(src)) { skippedThemed++; continue; }
  const m = src.match(LEAD);
  if (!m) continue;

  const pool = POOLS[m[1].toLowerCase()];
  const h = hash(p.slug);
  let done = false;
  // walk the pool from the hashed offset so a collision falls to the next
  // candidate rather than dropping the rename entirely
  for (let i = 0; i < pool.length && !done; i++) {
    const cand = src.replace(LEAD, pool[(h + i) % pool.length]);
    const cs = slugify(cand);
    if (taken.has(cs)) continue;
    taken.add(cs);
    pairs[src] = cand;
    done = true;
  }
  if (!done) collisions++;
}

writeFileSync('data/rename-rules.json', JSON.stringify({
  _readme: [
    'Generated by scripts/generic-names.mjs — exact old-name -> new-name pairs.',
    'Themed listings (character / franchise names) are deliberately absent:',
    'those keep their source names because that is what customers search for.',
    'Safe to hand-edit any single pair, or delete one to restore that name.',
  ],
  names: pairs,
}, null, 2) + '\n');

console.log(`kept from previous run:        ${kept}`);
console.log(`newly renamed this run:        ${Object.keys(pairs).length - kept}`);
console.log(`themed listings left verbatim: ${skippedThemed}`);
console.log(`generic listings renamed:      ${Object.keys(pairs).length}`);
if (collisions) console.log(`could not rename (no free name): ${collisions}`);
