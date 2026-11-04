#!/usr/bin/env python3
"""Find "striking distance" searches from Google Search Console.

Pulls the last full 28 days of Search Console data (query x page), keeps the
searches where the page sits at an average position between 5 and 20, drops
brand searches and phrases the page already contains word for word, and
writes a JSON + Markdown report of what to add to which page.

Credentials: a Google Cloud service account that has been added as a user on
the Search Console property. Its JSON key is read from the environment:
  GSC_SERVICE_ACCOUNT_JSON   the key file contents (or a path to the file)
Optional:
  GSC_SITE_URL      property, default tries sc-domain:flowersnballoons.com
                    then https://flowersnballoons.com/
  GSC_MIN_IMPRESSIONS   default 10
  GSC_MAX_PER_PAGE      default 5

Usage (from the repo root):
  pip install google-auth requests
  python3 scripts/gsc_striking_distance.py --out /tmp/seo-report
"""
import argparse
import datetime as dt
import html
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_HOST = "flowersnballoons.com"
SITE_CANDIDATES = ["sc-domain:flowersnballoons.com", "https://flowersnballoons.com/"]
SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
BRAND = re.compile(r"flowers?\s*'?n'?\s*balloons?|flowersnballoons|fnb\b", re.I)
SKIP_FILES = {"404.html", "thank-you.html", "google-ads.html"}  # noindex / internal
POS_MIN, POS_MAX = 5.0, 20.0


def session():
    try:
        from google.oauth2 import service_account
        from google.auth.transport.requests import AuthorizedSession
    except ImportError:
        sys.exit("Missing dependency: pip install google-auth requests")
    raw = os.environ.get("GSC_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        sys.exit("GSC_SERVICE_ACCOUNT_JSON is not set (service-account key JSON or a path to it).")
    info = json.loads(Path(raw).read_text() if not raw.startswith("{") else raw)
    creds = service_account.Credentials.from_service_account_info(info, scopes=[SCOPE])
    return AuthorizedSession(creds)


def query(s, site, start, end):
    url = f"https://searchconsole.googleapis.com/webmasters/v3/sites/{requests_quote(site)}/searchAnalytics/query"
    rows, start_row = [], 0
    while True:
        body = {"startDate": start, "endDate": end, "dimensions": ["query", "page"],
                "type": "web", "rowLimit": 25000, "startRow": start_row}
        r = s.post(url, json=body, timeout=60)
        if r.status_code in (403, 404):
            return None, f"{r.status_code}: {r.text[:300]}"
        r.raise_for_status()
        batch = r.json().get("rows", [])
        rows += batch
        if len(batch) < 25000:
            return rows, None
        start_row += 25000


def requests_quote(s):
    from urllib.parse import quote
    return quote(s, safe="")


def url_to_file(url):
    """https://flowersnballoons.com/lp-birthday?x#y -> lp-birthday.html"""
    m = re.match(r"https?://(?:www\.)?" + re.escape(SITE_HOST) + r"(/[^?#]*)?", url)
    if not m:
        return None
    path = (m.group(1) or "/").strip("/")
    name = "index.html" if path == "" else (path if path.endswith(".html") else path + ".html")
    return name if (ROOT / name).exists() and name not in SKIP_FILES else None


def visible_text(file):
    t = (ROOT / file).read_text(encoding="utf-8")
    t = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", t, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return norm(html.unescape(t))


def norm(s):
    return re.sub(r"\s+", " ", s.lower()).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="output path prefix (writes .json and .md)")
    ap.add_argument("--days", type=int, default=28)
    a = ap.parse_args()

    min_impr = int(os.environ.get("GSC_MIN_IMPRESSIONS", "10"))
    max_per_page = int(os.environ.get("GSC_MAX_PER_PAGE", "5"))
    end = dt.date.today() - dt.timedelta(days=3)          # GSC data lags ~2-3 days
    start = end - dt.timedelta(days=a.days - 1)

    s = session()
    sites = [os.environ["GSC_SITE_URL"]] if os.environ.get("GSC_SITE_URL") else SITE_CANDIDATES
    rows, used, errors = None, None, []
    for site in sites:
        rows, err = query(s, site, start.isoformat(), end.isoformat())
        if rows is not None:
            used = site
            break
        errors.append(f"{site} -> {err}")
    if rows is None:
        sys.exit("No Search Console access. Add the service account e-mail as a user on the property.\n" + "\n".join(errors))

    texts, by_page = {}, {}
    for r in rows:
        q, page = r["keys"]
        pos, impr = r["position"], r["impressions"]
        if not (POS_MIN <= pos <= POS_MAX) or impr < min_impr or BRAND.search(q):
            continue
        f = url_to_file(page)
        if not f:
            continue
        texts.setdefault(f, visible_text(f))
        present = norm(q) in texts[f]
        by_page.setdefault(f, []).append({
            "query": q, "page": page, "position": round(pos, 1), "impressions": int(impr),
            "clicks": int(r["clicks"]), "ctr": round(r["ctr"] * 100, 2), "already_on_page": present,
        })

    report = {"property": used, "start": start.isoformat(), "end": end.isoformat(),
              "filters": {"position": [POS_MIN, POS_MAX], "min_impressions": min_impr,
                          "max_per_page": max_per_page}, "pages": {}}
    for f, items in sorted(by_page.items()):
        items.sort(key=lambda x: (-x["impressions"], x["position"]))
        todo = [i for i in items if not i["already_on_page"]][:max_per_page]
        report["pages"][f] = {"add": todo, "already_present": [i for i in items if i["already_on_page"]]}

    Path(a.out + ".json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    lines = [f"# Search Console striking-distance report", "",
             f"Property `{used}` · {start} to {end} · positions {POS_MIN:g}–{POS_MAX:g} · "
             f"min {min_impr} impressions · max {max_per_page} new phrases per page", ""]
    total = 0
    for f, d in report["pages"].items():
        if not d["add"]:
            continue
        lines += [f"## `{f}`", "", "| Search phrase | Avg position | Impressions | Clicks |", "|---|---|---|---|"]
        for i in d["add"]:
            lines.append(f"| {i['query']} | {i['position']} | {i['impressions']} | {i['clicks']} |")
            total += 1
        lines.append("")
    if total == 0:
        lines.append("No new phrases this month: every striking-distance search is already on its page, or none met the thresholds.")
    Path(a.out + ".md").write_text("\n".join(lines) + "\n")
    print(f"{total} phrases to add across {sum(1 for d in report['pages'].values() if d['add'])} pages -> {a.out}.md")


if __name__ == "__main__":
    main()
