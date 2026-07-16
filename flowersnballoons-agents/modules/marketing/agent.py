"""Marketing & Reputation agent — deterministic runtime.

No money, no vendor commitments — but the same discipline: never tag a
customer without explicit permission, never ask a dissatisfied customer
for a public review, never nag past the one follow-up.
"""
from __future__ import annotations

import os
import re

from backend import catalog
from backend.db import client as db
from backend.notify import (
    instagram_media_insights,
    publish_instagram_post,
    reply_instagram_comment,
    send_instagram_dm,
    send_whatsapp,
    slack_alert,
)
from orchestrator.logger import log_action

REVIEW_LINK = os.environ.get("GOOGLE_REVIEW_LINK", "")
WA_LINK = "https://wa.me/918867121207"

HASHTAGS = "#bangaloreevents #balloondecorbangalore #eventdecor #flowersnballoons #bangaloreparty"

# ── inbound Instagram: answer directly, hand off real intent ──────────
_PRICE_Q = re.compile(r"\b(price|cost|charge|how much|rate|budget|package)\b", re.I)
_BOOKING_INTENT = re.compile(
    r"\b(book|available|availability|\d{1,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|next (week|month)|this (weekend|month)|\d{4}-\d{2}-\d{2})\b",
    re.I,
)

_NEGATIVE = re.compile(
    r"\b(bad|worst|terrible|poor|disappoint\w*|late|didn'?t (show|come|turn)|no.?show|broken|damag\w*|rude|waste|angry|upset|unhappy|not (happy|good|great)|refund|complain\w*)\b",
    re.I,
)
_REVIEWED = re.compile(r"\b(done|posted|left (a )?review|reviewed|will do|sure|of course|👍|❤️|ok(ay)?)\b", re.I)


def _event_type_from_text(text: str) -> str | None:
    t = text.lower()
    for key in catalog.STARTING_PRICES:
        if key in t.replace(" ", ""):
            return key
    aliases = {"baby shower": "babyshower", "naming": "namingceremony", "welcome": "babywelcome",
               "house warming": "housewarming", "corporate": "corporate"}
    for phrase, key in aliases.items():
        if phrase in t:
            return key
    return None


def _pricing_answer(text: str) -> str:
    etype = _event_type_from_text(text)
    if etype:
        return (
            f"{catalog.LABELS[etype]} starts from ₹{catalog.STARTING_PRICES[etype]:,} — "
            f"final quote depends on guest count, theme and add-ons. "
            f"WhatsApp us for a quick exact quote: {WA_LINK} 🎈"
        )
    return (
        f"Our decor packages start from ₹{min(catalog.STARTING_PRICES.values()):,} "
        f"(birthday from ₹{catalog.STARTING_PRICES['birthday']:,}, wedding from "
        f"₹{catalog.STARTING_PRICES['wedding']:,}). WhatsApp us for an exact quote: {WA_LINK} 🎈"
    )


async def handle_ig_dm(sender_id: str, text: str) -> None:
    """General Q → answer directly; real booking intent → WhatsApp handoff."""
    if _BOOKING_INTENT.search(text):
        reply = (
            "Sounds like you have a date in mind — wonderful! 🎈 Let's plan it properly on "
            f"WhatsApp (dates, packages, instant quote): {WA_LINK}"
        )
        outcome = "handed off to lead_quote (booking intent)"
    elif _PRICE_Q.search(text):
        reply = _pricing_answer(text)
        outcome = "answered pricing directly"
    else:
        reply = (
            "Thanks for reaching out! 🎈 We do birthdays, weddings, baby showers, haldi, "
            f"corporate events and more, across Bangalore. Anything specific? Or WhatsApp us: {WA_LINK}"
        )
        outcome = "answered general question"
    try:
        await send_instagram_dm(sender_id, reply)
        log_action("marketing", actions_taken=[f"IG DM {outcome}"])
    except Exception as e:
        log_action("marketing", errors=[f"IG DM reply failed: {e}"])


async def handle_ig_comment(comment_id: str, text: str) -> None:
    """Warm brief reply; pricing questions answered IN the reply — an engaged
    commenter shouldn't be sent on a 'DM us' detour."""
    if _PRICE_Q.search(text):
        reply = _pricing_answer(text)
        outcome = "answered pricing in comment reply"
    else:
        reply = f"Thank you! 🎈 We'd love to decorate for you — WhatsApp {WA_LINK} anytime."
        outcome = "warm comment reply"
    try:
        await reply_instagram_comment(comment_id, reply)
        log_action("marketing", actions_taken=[f"IG comment {outcome}"])
    except Exception as e:
        log_action("marketing", errors=[f"IG comment reply failed: {e}"])


# ── weekly posting ─────────────────────────────────────────────────────
def _caption(booking: dict, lead: dict | None) -> str:
    label = catalog.LABELS.get(booking["event_type"], booking["event_type"].title())
    where = f" in {booking['location']}" if booking.get("location") else " in Bangalore"
    who = ""
    if booking.get("tag_permission") and lead and lead.get("name"):
        who = f" for {lead['name']}"
    package = f" — {booking['package']} package" if booking.get("package") else ""
    return (
        f"{label}{who}{where}{package} 🎈\n\n"
        f"Planning a celebration? We'd love to make it beautiful — WhatsApp us for a quick quote!\n\n"
        f"{HASHTAGS}"
    )


async def weekly_posting() -> None:
    """Pick 1-2 completed events from the past week worth posting —
    variety over repetition (skip types posted recently)."""
    recent_types = set()
    for p in await db.recent_ig_posts(3):
        if p.get("booking_id"):
            b = await db.get_booking(p["booking_id"])
            if b:
                recent_types.add(b["event_type"])

    candidates = []
    for b in await db.completed_bookings_between(7):
        photos = [p for p in await db.photos_for_booking(b["id"]) if p.get("url")]
        if photos:
            candidates.append((b, photos[0]))

    # variety first: types not posted recently lead the queue
    candidates.sort(key=lambda t: (t[0]["event_type"] in recent_types, t[0]["date"]))

    posted = 0
    seen_types: set[str] = set()
    for booking, photo in candidates:
        if posted >= 2:
            break
        if booking["event_type"] in seen_types:
            continue  # not five birthday posts in a row
        lead = await db.get_lead(booking["lead_id"])
        caption = _caption(booking, lead)
        try:
            media_id = await publish_instagram_post(photo["url"], caption)
            await db.create_ig_post(booking_id=booking["id"], ig_media_id=media_id, caption=caption)
            log_action("marketing", actions_taken=[f"published IG post {media_id} for booking {booking['id']} ({booking['event_type']})"])
            posted += 1
            seen_types.add(booking["event_type"])
        except Exception as e:
            log_action("marketing", errors=[f"IG publish failed for booking {booking['id']}: {e}"])

    if not posted and candidates:
        await slack_alert("⚠️ Weekly posting: candidates existed but nothing published — check IG credentials.")
    elif not candidates:
        log_action("marketing", actions_skipped_or_escalated=["weekly posting skipped — no completed events with public photo URLs this week"])


async def engagement_check() -> None:
    """48h after each post: log likes/comments."""
    for p in await db.unchecked_ig_posts_older_than(48):
        try:
            stats = await instagram_media_insights(p["ig_media_id"])
            await db.set_ig_post(p["id"], engagement_checked=True, likes=stats["likes"], comments=stats["comments"])
            log_action("marketing", actions_taken=[f"post {p['ig_media_id']} 48h engagement: {stats['likes']} likes, {stats['comments']} comments"])
        except Exception as e:
            log_action("marketing", errors=[f"engagement check failed for {p['id']}: {e}"])


# ── review requests ────────────────────────────────────────────────────
async def send_review_requests() -> None:
    """Two days after the event: one thank-you + review link."""
    from datetime import datetime, timezone
    for b in await db.bookings_due_review_request(2):
        lead = await db.get_lead(b["lead_id"])
        if not (lead and lead.get("phone")):
            continue
        link = f"\n\n{REVIEW_LINK}" if REVIEW_LINK else ""
        try:
            await send_whatsapp(
                lead["phone"],
                f"Hope your {b['event_type']} was everything you imagined{', ' + lead['name'] if lead.get('name') else ''}! 🎈\n\n"
                f"If you have a spare minute, a short review would mean the world to our small studio.{link}",
            )
            await db.set_booking(b["id"], review_requested_at=datetime.now(timezone.utc).isoformat())
            log_action("marketing", actions_taken=[f"review request sent for booking {b['id']}"])
        except Exception as e:
            log_action("marketing", errors=[f"review request failed for {b['id']}: {e}"])


async def send_review_followups() -> None:
    """Exactly one follow-up at +5 days. Never a third message."""
    for b in await db.bookings_due_review_followup(5):
        lead = await db.get_lead(b["lead_id"])
        if not (lead and lead.get("phone")):
            continue
        link = f"\n{REVIEW_LINK}" if REVIEW_LINK else ""
        try:
            await send_whatsapp(
                lead["phone"],
                f"Just a gentle last nudge — if you enjoyed your {b['event_type']}, a quick review "
                f"would really help us! Either way, thank you for celebrating with us. 🙏{link}",
            )
            await db.set_booking(b["id"], review_followup_sent=True, review_outcome="no_response")
            log_action("marketing", actions_taken=[f"review follow-up (final) sent for booking {b['id']}"])
        except Exception as e:
            log_action("marketing", errors=[f"review follow-up failed for {b['id']}: {e}"])


async def handle_review_reply(booking: dict, lead: dict, text: str) -> bool:
    """Customer replied after a review request. Negative → NO link, no
    follow-up, escalate to resolution. Positive-ish → thank + mark reviewed."""
    if _NEGATIVE.search(text):
        await db.set_booking(booking["id"], review_outcome="dissatisfied", review_followup_sent=True)
        await send_whatsapp(
            lead["phone"],
            "I'm really sorry to hear that — that's not the experience we want for you. "
            "Tell me what went wrong and I'll make it right personally. 🙏",
        )
        await slack_alert(
            f"⚠️ DISSATISFIED customer on booking {booking['id']} ({lead.get('phone')}): "
            f"\"{text[:200]}\" — review link withheld, needs resolution."
        )
        log_action(
            "marketing",
            actions_skipped_or_escalated=[f"booking {booking['id']} flagged dissatisfied — review sequence stopped, escalated to resolution"],
        )
        # feed the reliability loop: complaint lands on the vendors who worked it
        from backend.vendor_dispatch import recompute_reliability
        for a in await db.assignments_for_booking(booking["id"]):
            if a["status"] == "accepted":
                await db.increment_vendor_complaints(a["vendor_id"])
                await db.set_assignment(a["id"], arrived_on_time=False)
                await recompute_reliability(a["vendor_id"])
        return True
    if _REVIEWED.search(text):
        await db.set_booking(booking["id"], review_outcome="reviewed", review_followup_sent=True)
        await send_whatsapp(lead["phone"], "Thank you so much — it genuinely helps our small studio! 🎈")
        log_action("marketing", actions_taken=[f"booking {booking['id']} review outcome: reviewed"])
        return True
    return False


# ── vendor photo intake (from the WhatsApp webhook) ───────────────────
async def intake_vendor_photo(vendor: dict, wa_media_id: str) -> None:
    """Vendor sent an image — attach it to their most recent event."""
    from datetime import date, timedelta
    assignments = await db._get(  # noqa: SLF001
        "vendor_assignments",
        {"vendor_id": f"eq.{vendor['id']}", "status": "eq.accepted"},
    )
    best = None
    for a in assignments:
        b = await db.get_booking(a["booking_id"])
        if b and date.today() - timedelta(days=7) <= date.fromisoformat(b["date"]) <= date.today():
            if not best or b["date"] > best["date"]:
                best = b
    if not best:
        await send_whatsapp(vendor["contact"], "Got the photo, but I couldn't match it to a recent event — which booking is it for?")
        return
    await db.add_event_photo(best["id"], vendor["id"], wa_media_id)
    await send_whatsapp(vendor["contact"], "Beautiful — thank you! 📸 Saved for the portfolio.")
    log_action("marketing", actions_taken=[f"photo received from {vendor['name']} for booking {best['id']}"])
