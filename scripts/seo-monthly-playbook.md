# Monthly Search Console "striking distance" update

Runs once a month (Claude scheduled task); the PR is opened by a GitHub Action. Goal: for searches where a page
already shows up at **average position 5–20**, add that **exact search phrase**
to the matching page, so Google sees a clear match and can move the page up.

## Steps

1. Branch from the latest `main`: `seo/striking-distance-YYYY-MM`.
2. Get the data:
   ```bash
   pip install -q google-auth requests
   python3 scripts/gsc_striking_distance.py --out /tmp/seo-report
   ```
   It needs `GSC_SERVICE_ACCOUNT_JSON` in the environment. If it is missing, or
   the service account has no access, stop and report that; do not guess data.
3. Read `/tmp/seo-report.md`. For each page and each phrase listed under it,
   add the phrase **word for word** (same words, same order; capitalisation may
   follow the sentence) to that page's visible body copy.
4. Check, commit, push the branch, and stop (see below). A GitHub Action opens the PR.

## Writing rules

- Add the phrase **once** per page, in a sentence a customer would actually
  read: a short new paragraph in the most relevant section, a new FAQ
  question/answer in an existing FAQ block, or one extra sentence in an
  existing paragraph. It must read naturally; never a keyword list.
- At most **5 new phrases per page** per month (the script already caps this).
- Only state things that are already true on the site: services, areas,
  prices, hours, "no hidden charges", "2-hour response". Never invent
  reviews, numbers, venues or promises.
- Match the page's existing markup and classes, so the current theme styles it.
- Phrases with a place name (e.g. "… in Bellandur") go on the page Google ranks;
  if that page is about a different area, phrase it as "we also cover …".

## Never change

- `<title>`, meta description/keywords/robots, canonical, Open Graph/Twitter
  tags, JSON-LD, or any `<h1>` on an existing page. Run
  `python3 scripts/check_seo_tags_unchanged.py --base origin/main` — it must pass.
- URLs, file names, `sitemap.xml`, `robots.txt`, `CNAME`.
- Area pages (`balloon-decoration-*.html`) are generated: edit their copy in
  `scripts/build-area-pages.py` (the `AREAS` data), then run
  `python3 scripts/build-area-pages.py`. Never hand-edit the generated HTML.

## Before pushing

- `python3 scripts/check_seo_tags_unchanged.py --base origin/main` passes.
- Every phrase from the report is present on its page:
  re-run the report script; each page's "add" list should now be empty.
- Pages still parse (open each changed page and check the edited section).
- Commit message: first line `SEO: add striking-distance phrases (YYYY-MM)`;
  body = the report table (phrase, page, position, impressions) and, for each
  page, the sentence(s) you added. This becomes the PR description.

## Push — the pull request opens automatically

`git push -u origin seo/striking-distance-YYYY-MM`. The workflow
`.github/workflows/seo-auto-pr.yml` opens the PR into `main` on push, using the
commit message as the description. Do **not** open a PR yourself (that would
create a duplicate) and **never merge** — the owner reviews it.
If the report has no phrases to add, make no branch and no commit; just report
"nothing to add".
