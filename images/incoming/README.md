# Drop photos here

Then run:

    node scripts/import-images.mjs
    node scripts/build-catalog.mjs

## Naming (spaces, capitals and underscores are fine)

| Filename | What it covers |
|---|---|
| `jungle-safari-standard.jpg` | that one product |
| `Jungle Safari.jpg` | every tier of that theme (Simple / Standard / Premium) |
| `kids-birthday-1.jpg` | fallback for any Kids Birthday product with no photo of its own |

Category slugs: kids-birthday, adult-birthday, baby-shower, welcome-baby,
naming-ceremony, anniversary, haldi-engagement, housewarming, corporate, addons

Accepts jpg / jpeg / png / webp / heic. iPhone HEIC is converted automatically.
Output is webp at 600px (cards) and 1200px (product pages).

Anything that matches no product, theme or category is reported and NOT used —
it will never be silently attached to the wrong item.

## Rights

Only put photos here that you own or have written permission to use.
Setups you built as a subcontractor are usually photographed and owned by the
platform that listed them — check your vendor agreement before reusing those.
