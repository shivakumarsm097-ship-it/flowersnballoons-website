"""Vendor Coordination — deterministic core.

dispatch_for_booking() is called DIRECTLY by the Razorpay webhook the
moment payment lands (webhook-to-webhook chain, spec §4.3 — never wait
for cron). Vendor replies arrive via the WhatsApp webhook and route to
handle_vendor_reply().

Required roles per event type live in ROLE_REQUIREMENTS; the escalation
window and capacity rule are documented in
modules/vendor_coordination/AGENT.md and enforced by orchestrator/cron.py.
"""
from __future__ import annotations

import os
from typing import Any

from backend.db import client as db
from backend.notify import send_whatsapp, slack_alert
from orchestrator.logger import log_action

# Every event needs a decorator; add roles per event type as the business grows.
ROLE_REQUIREMENTS: dict[str, list[str]] = {
    "birthday": ["decorator"],
    "wedding": ["decorator"],
    "babyshower": ["decorator"],
    "corporate": ["decorator"],
    "default": ["decorator"],
}

ESCALATION_HOURS = float(os.environ.get("VENDOR_ESCALATION_HOURS", "6"))


def required_roles(event_type: str) -> list[str]:
    return ROLE_REQUIREMENTS.get(event_type, ROLE_REQUIREMENTS["default"])


async def dispatch_for_booking(booking: dict[str, Any]) -> None:
    """Send a WhatsApp job request to one active vendor per required role."""
    taken, skipped = [], []
    for role in required_roles(booking["event_type"]):
        vendors = await db.active_vendors(role)
        if not vendors:
            skipped.append(f"no active {role} for booking {booking['id']}")
            await slack_alert(f"🚨 Booking {booking['id']} paid but NO active {role} on roster — will hit escalation window.")
            continue
        # least-loaded first: fewest open (requested/accepted) assignments
        loads = []
        for v in vendors:
            assignments = await db._get(  # noqa: SLF001 — internal helper reuse
                "vendor_assignments",
                {"vendor_id": f"eq.{v['id']}", "status": "in.(requested,accepted)"},
            )
            loads.append((len(assignments), v))
        loads.sort(key=lambda t: t[0])
        vendor = loads[0][1]

        await db.create_assignment(booking["id"], vendor["id"], role)
        await send_whatsapp(
            vendor["contact"],
            f"New job — {booking['event_type']} on {booking['date']} (booking {booking['id'][:8]}).\n"
            f"Reply YES {booking['id'][:8]} to accept or NO {booking['id'][:8]} to decline.",
        )
        taken.append(f"requested {role} {vendor['name']} for booking {booking['id']}")
    log_action("vendor_coordination", actions_taken=taken, actions_skipped_or_escalated=skipped)


async def handle_vendor_reply(vendor: dict[str, Any], text: str) -> bool:
    """Parse 'YES <id-prefix>' / 'NO <id-prefix>'. Returns True if handled."""
    parts = text.strip().lower().split()
    if len(parts) != 2 or parts[0] not in ("yes", "no"):
        await send_whatsapp(vendor["contact"], "Reply YES <booking-id> to accept or NO <booking-id> to decline.")
        return True

    answer, prefix = parts[0], parts[1]
    # find the vendor's open assignment whose booking id starts with the prefix
    open_rows = await db._get(  # noqa: SLF001
        "vendor_assignments",
        {"vendor_id": f"eq.{vendor['id']}", "status": "eq.requested"},
    )
    match = None
    for row in open_rows:
        if row["booking_id"].startswith(prefix):
            match = row
            break
    if not match:
        await send_whatsapp(vendor["contact"], f"No open request matching '{prefix}' — maybe already handled.")
        return True

    booking = await db.get_booking(match["booking_id"])
    if answer == "no":
        await db.set_assignment_status(match["id"], "declined")
        log_action("vendor_coordination", actions_taken=[f"vendor {vendor['name']} declined booking {match['booking_id']}"])
        await send_whatsapp(vendor["contact"], "Noted — thanks for the quick reply.")
        await slack_alert(f"⚠️ {vendor['name']} declined {match['role']} for booking {match['booking_id']} — re-dispatching.")
        # try the next vendor for that role immediately
        if booking:
            await _redispatch_role(booking, match["role"], exclude_vendor=vendor["id"])
        return True

    await db.set_assignment_status(match["id"], "accepted")
    log_action("vendor_coordination", actions_taken=[f"vendor {vendor['name']} accepted booking {match['booking_id']}"])
    await send_whatsapp(vendor["contact"], f"Locked in — you're on for {booking['date'] if booking else 'the event'}. Details to follow.")
    if booking:
        await _maybe_confirm_booking(booking)
    return True


async def _redispatch_role(booking: dict[str, Any], role: str, exclude_vendor: str) -> None:
    vendors = [v for v in await db.active_vendors(role) if v["id"] != exclude_vendor]
    if not vendors:
        await slack_alert(f"🚨 No alternative {role} for booking {booking['id']} — escalation window is the safety net.")
        log_action("vendor_coordination", actions_skipped_or_escalated=[f"no alternative {role} for {booking['id']}"])
        return
    vendor = vendors[0]
    await db.create_assignment(booking["id"], vendor["id"], role)
    await send_whatsapp(
        vendor["contact"],
        f"New job — {booking['event_type']} on {booking['date']} (booking {booking['id'][:8]}).\n"
        f"Reply YES {booking['id'][:8]} to accept or NO {booking['id'][:8]} to decline.",
    )
    log_action("vendor_coordination", actions_taken=[f"re-dispatched {role} to {vendor['name']} for {booking['id']}"])


async def _maybe_confirm_booking(booking: dict[str, Any]) -> None:
    """Spec §4.4: fully confirm to the customer only when EVERY required
    role has at least one accepted assignment."""
    if booking["status"] == "confirmed":
        return
    assignments = await db.assignments_for_booking(booking["id"])
    accepted_roles = {a["role"] for a in assignments if a["status"] == "accepted"}
    if not set(required_roles(booking["event_type"])).issubset(accepted_roles):
        return

    from datetime import datetime, timezone
    await db.set_booking(booking["id"], status="confirmed", confirmed_at=datetime.now(timezone.utc).isoformat())
    lead = await db.get_lead(booking["lead_id"])
    if lead and lead.get("phone"):
        await send_whatsapp(
            lead["phone"],
            f"Great news! Your {booking['event_type']} on {booking['date']} is fully confirmed — "
            f"our team is locked in. See you there! 🎈",
        )
    log_action("vendor_coordination", actions_taken=[f"booking {booking['id']} fully confirmed to customer"])
    await slack_alert(f"✅ Booking {booking['id']} fully confirmed (all roles accepted).")
