#!/usr/bin/env python3
"""Remove 'from ₹X' price claims. No global whitespace tidy: the previous
attempt collapsed newlines before '.' and ',' across whole files, which joined
CSS rules onto one line and turned the Google Fonts axis range 9..144 into
9.144, breaking font loading."""
import re, glob, pathlib

P = r'₹\s?[\d][\d,]*'

# Each rule consumes its own surrounding punctuation so nothing needs tidying.
RULES = [
    (rf'\s*—\s*From {P}\s*\|',            ' |'),      # title: "… — From ₹X | Brand"
    (rf'\s+from {P}\s*\|',                ' |'),      # og/twitter title
    (rf'\s*—\s*From {P}(?=\s*<)',         ''),        # h1 / title ending in price
    (rf'\s*·\s*From {P}',                 ''),
    (rf'Decorations?\s+Starting\s+From {P}', 'Decoration for Every Occasion'),
    (rf'\s+starting from (?:just )?{P}',  ''),        # "… decorations starting from ₹X."
    (rf'\s+starting at (?:just )?{P}',    ''),
    (rf'\s+start(?:s)? from (?:just )?{P}', ''),
    (rf'\s*Starting from (?:just )?{P}\.',  ''),
    (rf'[^.<>]*?packages? start from {P}\.\s*', ''),  # whole sentence
    (rf'From {P}\s*—\s*',                 ''),        # card blurb prefix
    (rf'\s*<span class="price-badge">[^<]*</span>', ''),
    (rf'\s+from {P}(?=\s*[.<])',          ''),
    (rf'\s+From {P}(?=\s*[.<])',          ''),
    (rf'\s+from {P}',                     ''),
    (rf'\s+From {P}',                     ''),
]

total, touched = 0, []
for f in sorted(glob.glob('*.html')):
    if f == 'google-ads.html':       # internal ad-copy planning doc
        continue
    p = pathlib.Path(f); s = p.read_text(encoding='utf-8'); o = s; n = 0
    for pat, rep in RULES:
        s, k = re.subn(pat, rep, s); n += k
    if s != o:
        p.write_text(s, encoding='utf-8'); touched.append((f, n)); total += n

for f, n in touched: print(f'  {f:24} {n}')
print(f'\n{total} removals across {len(touched)} files')
