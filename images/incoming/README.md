# Drop photos here

Then run:

    node scripts/import-images.mjs
    node scripts/build-catalog.mjs

## Easiest: keep the original filenames, sort into category folders

    images/incoming/wedding/5.png
    images/incoming/kids-birthday/12-1.png

`data/source-filenames.json` holds 1,147 filename → listing pairings taken
from the source category pages, so a file keeping its original name lands on
the correct listing automatically. The folder name matters because 81
filenames are reused across categories — `2.png` alone belongs to three
different listings.

Regenerate that table any time with:

    node scripts/harvest-pairings.mjs

## Other names that work

| Filename | Covers |
|---|---|
| `lavish-pink-wedding-decor.jpg` | that listing (slug — see FILENAMES.csv) |
| `Lavish Pink Wedding Decor.jpg` | same, by full product name |
| `wedding-1.jpg` | fallback for any wedding listing with no photo |

Spaces, capitals and underscores are ignored. jpg / png / webp / heic all
work; iPhone HEIC is converted automatically. Output is webp at 600px for
cards and 1200px for product pages — images smaller than that are encoded at
their real size rather than upscaled, and reported so you know which ones
would benefit from better originals.

## What it will not do

Anything matching more than one listing, or nothing at all, is **reported and
skipped** — never attached to a guessed listing. A wrong photo means a
customer books expecting something you will not deliver.

## Manual override

For photos with no source filename (your own shoots), either rename them per
`FILENAMES.csv`, use `tools/match-images.html` to assign visually, or edit a
mapping CSV and run `bash tools/apply-image-map.sh <folder>`.

## Rights

Only put photos here that you own or have written permission to use. Check
each one for another company's watermark or logo before importing — one of
the wedding images carried a third-party logo and had to be dropped.
