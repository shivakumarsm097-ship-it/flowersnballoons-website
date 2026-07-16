"""Marketing & Reputation agent test:

  1. IG DM pricing question → direct answer with the right starting price
  2. IG DM booking intent → WhatsApp handoff
  3. IG comment pricing → price IN the reply (no "DM us" detour)
  4. vendor photo intake → attached to their recent event
  5. weekly posting: variety, caption specifics, ≤8 hashtags, tag only with permission
  6. review request +2 days with link; follow-up once at +5 days
  7. negative review reply → dissatisfied, sequence stopped, escalated, no link
  8. positive review reply → reviewed, thanks

Run: .venv/bin/python -m tests.test_marketing
"""
from __future__ import annotations

import asyncio
import os
from datetime import date, datetime, timedelta, timezone

os.environ.setdefault("GOOGLE_REVIEW_LINK", "https://g.page/r/test-review")

from tests.test_chain import TABLES, fake_insert  # noqa: E402  (applies DB fakes)

import modules.marketing.agent as mk  # noqa: E402
from backend.db import client as db  # noqa: E402

mk.REVIEW_LINK = "https://g.page/r/test-review"

WA_SENT: list[tuple[str, str]] = []
IG_DMS: list[tuple[str, str]] = []
IG_REPLIES: list[tuple[str, str]] = []
IG_POSTS: list[tuple[str, str]] = []
ALERTS: list[str] = []


async def fake_wa(to, text):
    WA_SENT.append((to, text))


async def fake_dm(rid, text):
    IG_DMS.append((rid, text))


async def fake_reply(cid, text):
    IG_REPLIES.append((cid, text))


async def fake_publish(url, caption):
    IG_POSTS.append((url, caption))
    return f"igm_{len(IG_POSTS)}"


async def fake_slack(text):
    ALERTS.append(text)


mk.send_whatsapp = fake_wa
mk.send_instagram_dm = fake_dm
mk.reply_instagram_comment = fake_reply
mk.publish_instagram_post = fake_publish
mk.slack_alert = fake_slack


def iso_ago(**kw):
    return (datetime.now(timezone.utc) - timedelta(**kw)).isoformat()


async def main():
    # ── 1. DM pricing question → direct answer ──
    await mk.handle_ig_dm("igu_1", "how much for a haldi ceremony?")
    assert "₹7,000" in IG_DMS[-1][1], "haldi starting price answered directly"

    # ── 2. DM booking intent → WhatsApp handoff ──
    await mk.handle_ig_dm("igu_2", "can I book you for 2026-09-12?")
    assert "wa.me" in IG_DMS[-1][1], "booking intent → WhatsApp"

    # ── 3. comment pricing → answered IN the reply ──
    await mk.handle_ig_comment("igc_1", "price for birthday decor?")
    assert "₹4,500" in IG_REPLIES[-1][1], "price in the comment reply, not a DM-us deflection"

    # ── 4. vendor photo intake ──
    lead = await fake_insert("leads", {"source": "web", "phone": "+919111111111", "name": "Priya"})
    vendor = await fake_insert("vendors", {"name": "Ravi", "role": "decorator", "contact": "+919000000001", "service_areas": []})
    recent = await fake_insert("bookings", {
        "lead_id": lead["id"], "date": (date.today() - timedelta(days=1)).isoformat(),
        "event_type": "babyshower", "location": "Koramangala", "status": "done",
    })
    await fake_insert("vendor_assignments", {"booking_id": recent["id"], "vendor_id": vendor["id"], "role": "decorator", "status": "accepted"})
    await mk.intake_vendor_photo(vendor, "wamid_photo_1")
    assert TABLES["event_photos"][-1]["booking_id"] == recent["id"], "photo attached to the recent event"
    assert "thank you" in WA_SENT[-1][1].lower()

    # ── 5. weekly posting: variety + caption + permission gating ──
    TABLES["event_photos"][-1]["url"] = "https://storage.example/p1.jpg"  # publicly hosted now
    lead2 = await fake_insert("leads", {"source": "web", "phone": "+919222222222", "name": "Arjun"})
    b2 = await fake_insert("bookings", {
        "lead_id": lead2["id"], "date": (date.today() - timedelta(days=2)).isoformat(),
        "event_type": "babyshower", "location": "HSR", "status": "done",
    })
    await fake_insert("event_photos", {"booking_id": b2["id"], "vendor_id": vendor["id"], "url": "https://storage.example/p2.jpg"})
    b3 = await fake_insert("bookings", {
        "lead_id": lead["id"], "date": (date.today() - timedelta(days=3)).isoformat(),
        "event_type": "birthday", "location": "Indiranagar", "status": "done", "tag_permission": True,
    })
    await fake_insert("event_photos", {"booking_id": b3["id"], "vendor_id": vendor["id"], "url": "https://storage.example/p3.jpg"})

    await mk.weekly_posting()
    assert len(IG_POSTS) == 2, "1-2 posts per week"
    types_posted = set()
    for _, caption in IG_POSTS:
        assert caption.count("#") <= 8, "5-8 hashtags, not 30"
        for t in ("Baby Shower", "Birthday"):
            if t in caption:
                types_posted.add(t)
    assert len(types_posted) == 2, "variety: two different event types, not two baby showers"
    birthday_caption = next(c for _, c in IG_POSTS if "Birthday" in c)
    assert "Priya" in birthday_caption, "tag_permission=True → customer named"
    babyshower_caption = next(c for _, c in IG_POSTS if "Baby Shower" in c)
    assert "Arjun" not in babyshower_caption, "no permission → never named"
    assert "Indiranagar" in birthday_caption, "caption is specific (locality)"

    # ── 6. review request +2 days, follow-up once at +5 days ──
    lead6 = await fake_insert("leads", {"source": "web", "phone": "+919666666666", "name": "Meera"})
    b6 = await fake_insert("bookings", {
        "lead_id": lead6["id"], "date": (date.today() - timedelta(days=2)).isoformat(),
        "event_type": "engagement", "status": "done",
    })
    await mk.send_review_requests()
    assert "g.page" in WA_SENT[-1][1] and b6["review_requested_at"], "request +2d with link"
    n = len(WA_SENT)
    await mk.send_review_requests()
    assert len(WA_SENT) == n, "request sent exactly once"

    b6["review_requested_at"] = iso_ago(days=6)
    await mk.send_review_followups()
    assert b6["review_followup_sent"] is True and b6["review_outcome"] == "no_response"
    n = len(WA_SENT)
    await mk.send_review_followups()
    assert len(WA_SENT) == n, "never a third message"

    # ── 7. negative reply → dissatisfied, escalated, no link ──
    lead7 = await fake_insert("leads", {"source": "web", "phone": "+919777777777"})
    b7 = await fake_insert("bookings", {
        "lead_id": lead7["id"], "date": (date.today() - timedelta(days=2)).isoformat(),
        "event_type": "birthday", "status": "done", "review_requested_at": iso_ago(hours=2),
    })
    handled = await mk.handle_review_reply(b7, lead7, "honestly the team was late and the arch was broken")
    assert handled and b7["review_outcome"] == "dissatisfied"
    assert "g.page" not in WA_SENT[-1][1], "no review link for a dissatisfied customer"
    assert any("DISSATISFIED" in a for a in ALERTS), "escalated to resolution"

    # ── 8. positive reply → reviewed ──
    lead8 = await fake_insert("leads", {"source": "web", "phone": "+919888888888"})
    b8 = await fake_insert("bookings", {
        "lead_id": lead8["id"], "date": (date.today() - timedelta(days=2)).isoformat(),
        "event_type": "haldi", "status": "done", "review_requested_at": iso_ago(hours=2),
    })
    assert await mk.handle_review_reply(b8, lead8, "done, posted the review!")
    assert b8["review_outcome"] == "reviewed"

    print("ALL MARKETING TESTS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
