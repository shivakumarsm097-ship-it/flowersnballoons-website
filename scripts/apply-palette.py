#!/usr/bin/env python3
"""Map the old pink/purple palette onto the refined rose-gold-ink one.

The palette was duplicated in four places -- theme.css tokens, style.css,
style.min.css (its own :root plus hardcoded uses), and an inline <style> block
in every landing page -- so a token edit alone would have left most of the site
on the old colours.

Deliberately NOT remapped: WhatsApp green #25d366 (their brand, not ours) and
the status colours for success/info/warning/error, which carry meaning.
"""
import glob, re, sys

MAP = {
    # rose, replacing the old soft pink and the loud magenta
    '#dd6580': '#c2456b', '#c14e6a': '#9c3454',
    '#e91e8c': '#c2456b', '#c2185b': '#9c3454',
    # plum, replacing sage green and purple as the third hue
    '#6f9d8e': '#7a4a5e', '#557a6d': '#5c3647',
    '#7b2d8b': '#7a4a5e', '#6a2579': '#5c3647',
    # gold
    '#cf9a3f': '#c08a3e', '#b07f2c': '#8f6522',
    '#ff9800': '#c08a3e', '#e65100': '#8f6522',
    # ink and neutrals
    '#3a2e33': '#241a22', '#1a1a2e': '#241a22', '#4a1060': '#241a22',
    '#8a7a80': '#7b6d76',
    '#fff8f6': '#fdfaf6', '#fffbfa': '#ffffff',
    '#fdeef0': '#fdf1f4', '#f3e8f9': '#fdf1f4',
    '#fce4ec': '#fdf1f4', '#fdf0f8': '#fdf1f4',
    '#f4e2df': '#ece0d6',
}
# same colours written as rgb()/rgba() components
RGB = {
    '221,101,128': '194,69,107',    # #dd6580 -> #c2456b
    '74,16,96':    '36,26,34',      # #4a1060 -> #241a22
    '233,30,140':  '194,69,107',    # #e91e8c
    '123,45,139':  '122,74,94',     # #7b2d8b
    '58,46,51':    '36,26,34',      # #3a2e33
    '207,154,63':  '192,138,62',    # #cf9a3f
}

targets = ['css/theme.css', 'css/style.css', 'css/style.min.css'] + sorted(glob.glob('*.html'))
total, touched = 0, []

for f in targets:
    try:
        s = open(f, encoding='utf-8').read()
    except FileNotFoundError:
        continue
    orig, n = s, 0
    for old, new in MAP.items():
        for variant in (old, old.upper()):
            c = s.count(variant)
            if c:
                s = s.replace(variant, new); n += c
    for old, new in RGB.items():
        pat = re.compile(r'(rgba?\(\s*)' + old.replace(',', r'\s*,\s*') + r'(\s*[,)])')
        s, k = pat.subn(lambda m: m.group(1) + new + m.group(2), s)
        n += k
    if s != orig:
        open(f, 'w', encoding='utf-8').write(s)
        touched.append((f, n)); total += n

for f, n in touched:
    print(f'  {f:26} {n} replacements')
print(f'\n{total} replacements across {len(touched)} files')
