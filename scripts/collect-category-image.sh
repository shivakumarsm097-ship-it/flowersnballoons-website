#!/bin/bash
# Move the newest Gemini download into images/categories/<slug>.webp
# Usage: scripts/collect-category-image.sh <category-slug>
set -euo pipefail
slug="$1"
root="$(cd "$(dirname "$0")/.." && pwd)"
src=$(ls -t "$HOME/Downloads"/Gemini_Generated_Image_*.png 2>/dev/null | head -1)
[ -z "${src:-}" ] && { echo "no Gemini download found"; exit 1; }

dims=$(sips -g pixelWidth -g pixelHeight "$src" | awk '/pixelWidth|pixelHeight/{print $2}' | paste -sd'x' -)
# 1600px wide is plenty for a full-bleed category header; the source is ~10MB
cwebp -q 82 -resize 1600 0 -m 6 "$src" -o "$root/images/categories/$slug.webp" >/dev/null 2>&1
out_size=$(stat -f%z "$root/images/categories/$slug.webp")
mv "$src" "$root/.img-src/$slug.png" 2>/dev/null || { mkdir -p "$root/.img-src"; mv "$src" "$root/.img-src/$slug.png"; }
printf '%-34s %s -> %s KB\n' "$slug" "$dims" "$((out_size/1024))"
