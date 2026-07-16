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
from backend.notify import send_whatsapp, slack_alert
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


# ── candidate selection ───────────────────────────────────────────────
async def _candidates(booking: dict[str, Any], role: str) -> list[dict[str, Any]]:
    """Active vendors for the role who service the location, aren't already
    committed on that date, and haven't already been asked for this
    booking+role. Least-loaded first so requests rotate across the roster."""
    vendors = await db.active_vendors(role)

    location = (booking.get("location") or "").strip().lower()
    if location:
        vendors = [
            v for v in vendors
            if not v.get("service_areas")  # empty list = serves everywhere
            or any(location in a.lower() or a.lower() in location for a in v["service_areas"])
        ]

    busy = await db.vendor_ids_busy_on(date.fromisoformat(booking["date"]))
    tried = {a["vendor_id"] for a in await db.assignments_for_booking_role(booking["id"], role)}
    vendors = [v for v in vendors if v["id"] not in busy and v["id"] not in tried]

    loads: list[tuple[int, dict]] = []
    for v in vendors:
        open_jobs = await db._get(  # noqa: SLF001 — internal helper reuse
            "vendor_assignments",
            {"vendor_id": f"eq.{v['id']}", "status": "in.(requested,accepted)"},
        )
        loads.append((len(open_jobs), v))
    loads.sort(key=lambda t: t[0])
    return [v for _, v in loads]


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
