#!/usr/bin/env python3
"""Generate the Bangalore locality landing pages (balloon-decoration-<area>.html).

Each page reuses the landing-page shell from lp-birthday.html (critical CSS,
stylesheets, header, footer, scripts) and fills in area-specific copy, real
customer reviews from that area (copied verbatim from the existing pages),
FAQs, and JSON-LD (Service + BreadcrumbList + FAQPage).

Run from the repo root:  python3 scripts/build-area-pages.py
Edit AREAS below to change copy or add an area, then re-run.
"""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://flowersnballoons.com"
PHONE = "+918867121207"
PHONE_TXT = "+91 8867121207"

# Occasion pages linked from every area page (prices removed until the new packages are added).
OCCASIONS = [
    ("lp-birthday", "🎂", "Birthday Decoration", "Balloon arches, themed backdrops, cake-table styling and photo booths.", "4,500"),
    ("lp-babyshower", "🍼", "Baby Shower Decoration", "Soft themes, welcome boards, props and a photo corner for the mom-to-be.", "5,000"),
    ("lp-babywelcome", "🎀", "Baby Welcome Home", "Name banners, balloon garlands and nursery styling for the homecoming.", "4,000"),
    ("lp-namingceremony", "👶", "Naming Ceremony", "Cradle décor, fresh flowers and a name board for the Namkaran.", "5,000"),
    ("lp-housewarming", "🏡", "Housewarming / Griha Pravesh", "Torans, marigold strings, banana-stem entrance and pooja setup.", "6,000"),
    ("lp-haldi", "🌼", "Haldi Ceremony", "Marigold backdrops, floral swings, umbrellas and pom-pom décor.", "7,000"),
    ("lp-engagement", "💍", "Engagement Decoration", "Stage backdrop, ring-ceremony styling, floral entrance and lighting.", "8,000"),
    ("lp-wedding", "💐", "Wedding Decoration", "Stage, mandap, entrance arch and fresh-flower venue styling.", "15,000"),
    ("lp-community", "🎪", "Community & Society Events", "Clubhouse and apartment festival décor, stages and photo zones.", "8,000"),
    ("lp-corporate", "🏢", "Corporate Event Decoration", "Stage branding, entrance décor and photo zones for offices.", "10,000"),
]

# reviews: (name, location, text, source page) — verbatim from the live pages
AREAS = [
    {
        "slug": "sarjapur-road", "name": "Sarjapur Road", "short": "Sarjapur Road",
        "geo": (12.9107, 77.6869),
        "desc": "Balloon, birthday and event decoration on Sarjapur Road, Bangalore — we're based on Sarjapura Main Road. Free quote in 2 hours. Call +91 8867121207.",
        "intro": "Our team is based on Sarjapura Main Road, so Sarjapur Road is home ground for us. From kids' birthdays in apartment clubhouses to housewarmings in newly handed-over flats, we bring the balloons, flowers and setup crew to your doorstep.",
        "about": [
            "Sarjapur Road is one of Bangalore's fastest-growing residential corridors — a long stretch of gated communities, villa projects and new apartment towers running out past the Outer Ring Road towards Sarjapur town, with tech campuses along the way. That mix shapes what our customers here book most: birthday and baby-shower setups in clubhouses and party halls, housewarming décor for new homes, and festival decorations for apartment associations.",
            "Because we're close by, we can usually do a quick site look for larger setups, and on-the-day logistics are simpler. For gated communities, tell us your society's rules for vendor entry, timings and balloon use when you book — we plan the setup around them so there's no last-minute trouble at the gate.",
        ],
        "localities": ["Bellandur", "Kaikondrahalli", "Kasavanahalli", "Haralur Road", "Doddakannelli", "Carmelaram", "Chikkabellandur", "Dommasandra", "Sarjapur town"],
        "popular": ["lp-birthday", "lp-babyshower", "lp-housewarming", "lp-community"],
        "reviews": [
            ("Nisha K.", "Sarjapur Road", "lp-babyshower"),
            ("Arjun R.", "Sarjapur Road", "lp-housewarming"),
            ("Ravi M., RWA Secretary", "Sarjapur Road", "lp-community"),
        ],
        "faq_local": ("Can you decorate a new flat for a housewarming on Sarjapur Road?",
                      "Yes. Housewarming and Griha Pravesh décor is one of the most common bookings we get on Sarjapur Road, where many families are moving into new apartments. We set up torans, marigold strings, entrance décor and the pooja area, and plan timings around your muhurtham."),
        "nearby": ["hsr-layout", "koramangala", "whitefield", "electronic-city", "marathahalli"],
    },
    {
        "slug": "whitefield", "name": "Whitefield", "short": "Whitefield",
        "geo": (12.9698, 77.7500),
        "desc": "Balloon & birthday decoration in Whitefield, Bangalore for homes, apartment clubhouses and offices. Transparent pricing, free quote in 2 hours.",
        "intro": "Planning a birthday, baby welcome or office celebration in Whitefield? We decorate apartments, villas, clubhouses and offices across Whitefield — balloons, fresh flowers, backdrops and full setup, with one transparent quote.",
        "about": [
            "Whitefield grew from a quiet suburb into east Bangalore's big IT hub, and today it's a mix of tech parks around ITPL and large apartment and villa communities in Brookefield, Hoodi, Varthur and beyond. That means our Whitefield bookings swing between family celebrations at home or in a clubhouse, and corporate events like product launches and team celebrations in office spaces.",
            "Traffic on Whitefield's main roads can be unpredictable, so we plan our travel and setup time to finish well before your guests arrive. For offices and tech parks, we coordinate with your admin or facilities team for access, loading and setup windows.",
        ],
        "localities": ["ITPL Main Road", "Brookefield", "Hoodi", "Kundalahalli", "Varthur", "Hope Farm", "Kadugodi", "Siddapura", "Mahadevapura"],
        "popular": ["lp-birthday", "lp-babywelcome", "lp-corporate", "lp-housewarming"],
        "reviews": [
            ("Sumanth R.", "Whitefield, Bangalore", "index"),
            ("Sneha &amp; Arjun", "Whitefield", "lp-babywelcome"),
            ("Anand K., HR Manager", "Whitefield", "lp-corporate"),
        ],
        "faq_local": ("Can you decorate apartment clubhouses and offices in Whitefield?",
                      "Yes. We regularly set up in apartment clubhouses and party halls as well as in office spaces. For offices and tech parks, we coordinate with your admin or facilities team for entry passes, loading and setup timings."),
        "nearby": ["marathahalli", "sarjapur-road", "indiranagar", "koramangala", "hsr-layout"],
    },
    {
        "slug": "hsr-layout", "name": "HSR Layout", "short": "HSR Layout",
        "geo": (12.9116, 77.6474),
        "desc": "Balloon and birthday decoration in HSR Layout, Bangalore — homes, terraces and party halls in every sector. Free quote in 2 hours, no hidden charges.",
        "intro": "From unicorn birthday arches to haldi and roka setups, we decorate homes, terraces and party halls across every sector of HSR Layout — with fresh flowers, balloons and a team that sets up on time.",
        "about": [
            "HSR Layout is a planned neighbourhood split into seven sectors, with a mix of independent houses, apartments and plenty of cafés and party spaces. Many of our HSR customers celebrate at home or on a terrace, so we often design setups that make the most of a living room, a staircase landing or an open rooftop.",
            "HSR is close to our base on the Sarjapur side, so it's quick for us to reach. Tell us whether your celebration is indoors or on a terrace when you enquire — for open-air setups we plan the balloons and décor for wind and evening light.",
        ],
        "localities": ["Sector 1", "Sector 2", "Sector 3", "Sector 4", "Sector 5", "Sector 6", "Sector 7", "Agara", "Somasundarapalya", "Parangipalya"],
        "popular": ["lp-birthday", "lp-haldi", "lp-engagement", "lp-babyshower"],
        "reviews": [
            ("Rahul K.", "HSR Layout", "lp-birthday"),
            ("Sanjay R.", "HSR Layout", "lp-engagement"),
            ("Kiran R.", "HSR Layout", "lp-haldi"),
        ],
        "faq_local": ("Do you do terrace or rooftop decorations in HSR Layout?",
                      "Yes. Terrace birthdays and small functions are popular in HSR Layout. We plan open-air setups for wind and lighting — sturdier balloon structures, secure fixing and fairy lights for evening events."),
        "nearby": ["koramangala", "sarjapur-road", "electronic-city", "jayanagar", "whitefield"],
    },
    {
        "slug": "koramangala", "name": "Koramangala", "short": "Koramangala",
        "geo": (12.9352, 77.6245),
        "desc": "Birthday, baby shower, engagement and balloon decoration in Koramangala, Bangalore. Homes, restaurants and party venues. Free quote in 2 hours.",
        "intro": "Princess birthdays, red-and-gold engagements, marigold haldi setups — we've decorated them all in Koramangala. Homes, apartments, restaurants and party venues across every block, with transparent pricing.",
        "about": [
            "Koramangala's eight blocks pack in independent homes, apartments and some of Bangalore's busiest restaurants and party venues. Our Koramangala customers book everything from intimate home birthdays to engagement and haldi functions in hired venues.",
            "If your event is in a restaurant or banquet space, share the venue name when you enquire — we check their décor rules (open flames, wall fixing, setup time) and work with their team so the setup is smooth.",
        ],
        "localities": ["1st Block", "3rd Block", "4th Block", "5th Block", "6th Block", "7th Block", "8th Block", "Ejipura", "ST Bed Layout", "Adugodi"],
        "popular": ["lp-birthday", "lp-engagement", "lp-haldi", "lp-babyshower"],
        "reviews": [
            ("Meera K.", "Koramangala", "lp-birthday"),
            ("Pooja &amp; Karthik", "Koramangala", "lp-engagement"),
            ("Priya M.", "Koramangala, Bangalore", "index"),
        ],
        "faq_local": ("Can you decorate a restaurant or party venue in Koramangala?",
                      "Yes. Share the venue name when you enquire. We check the venue's décor rules — fixing on walls, open flames, setup and clear-up windows — and coordinate with their team so everything is ready before your guests arrive."),
        "nearby": ["hsr-layout", "indiranagar", "jayanagar", "sarjapur-road", "whitefield"],
    },
    {
        "slug": "electronic-city", "name": "Electronic City", "short": "Electronic City",
        "geo": (12.8452, 77.6602),
        "desc": "Balloon, birthday and corporate event decoration in Electronic City, Bangalore — apartments, societies and offices. Free quote in 2 hours.",
        "intro": "Baby showers, naming ceremonies, society festivals and office annual days — we decorate across Electronic City Phase 1 and Phase 2, for families, apartment associations and companies.",
        "about": [
            "Electronic City is one of Bangalore's oldest IT hubs, with large tech campuses in Phase 1 and Phase 2 surrounded by big apartment communities along Hosa Road, Neeladri Nagar and Doddathogur. Our bookings here are a mix of family functions, apartment-association festival celebrations and corporate events.",
            "For corporate events in tech parks, we coordinate entry passes, loading bays and setup windows with your admin team. For apartment associations, we can design stage, entrance and photo-zone décor that works for large crowds.",
        ],
        "localities": ["Phase 1", "Phase 2", "Neeladri Nagar", "Doddathogur", "Hosa Road", "Konappana Agrahara", "Bommasandra", "Huskur"],
        "popular": ["lp-babyshower", "lp-namingceremony", "lp-community", "lp-corporate"],
        "reviews": [
            ("Ananya S.", "Electronic City", "lp-babyshower"),
            ("Kavya S.", "Electronic City", "lp-namingceremony"),
            ("Shalini R., Admin Head", "Electronic City", "lp-corporate"),
        ],
        "faq_local": ("Do you decorate corporate events in Electronic City tech parks?",
                      "Yes — annual days, product launches and team celebrations. We coordinate with your admin or facilities team for entry passes, loading and setup windows, and can add stage branding and photo zones."),
        "nearby": ["hsr-layout", "sarjapur-road", "koramangala", "jayanagar", "marathahalli"],
    },
    {
        "slug": "marathahalli", "name": "Marathahalli", "short": "Marathahalli",
        "geo": (12.9569, 77.7011),
        "desc": "Balloon and event decoration in Marathahalli, Bangalore — baby showers, naming ceremonies, birthdays and office décor. Free quote in 2 hours.",
        "intro": "We decorate homes, apartments and offices across Marathahalli — from 'It's a Girl' baby showers and cradle ceremonies to office entrances and branded backdrops.",
        "about": [
            "Marathahalli sits at a busy junction on the Outer Ring Road, close to several large tech parks, with dense apartment neighbourhoods around Munnekolala, Kundalahalli Gate and AECS Layout. Many of our Marathahalli customers are families in apartments planning baby showers, naming ceremonies and birthdays, along with offices nearby.",
            "Apartments here vary a lot in space, so we scale every setup to your room — a full balloon arch where there's space, or a compact backdrop and photo corner for smaller living rooms. Our team works 9 AM to 9 PM every day, so evening setups after office hours can be planned too.",
        ],
        "localities": ["Munnekolala", "Kundalahalli Gate", "AECS Layout", "Spice Garden", "Doddanekundi", "Kadubeesanahalli", "Panathur", "Outer Ring Road"],
        "popular": ["lp-babyshower", "lp-namingceremony", "lp-birthday", "lp-corporate"],
        "reviews": [
            ("Deepa R.", "Marathahalli", "lp-babyshower"),
            ("Divya M.", "Marathahalli", "lp-namingceremony"),
            ("Vivek T., Operations", "Marathahalli", "lp-corporate"),
        ],
        "faq_local": ("Can you set up decorations in the evening after office hours in Marathahalli?",
                      "Our team works 9 AM to 9 PM every day, so evening setups can be scheduled. Share your preferred time when you enquire and we'll confirm a slot that has everything ready before the celebration starts."),
        "nearby": ["whitefield", "sarjapur-road", "indiranagar", "koramangala", "electronic-city"],
    },
    {
        "slug": "indiranagar", "name": "Indiranagar", "short": "Indiranagar",
        "geo": (12.9719, 77.6412),
        "desc": "Engagement, wedding, baby welcome and balloon decoration in Indiranagar, Bangalore. Homes and venues. Transparent pricing, free quote in 2 hours.",
        "intro": "Engagement stages, wedding décor and baby-welcome setups — we decorate homes and venues across Indiranagar, with fresh flowers, balloons and lighting tailored to your theme.",
        "about": [
            "Indiranagar is one of Bangalore's most established neighbourhoods, known for 100 Feet Road and 12th Main, leafy residential streets and independent homes. Our Indiranagar customers often book elegant, detail-heavy setups — engagement and wedding décor, intimate dinners at home, and welcome-home decorations for new babies.",
            "Many homes here are independent houses with gates, porches and staircases that make great décor spots. We plan entrance décor, floral garlands and lighting around your space, and for venues we coordinate with the venue team on setup and clear-up timings.",
        ],
        "localities": ["HAL 2nd Stage", "Defence Colony", "Domlur", "Jeevan Bima Nagar", "HAL Old Airport Road", "CV Raman Nagar", "Ulsoor"],
        "popular": ["lp-engagement", "lp-wedding", "lp-babywelcome", "lp-birthday"],
        "reviews": [
            ("Nikhil &amp; Shreya", "Indiranagar", "lp-engagement"),
            ("Ramya K.", "Indiranagar", "lp-babywelcome"),
            ("Aishwarya &amp; Kiran", "Indiranagar", "lp-wedding"),
        ],
        "faq_local": ("Do you decorate engagements and weddings in Indiranagar?",
                      "Yes. We design engagement stages, ring-ceremony backdrops, floral entrances and full wedding décor in Indiranagar homes and venues, and coordinate setup and clear-up timings with the venue."),
        "nearby": ["koramangala", "whitefield", "marathahalli", "jayanagar", "hsr-layout"],
    },
    {
        "slug": "jayanagar", "name": "Jayanagar", "short": "Jayanagar",
        "geo": (12.9299, 77.5826),
        "desc": "Griha Pravesh, haldi, wedding and balloon decoration in Jayanagar, Bangalore — traditional and modern setups. Free quote in 2 hours.",
        "intro": "Traditional Griha Pravesh décor, colourful haldi setups and wedding stages — we decorate homes, kalyana mantapas and venues across Jayanagar, respecting every ritual detail.",
        "about": [
            "Jayanagar is one of Bangalore's oldest planned neighbourhoods, with leafy blocks of independent homes and many families who celebrate with tradition. Our Jayanagar bookings lean towards Griha Pravesh and pooja setups, haldi and wedding functions, and festivals at home.",
            "For traditional functions we work with fresh flowers — marigold strings, mango-leaf torans, banana-stem entrances and rangoli — and plan the setup around your muhurtham and the pandit's requirements, so the space is ready when the rituals begin.",
        ],
        "localities": ["4th Block", "4th T Block", "9th Block", "JP Nagar", "Basavanagudi", "BTM Layout", "Banashankari", "Bannerghatta Road"],
        "popular": ["lp-housewarming", "lp-haldi", "lp-wedding", "lp-namingceremony"],
        "reviews": [
            ("Vikram S.", "Jayanagar", "lp-housewarming"),
            ("Meghana S.", "Jayanagar", "lp-haldi"),
            ("Sneha &amp; Vivek", "Jayanagar", "lp-wedding"),
        ],
        "faq_local": ("Do you do traditional decorations for Griha Pravesh and pooja in Jayanagar?",
                      "Yes. We set up traditional décor with fresh marigold strings, mango-leaf torans, banana-stem entrances, lamps and rangoli, and arrange the pooja area and the pandit's seating around your muhurtham."),
        "nearby": ["koramangala", "hsr-layout", "electronic-city", "indiranagar", "sarjapur-road"],
    },
]


def load_reviews():
    """Map (name, page) -> (text, location) from the existing pages, verbatim."""
    out = {}
    for page in {r[2] for a in AREAS for r in a["reviews"]}:
        t = (ROOT / f"{page}.html").read_text(encoding="utf-8")
        for m in re.finditer(r'<article class="testi-card[^"]*">(.*?)</article>', t, re.S):
            b = m.group(1)
            name = re.search(r'class="author-name">(.*?)<', b).group(1).strip()
            text = re.search(r'<p class="testi-text">(.*?)</p>', b, re.S).group(1).strip()
            out[(name, page)] = text
    return out


def shell_parts():
    """Pull the shared pieces from lp-birthday.html so new pages match the live landing pages."""
    t = (ROOT / "lp-birthday.html").read_text(encoding="utf-8")
    verify = re.search(r'  <meta name="google-site-verification"[^>]*>\n', t).group(0)
    # favicon block: .ico, SVG, Apple touch icon, manifest, theme colour
    favicon = re.search(r'(  <link rel="icon"[^>]*>\n)+(  <link rel="apple-touch-icon"[^>]*>\n)?(  <link rel="manifest"[^>]*>\n)?(  <meta name="theme-color"[^>]*>\n)?', t).group(0)
    footer_logo = re.search(r'<footer style="background:var\(--text\);.*?(<img src="images/logo\.svg[^>]*>)', t, re.S).group(1)
    fonts_to_css = t[t.index('  <link rel="preconnect"'):t.index('  <link rel="preload" href="css/style.min.css"')]
    fonts_to_css = fonts_to_css.replace("  </style>\n  </script>\n", "  </style>\n")
    styles = t[t.index('  <link rel="preload" href="css/style.min.css"'):t.index('<noscript><link rel="stylesheet" href="css/style.min.css"></noscript>') + len('<noscript><link rel="stylesheet" href="css/style.min.css"></noscript>')]
    tail_css = re.findall(r'  <link rel="stylesheet" href="css/(?:theme|glass)\.css[^>]*>\n', t)
    header = t[t.index("  <!-- Minimal Header for LP -->"):t.index("  <main>")]
    form = t[t.index('            <form class="js-quote-form" novalidate aria-label="Birthday decoration quote form">'):t.index("          </div>\n        </div>\n      </div>\n    </section>\n\n    <!-- ===== WHAT'S INCLUDED")]
    scripts = t[t.index('  <script src="js/main.min.js'):t.index("</body>")]
    return verify, favicon, fonts_to_css, styles, "".join(tail_css), header, form, scripts, footer_logo


def area_form(form, a):
    f = form.replace('aria-label="Birthday decoration quote form"', f'aria-label="{a["name"]} decoration quote form"')
    f = f.replace('value="New Lead - Birthday Decoration Enquiry"', f'value="New Lead - {a["name"]} Decoration Enquiry"')
    f = f.replace('value="Flowers N Balloons - Birthday LP"', f'value="Flowers N Balloons - {a["name"]} page"')
    f = f.replace('<label for="lp-date">Birthday Date', '<label for="lp-date">Event Date')
    f = f.replace('<option selected>Birthday Party</option>', '<option>Birthday Party</option>')  # area pages: no preselected occasion
    f = f.replace('<label for="lp-msg">Birthday Theme / Special Requests</label>', '<label for="lp-msg">Occasion, Theme &amp; Venue</label>')
    f = f.replace('placeholder="E.g. Unicorn theme for 5-year-old, venue: home terrace, 50 guests…"',
                  f'placeholder="E.g. 1st birthday, jungle theme, apartment clubhouse in {a["short"]}, 40 guests…"')
    f = f.replace('data-label="🎂 Get My Free Birthday Quote"', 'data-label="🎈 Get My Free Quote"')
    f = f.replace("🎂 Get My Free Birthday Quote", "🎈 Get My Free Quote")
    f = f.replace("Our birthday decoration team will call you back", "Our decoration team will call you back")
    return f


def jsonld(obj):
    return '  <script type="application/ld+json">\n' + json.dumps(obj, ensure_ascii=False, indent=2) + "\n  </script>\n"


def build():
    verify, favicon, fonts_to_css, styles, tail_css, header, form, scripts, footer_logo = shell_parts()
    reviews = load_reviews()
    by_slug = {a["slug"]: a for a in AREAS}
    occ = {o[0]: o for o in OCCASIONS}
    for a in AREAS:
        name, slug = a["name"], a["slug"]
        page = f"balloon-decoration-{slug}"
        url = f"{SITE}/{page}"
        title = f"Balloon Decoration in {name}, Bangalore | Flowers N Balloons"
        h1 = f"Balloon &amp; Event Decoration in {name}"

        faqs = [
            (f"Do you do balloon decoration at home in {name}?",
             f"Yes. We decorate apartments, independent homes, terraces, clubhouses and party halls across {name} and nearby areas. If you live in a gated community, share your society's rules on vendor entry and timings when you book and we'll plan around them."),
            (f"How much does birthday decoration cost in {name}?",
             f"It depends on the theme, venue size and add-ons you choose. Share your occasion, date and venue in {name} and we'll send a detailed, transparent quote within 2 hours — no hidden charges."),
            a["faq_local"],
            ("How quickly will I get a quote?",
             f"Fill in the form or call {PHONE_TXT} — we respond within 2 hours, 9 AM to 9 PM, all days. WhatsApp is the fastest way to share photos of your space and theme ideas."),
        ]

        schema = [
            {
                "@context": "https://schema.org",
                "@type": "Service",
                "name": f"Balloon & Event Decoration in {name}, Bangalore",
                "serviceType": "Event decoration",
                "url": url,
                "description": a["desc"],
                "provider": {
                    "@type": "LocalBusiness",
                    "name": "Flowers N Balloons",
                    "@id": SITE,
                    "url": SITE,
                    "telephone": PHONE,
                    "image": f"{SITE}/images/logo.png",
                    "priceRange": "₹₹",
                    "address": {
                        "@type": "PostalAddress",
                        "streetAddress": "Sarjapura Main Road",
                        "addressLocality": "Bangalore",
                        "addressRegion": "Karnataka",
                        "postalCode": "562125",
                        "addressCountry": "IN",
                    },
                },
                "areaServed": {
                    "@type": "Place",
                    "name": f"{name}, Bangalore",
                    "geo": {"@type": "GeoCoordinates", "latitude": a["geo"][0], "longitude": a["geo"][1]},
                },
            },
            {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/"},
                    {"@type": "ListItem", "position": 2, "name": "Services", "item": f"{SITE}/services"},
                    {"@type": "ListItem", "position": 3, "name": f"Decoration in {name}", "item": url},
                ],
            },
            {
                "@context": "https://schema.org",
                "@type": "FAQPage",
                "mainEntity": [
                    {"@type": "Question", "name": html.unescape(q), "acceptedAnswer": {"@type": "Answer", "text": html.unescape(ans)}}
                    for q, ans in faqs
                ],
            },
        ]

        popular = [occ[p] for p in a["popular"]] + [o for o in OCCASIONS if o[0] not in a["popular"]]
        feats = "\n".join(
            f'''          <a class="lp-feat" href="/{p}">
            <span class="lp-feat-icon" aria-hidden="true">{ico}</span>
            <span class="lp-feat-text"><strong>{label} in {name}</strong><small>{blurb}</small></span>
          </a>''' for p, ico, label, blurb, price in popular)

        rev_html = []
        for i, (rname, rloc, rpage) in enumerate(a["reviews"]):
            text = reviews[(rname, rpage)]
            delay = f" reveal-delay-{i}" if i else ""
            rev_html.append(f'''          <article class="testi-card reveal{delay}">
            <div class="stars" aria-label="5 out of 5 stars">★★★★★</div>
            <p class="testi-text">{text}</p>
            <div class="testi-author">
              <div class="author-av{'' if i == 0 else f' av{i + 1}'}" aria-hidden="true">{html.unescape(rname)[0]}</div>
              <div>
                <span class="author-name">{rname}</span>
                <span class="author-loc">📍 {rloc}</span>
              </div>
            </div>
          </article>''')

        faq_html = "\n".join(
            f'''          <details style="background:var(--bg-light);border-radius:12px;padding:20px;">
            <summary style="font-weight:600;cursor:pointer;font-size:.975rem;list-style:none;display:flex;justify-content:space-between;align-items:center;">{q} <span aria-hidden="true">＋</span></summary>
            <p style="margin-top:12px;font-size:.9rem;">{ans}</p>
          </details>''' for q, ans in faqs)

        nearby = " ".join(
            f'<a class="svc-tag" href="/balloon-decoration-{n}">Decoration in {by_slug[n]["name"]}</a>' for n in a["nearby"])
        localities = ", ".join(a["localities"])
        about = "\n".join(f'          <p style="margin-bottom:14px;">{p}</p>' for p in a["about"])
        wa_text = f"Hi%2C+I+want+decoration+in+{name.replace(' ', '+')}%2C+Bangalore"

        out = f'''<!DOCTYPE html>
<html lang="en-IN">
<head>
{verify}{favicon}  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="{a["desc"]}">
  <meta name="author" content="Flowers N Balloons">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="{url}">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{a["desc"]}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{SITE}/images/og-image.jpg">
  <meta property="og:locale" content="en_IN">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{title}">
  <meta name="twitter:description" content="{a["desc"]}">
  <meta name="geo.region" content="IN-KA">
  <meta name="geo.placename" content="{name}, Bangalore">
  <title>{title}</title>

{fonts_to_css}  {styles}

{"".join(jsonld(s) for s in schema)}{tail_css}</head>
<body>

{header}  <main>
    <!-- ===== AREA HERO ===== -->
    <section class="lp-hero" aria-label="Decoration in {name} hero">
      <div class="container">
        <div class="lp-hero-grid">
          <div class="lp-hero-content">
            <nav aria-label="Breadcrumb" class="breadcrumb" style="font-size:.8rem;margin-bottom:14px;justify-content:flex-start;text-align:left;">
              <a href="/">Home</a> <span class="breadcrumb-sep">/</span> <a href="/services">Services</a> <span class="breadcrumb-sep">/</span> <span class="breadcrumb-cur">{name}</span>
            </nav>
            <h1>{h1}</h1>
            <p style="color:rgba(255,255,255,.9);font-size:1.05rem;margin-bottom:22px;">{a["intro"]}</p>
            <div class="lp-trust-pills">
              <span class="lp-pill">📍 {a["short"]} &amp; nearby</span>
              <span class="lp-pill">✅ No Hidden Charges</span>
              <span class="lp-pill">⚡ 2-Hour Response</span>
              <span class="lp-pill">🎈 Since 2015</span>
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;">
              <a href="#lp-form" class="btn btn-white btn-lg">🎊 Get Free Quote</a>
              <a href="tel:{PHONE}" class="btn btn-outline-white btn-lg">📞 Call Now</a>
            </div>
          </div>
          <div class="lp-form-card" id="lp-form">
            <h2>Get Your Free Quote in {a["short"]}</h2>
            <p>Free quote in 2 hours. No obligation.</p>
{area_form(form, a)}          </div>
        </div>
      </div>
    </section>

    <!-- ===== OCCASIONS ===== -->
    <section class="section bg-light" aria-labelledby="occ-heading">
      <div class="container">
        <h2 class="section-title" id="occ-heading">Decorations We Set Up in {name}</h2>
        <p class="section-sub">Every occasion, one team — tap a service for themes, inclusions and packages</p>
        <div class="lp-features-grid">
{feats}
        </div>
      </div>
    </section>

    <!-- ===== LOCAL ===== -->
    <section class="section" aria-labelledby="local-heading">
      <div class="container" style="max-width:860px;">
        <h2 class="section-title" id="local-heading">Celebrating in {name}</h2>
        <div style="margin-top:28px;">
{about}
          <p style="margin-bottom:0;"><strong>Areas we cover in and around {name}:</strong> {localities}.</p>
        </div>
      </div>
    </section>

    <!-- ===== REVIEWS ===== -->
    <section class="section bg-light" aria-labelledby="reviews-heading">
      <div class="container">
        <h2 class="section-title" id="reviews-heading">What {name} Customers Say</h2>
        <p class="section-sub">Real reviews from families and teams in {name}</p>
        <div class="testimonials-grid">
{chr(10).join(rev_html)}
        </div>
      </div>
    </section>

    <!-- ===== FAQ ===== -->
    <section class="section" aria-labelledby="faq-heading">
      <div class="container" style="max-width:800px;">
        <h2 class="section-title" id="faq-heading">Decoration in {name}: FAQs</h2>
        <div style="display:grid;gap:16px;margin-top:28px;">
{faq_html}
        </div>
      </div>
    </section>

    <!-- ===== NEARBY ===== -->
    <section class="section-sm" aria-labelledby="nearby-heading">
      <div class="container" style="text-align:center;">
        <h2 class="section-title" id="nearby-heading" style="font-size:1.4rem;">We Also Decorate Nearby</h2>
        <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:24px;">
          {nearby} <a class="svc-tag" href="/services">All services</a>
        </div>
      </div>
    </section>

    <section class="section-sm bg-light" aria-label="Quick contact">
      <div class="container">
        <div style="display:flex;align-items:center;justify-content:center;gap:20px;flex-wrap:wrap;text-align:center;">
          <div>
            <p style="font-size:1.1rem;font-weight:700;color:var(--text);margin-bottom:4px;">📞 Call Us Directly</p>
            <a href="tel:{PHONE}" style="font-size:1.4rem;font-weight:800;color:var(--primary);">{PHONE_TXT}</a>
          </div>
          <a href="https://wa.me/918867121207?text={wa_text}" target="_blank" rel="noopener"
             style="display:flex;align-items:center;gap:10px;background:#25d366;color:#fff;border-radius:50px;padding:14px 24px;font-weight:600;font-size:1rem;box-shadow:0 4px 16px rgba(37,211,102,.35);">
            💬 WhatsApp for Instant Quote
          </a>
        </div>
        <p style="text-align:center;margin-top:16px;font-size:.85rem;color:var(--text-light);">Open 9 AM – 9 PM, All Days &bull; Serving {name} and all of Bangalore</p>
      </div>
    </section>
  </main>

  <footer style="background:var(--text);padding:24px 0;text-align:center;" role="contentinfo">
    <div class="container">
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;color:#fff;font-weight:700;font-size:1rem;margin-bottom:8px;">
        {footer_logo} Flowers 'N' Balloons
      </div>
      <p style="color:rgba(255,255,255,.5);font-size:.8rem;margin-bottom:8px;">Event Decorators for {name}, Bangalore | Sarjapura Main Road, Bangalore 562125</p>
      <p style="color:rgba(255,255,255,.4);font-size:.75rem;">© 2025 Flowers 'N' Balloons. All rights reserved. &nbsp;|&nbsp; <a href="/" style="color:rgba(255,255,255,.4);">Main Site</a> &nbsp;|&nbsp; <a href="/contact" style="color:rgba(255,255,255,.4);">Contact</a></p>
    </div>
  </footer>

  <a href="https://wa.me/918867121207?text={wa_text}" class="wa-float" target="_blank" rel="noopener" aria-label="Chat on WhatsApp for decoration in {name}">
    <span class="wa-float-icon" aria-hidden="true">💬</span>
    <span class="wa-float-text">WhatsApp Us</span>
  </a>

{scripts}</body>
</html>
'''
        (ROOT / f"{page}.html").write_text(out, encoding="utf-8")
        print("wrote", page + ".html")


if __name__ == "__main__":
    build()
