#!/usr/bin/env python3
"""Fail if any existing page's SEO tags changed compared with a git ref.

Checked per HTML page that exists in the base ref: <title>, meta description,
keywords and robots, canonical, Open Graph and Twitter tags, every JSON-LD
block, and the <h1>. Body copy is free to change; these are not.

Usage:  python3 scripts/check_seo_tags_unchanged.py [--base origin/main]
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATTERNS = {
    "title": r"<title>.*?</title>",
    "meta": r'<meta\s+(?:name|property)="(?:description|keywords|robots|og:[^"]+|twitter:[^"]+)"[^>]*>',
    "canonical": r'<link\s+rel="canonical"[^>]*>',
    "jsonld": r'<script type="application/ld\+json">(.*?)</script>',
    "h1": r"<h1[^>]*>.*?</h1>",
}


def tags(t):
    out = {}
    for k, p in PATTERNS.items():
        found = re.findall(p, t, re.S | re.I)
        if k == "jsonld":
            found = [json.dumps(json.loads(b), sort_keys=True) for b in found]
        out[k] = [re.sub(r"\s+", " ", x).strip() for x in found]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="origin/main")
    a = ap.parse_args()
    files = subprocess.run(["git", "ls-tree", "--name-only", a.base], cwd=ROOT,
                           capture_output=True, text=True, check=True).stdout.split()
    bad = []
    for f in files:
        if not f.endswith(".html") or not (ROOT / f).exists():
            continue
        old = subprocess.run(["git", "show", f"{a.base}:{f}"], cwd=ROOT, capture_output=True, text=True).stdout
        before, after = tags(old), tags((ROOT / f).read_text(encoding="utf-8"))
        for k in PATTERNS:
            if before[k] != after[k]:
                bad.append(f"{f}: {k} changed")
    if bad:
        print("SEO tags changed (not allowed):\n  " + "\n  ".join(bad))
        sys.exit(1)
    print("OK: titles, meta, canonicals, Open Graph/Twitter, JSON-LD and H1s unchanged.")


if __name__ == "__main__":
    main()
