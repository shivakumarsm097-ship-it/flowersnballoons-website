#!/bin/bash
# Copy images into images/incoming/ using tools/wedding-image-map.csv
#
#   bash tools/apply-image-map.sh "/path/to/image/folder"
#
# Edit the CSV first if any match is wrong — column 2 is the listing slug.
# Nothing is moved or deleted; originals stay where they are.
set -e
SRC="${1:?usage: bash tools/apply-image-map.sh <source-folder>}"
MAP="$(dirname "$0")/wedding-image-map.csv"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/images/incoming"

n=0; miss=0
while IFS=, read -r img slug name conf why; do
  [ "$img" = "image" ] && continue
  [ -z "$img" ] && continue
  if [ -f "$SRC/$img" ]; then
    ext="${img##*.}"
    cp "$SRC/$img" "$ROOT/images/incoming/$slug.$ext"
    n=$((n+1))
  else
    echo "  missing: $img"; miss=$((miss+1))
  fi
done < "$MAP"

echo ""
echo "copied $n image(s) into images/incoming/  ($miss missing)"
echo "next: node scripts/import-images.mjs && node scripts/build-catalog.mjs"
