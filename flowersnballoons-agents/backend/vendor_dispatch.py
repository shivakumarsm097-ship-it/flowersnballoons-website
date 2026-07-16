"""Vendor & Staff Coordination — deterministic core.

A payment isn't a delivered event: a human still has to show up. This
module gets vendors committed within minutes of payment and makes sure
someone knows immediately when that isn't happening.

Triggered directly by the Razorpay webhook (never cron-first). Cron
covers only what needs the passage of time: response timeouts, event
reminders, weekly decline analytics.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from typing import Any

from backend.db import client as db
from backend.notify import send_owner_alert, send_whatsapp, slack_alert
from orchestrator.logger import log_action

ESCALATION_HOURS = float(os.environ.get("VENDOR_ESCALATION_HOURS", "24"))
VENDOR_PAY_PERCENT = float(os.environ.get("VENDOR_PAY_PERCENT", "0.40"))


# ── role requirements: event type + package tier ──────────────────────
def required_roles(event_type: str, package: str | None = None) -> list[str]:
    """Base: every event needs a decorator. Premium tiers add photographer
    + activity staff; anything mentioning catering adds a caterer."""
    roles = ["decorator"]
    p = (package or "").lower()
    if any(t in p for t in ("premium", "grand", "royal")):
        roles += ["photographer", "activity-staff"]
    if "cater" in p:
        roles.append("caterer")
    return roles


# ── response windows (per-vendor, distance-scaled) ────────────────────
def response_window_hours(event_date_iso: str) -> float:
    days_out = (date.fromisoformat(event_date_iso) - date.today()).days
    if days_out > 14:
        return 48.0
    if days_out >= 3:
        return 24.0
    return 4.0


def is_imminent(event_date_iso: str) -> bool:
    return (date.fromisoformat(event_date_iso) - date.today()).days < 3


# kept for cron's booking-level safety net
def escalation_window_hours(event_date_iso: str) -> float:
    days_out = (date.fromisoformat(event_date_iso) - date.today()).days
    if days_out <= 7:
        return min(ESCALATION_HOURS, 12.0)
    if days_out <= 30:
        return ESCALATION_HOURS
    return ESCALATION_HOURS * 2


# ── reliability scoring ───────────────────────────────────────────────
# on-time performance and complaint history weigh more than raw accept rate
SCORE_WEIGHTS = {"accept": 0.25, "on_time": 0.45, "complaints": 0.30}
ROTATION_BAND = 5.0  # candidates within this many points of the top rotate


def compute_reliability(accept_rate: float | None, on_time_rate: float | None, complaint_count: int) -> float:
    a = accept_rate if accept_rate is not None else 0.8   # neutral prior for new vendors
    o = on_time_rate if on_time_rate is not None else 1.0
    c = max(0.0, 1.0 - 0.2 * complaint_count)
    return round(100 * (SCORE_WEIGHTS["accept"] * a + SCORE_WEIGHTS["on_time"] * o + SCORE_WEIGHTS["complaints"] * c), 1)


async def recompute_reliability(vendor_id: str) -> float:
    """Rolling window of the last ~15 jobs — one bad event doesn't
    permanently tank an otherwise reliable vendor."""
    window = await db.recent_assignments_for_vendor(vendor_id, 15)
    accept_rate = on_time_rate = None
    if window:
        accepted = [a for a in window if a["status"] == "accepted"]
        accept_rate = len(accepted) / len(window)
        judged = [a for a in accepted if a.get("arrived_on_time") is not None]
        if judged:
            on_time_rate = sum(1 for a in judged if a["arrived_on_time"]) / len(judged)
    vendor = next((v for v in await db.active_vendors() if v["id"] == vendor_id), None)
    complaints = (vendor or {}).get("complaint_count") or 0
    score = compute_reliability(accept_rate, on_time_rate, complaints)
    await db.set_vendor(vendor_id, accept_rate=accept_rate, on_time_rate=on_time_rate, reliability_score=score)
    log_action("vendor_coordination", actions_taken=[f"reliability recomputed for {(vendor or {}).get('name', vendor_id)}: {score} (window {len(window)} jobs)"])
    return score


# ── candidate selection ───────────────────────────────────────────────
async def _candidates(booking: dict[str, Any], role: str) -> list[dict[str, Any]]:
    """Active vendors for the role who service the location, have day
    capacity left (max_events_per_day, not a hardcoded one), and haven't
    already been asked for this booking+role. Ranked reliability-score
    first, proximity (exact area match) second; candidates within
    ROTATION_BAND points of the top rotate by least-loaded."""
    vendors = await db.active_vendors(role)

    location = (booking.get("location") or "").strip().lower()
    if location:
        vendors = [
            v for v in vendors
            if not v.get("service_areas")  # empty list = serves everywhere
            or any(location in a.lower() or a.lower() in location for a in v["service_areas"])
        ]

    d = date.fromisoformat(booking["date"])
    tried = {a["vendor_id"] for a in await db.assignments_for_booking_role(booking["id"], role)}

    eligible: list[dict[str, Any]] = []
    for v in vendors:
        if v["id"] in tried:
            continue
        if await db.accepted_count_for_vendor_on(v["id"], d) >= (v.get("max_events_per_day") or 1):
            continue  # per-vendor daily capacity, not one-per-day for everyone
        eligible.append(v)
    if not eligible:
        return []

    def proximity(v: dict) -> int:  # exact-area vendors ahead of serve-everywhere ones
        if location and v.get("service_areas") and any(location in a.lower() or a.lower() in location for a in v["service_areas"]):
            return 0
        return 1

    def score(v: dict) -> float:
        s = v.get("reliability_score")
        return s if s is not None else compute_reliability(v.get("accept_rate"), v.get("on_time_rate"), v.get("complaint_count") or 0)

    eligible.sort(key=lambda v: (-score(v), proximity(v)))

    # rotation: within ROTATION_BAND of the top, least-loaded goes first so
    # near-equal vendors share the work instead of the top scorer taking all
    top = score(eligible[0])
    band = [v for v in eligible if top - score(v) <= ROTATION_BAND]
    rest = [v for v in eligible if top - score(v) > ROTATION_BAND]
    loads: list[tuple[int, int, dict]] = []
    for i, v in enumerate(band):
        open_jobs = await db._get(  # noqa: SLF001 — internal helper reuse
            "vendor_assignments",
            {"vendor_id": f"eq.{v['id']}", "status": "in.(requested,accepted)"},
        )
        loads.append((len(open_jobs), i, v))
    loads.sort(key=lambda t: (t[0], t[1]))
    return [v for _, _, v in loads] + rest


def _job_brief(booking: dict[str, Any], role: str) -> str:
    pay = ""
    if booking.get("total_price"):
        est = round(booking["total_price"] * VENDOR_PAY_PERCENT / 100) * 100
        pay = f"\n💰 Expected pay: ~₹{est:,}"
    return (
        f"New job — {booking['event_type']}"
        f"{' (' + booking['package'] + ')' if booking.get('package') else ''}\n"
        f"📅 {booking['date']}\n"
        f"📍 {booking.get('location') or 'Bangalore (location to confirm)'}\n"
        f"🎭 Role: {role}{pay}\n\n"
        f"Reply YES {booking['id'][:8]} to accept or NO {booking['id'][:8]} to decline."
    )


async def _request_vendor(booking: dict[str, Any], role: str, vendor: dict[str, Any]) -> None:
    await db.create_assignment(booking["id"], vendor["id"], role)
    await send_whatsapp(vendor["contact"], _job_brief(booking, role))
    log_action("vendor_coordination", actions_taken=[f"requested {role} {vendor['name']} for booking {booking['id']}"])


async def _escalate_role_exhausted(booking: dict[str, Any], role: str) -> None:
    """Roster exhausted without an accept — the customer-facing
    refund/reschedule conversation starts NOW, regardless of time left."""
    log_action(
        "vendor_coordination",
        actions_skipped_or_escalated=[f"roster EXHAUSTED for {role} on booking {booking['id']} — escalating to booking_payment"],
    )
    await send_owner_alert(
        f"Roster EXHAUSTED: no {role} available for {booking['event_type']} on {booking['date']} "
        f"(booking {booking['id'][:8]}). Customer is being offered refund/reschedule."
    )
    from modules.booking_payment.agent import mark_at_risk_and_notify
    await mark_at_risk_and_notify(booking, [role], f"roster exhausted for {role}")


# ── dispatch (fired by the payment webhook) ───────────────────────────
async def dispatch_for_booking(booking: dict[str, Any]) -> None:
    for role in required_roles(booking["event_type"], booking.get("package")):
        candidates = await _candidates(booking, role)
        if not candidates:
            await _escalate_role_exhausted(booking, role)
            continue
        await _request_vendor(booking, role, candidates[0])


# ── vendor replies (routed from the WhatsApp webhook) ─────────────────
async def handle_vendor_reply(vendor: dict[str, Any], text: str) -> bool:
    parts = text.strip().lower().split()
    if len(parts) != 2 or parts[0] not in ("yes", "no", "cancel"):
        await send_whatsapp(
            vendor["contact"],
            "Reply YES <booking-id> to accept, NO <booking-id> to decline, or CANCEL <booking-id> if you must drop an accepted job.",
        )
        return True

    answer, prefix = parts[0], parts[1]
    want_status = "accepted" if answer == "cancel" else "requested"
    rows = await db._get(  # noqa: SLF001
        "vendor_assignments",
        {"vendor_id": f"eq.{vendor['id']}", "status": f"eq.{want_status}"},
    )
    match = next((r for r in rows if r["booking_id"].startswith(prefix)), None)
    if not match:
        await send_whatsapp(vendor["contact"], f"No open {want_status} job matching '{prefix}' — maybe already handled.")
        return True

    booking = await db.get_booking(match["booking_id"])

    if answer == "yes":
        await db.set_assignment_status(match["id"], "accepted")
        await recompute_reliability(vendor["id"])
        tta = _time_to_assignment(booking)
        log_action("vendor_coordination", actions_taken=[f"{vendor['name']} accepted {match['role']} for booking {match['booking_id']} (time-to-assignment {tta})"])
        await send_whatsapp(
            vendor["contact"],
            f"Locked in — you're on for {booking['date'] if booking else 'the event'} "
            f"({booking.get('location') or 'location to confirm'}). Full details 48h before. 🎈",
        )
        if booking:
            await _maybe_confirm_booking(booking)
        return True

    # NO on a request, or CANCEL on an accepted job
    await db.set_assignment_status(match["id"], "declined")
    await recompute_reliability(vendor["id"])
    verb = "cancelled (after accepting)" if answer == "cancel" else "declined"
    log_action("vendor_coordination", actions_taken=[f"{vendor['name']} {verb} {match['role']} for booking {match['booking_id']}"])
    await send_whatsapp(vendor["contact"], "Noted — thanks for telling me quickly.")

    if not booking:
        return True

    if answer == "cancel":
        # spec: accept-then-cancel near the event = same urgency as a fresh
        # assignment, never a background task
        await slack_alert(
            f"🚨 {vendor['name']} CANCELLED accepted {match['role']} for booking {booking['id']} "
            f"(event {booking['date']}) — re-dispatching with urgency."
        )
        await send_owner_alert(
            f"{vendor['name']} CANCELLED their accepted {match['role']} job for {booking['date']} "
            f"(booking {booking['id'][:8]}). Re-dispatching now."
        )
        if booking["status"] == "confirmed":
            await db.set_booking(booking["id"], status="pending_vendors", confirmed_at=None)
            booking["status"] = "pending_vendors"

    candidates = await _candidates(booking, match["role"])
    if candidates:
        await _request_vendor(booking, match["role"], candidates[0])
    else:
        await _escalate_role_exhausted(booking, match["role"])
    return True


def _time_to_assignment(booking: dict[str, Any] | None) -> str:
    if not booking:
        return "unknown"
    try:
        created = datetime.fromisoformat(booking["created_at"].replace("Z", "+00:00"))
        delta = datetime.now(timezone.utc) - created
        return f"{delta.total_seconds() / 3600:.1f}h"
    except Exception:
        return "unknown"


async def _maybe_confirm_booking(booking: dict[str, Any]) -> None:
    """Fully confirm to the customer only when EVERY required role has an
    accepted assignment."""
    if booking["status"] == "confirmed":
        return
    assignments = await db.assignments_for_booking(booking["id"])
    accepted_roles = {a["role"] for a in assignments if a["status"] == "accepted"}
    if not set(required_roles(booking["event_type"], booking.get("package"))).issubset(accepted_roles):
        return

    await db.set_booking(booking["id"], status="confirmed", confirmed_at=datetime.now(timezone.utc).isoformat())
    booking["status"] = "confirmed"
    lead = await db.get_lead(booking["lead_id"])
    if lead and lead.get("phone"):
        await send_whatsapp(
            lead["phone"],
            f"Great news! Your {booking['event_type']} on {booking['date']} is fully confirmed — "
            f"our team is locked in. See you there! 🎈",
        )
    log_action("vendor_coordination", actions_taken=[f"booking {booking['id']} fully confirmed to customer"])
    await slack_alert(f"✅ Booking {booking['id']} fully confirmed (all roles accepted).")


# ── cron-driven: timeouts, reminders, analytics ───────────────────────
async def advance_stale_assignments() -> None:
    """Per-vendor response timeout (48/24/4h by event distance). Timed-out
    request → no_response → next candidate. Imminent events (<3 days)
    escalate immediately on the first blown window instead of quietly
    cycling the roster."""
    now = datetime.now(timezone.utc)
    for a in await db.all_requested_assignments():
        booking = await db.get_booking(a["booking_id"])
        if not booking or booking["status"] not in ("pending_vendors", "at_risk"):
            continue
        window = response_window_hours(booking["date"])
        requested_at = datetime.fromisoformat(a["requested_at"].replace("Z", "+00:00"))
        if now - requested_at < timedelta(hours=window):
            continue

        await db.set_assignment_status(a["id"], "no_response")
        await recompute_reliability(a["vendor_id"])
        vendor = next((v for v in await db.active_vendors() if v["id"] == a["vendor_id"]), None)
        log_action("vendor_coordination", actions_taken=[f"{(vendor or {}).get('name', a['vendor_id'])} timed out ({window}h) on {a['role']} for booking {a['booking_id']}"])

        if is_imminent(booking["date"]):
            # don't wait out another cycle when the event is days away
            from modules.booking_payment.agent import mark_at_risk_and_notify
            await mark_at_risk_and_notify(booking, [a["role"]], f"vendor timeout with event <3 days out")

        candidates = await _candidates(booking, a["role"])
        if candidates:
            await _request_vendor(booking, a["role"], candidates[0])
        else:
            await _escalate_role_exhausted(booking, a["role"])


async def vendor_reminders() -> None:
    """48h before the event and again the morning of."""
    for offset, tag in ((2, "in 2 days"), (0, "TODAY")):
        d = date.today() + timedelta(days=offset)
        for a in await db.accepted_assignments_for_event_date(d):
            vendor = next((v for v in await db.active_vendors() if v["id"] == a["vendor_id"]), None)
            if not vendor:
                continue
            b = a["booking"]
            try:
                photo_ask = " After the setup, send 2-3 photos of the finished work here 📸 — we feature the best ones." if tag == "TODAY" else ""
                await send_whatsapp(
                    vendor["contact"],
                    f"Reminder: your {a['role']} job is {tag} — {b['event_type']} on {b['date']}, "
                    f"{b.get('location') or 'Bangalore'}. Any problem, reply CANCEL {b['id'][:8]} "
                    f"NOW so we can cover it — not on the day. 🎈{photo_ask}",
                )
                log_action("vendor_coordination", actions_taken=[f"reminder ({tag}) to {vendor['name']} for booking {b['id']}"])
            except Exception as e:
                log_action("vendor_coordination", errors=[f"reminder failed for assignment {a['id']}: {e}"])


async def weekly_decline_summary() -> None:
    """Rising declines per vendor → pricing or reliability signal."""
    declines = await db.declines_since(7)
    if not declines:
        return
    counts: dict[str, int] = {}
    for a in declines:
        counts[a["vendor_id"]] = counts.get(a["vendor_id"], 0) + 1
    vendors = {v["id"]: v for v in await db.active_vendors()}
    lines = [
        f"• {vendors.get(vid, {}).get('name', vid)}: {n} decline/timeout(s)"
        for vid, n in sorted(counts.items(), key=lambda t: -t[1])
    ]
    await slack_alert("📊 Weekly vendor declines (repeat offenders may need pricing/reliability review):\n" + "\n".join(lines))
    log_action("vendor_coordination", actions_taken=["weekly decline summary sent"])
