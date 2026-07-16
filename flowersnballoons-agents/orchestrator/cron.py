"""Cron jobs — ONLY the polled work (spec §5):
  - sweep expired calendar holds
  - unpaid-quote follow-ups (hold about to expire, no payment yet)
  - vendor-confirmation escalation → refund-or-reschedule outreach
  - post-event review requests
  - marketing posting calendar tick

Everything lead/booking/payment/vendor-critical is webhook-driven; cron
is the safety net, not the engine.

Run every 30 min on Railway cron: python -m orchestrator.cron
"""
from __future__ import annotations

import asyncio

from backend.db import client as db
from backend.notify import send_whatsapp, slack_alert
from backend.vendor_dispatch import escalation_window_hours, required_roles
from orchestrator.logger import log_action


async def sweep_holds() -> None:
    await db.sweep_expired_holds()
    log_action("booking_payment", actions_taken=["swept expired calendar holds"])


async def unpaid_quote_followups() -> None:
    """Nudge leads whose hold expires within the next hour and who haven't paid."""
    holds = await db.holds_expiring_within(1.0)
    for h in holds:
        lead = await db.get_lead(h["lead_id"])
        if not (lead and lead.get("phone")):
            continue
        try:
            await send_whatsapp(
                lead["phone"],
                f"Quick heads-up — I'm holding {h['date']} for your {h['event_type']}, but the hold "
                f"expires soon. Complete the payment link to lock it in, or reply here if you have questions!",
            )
            log_action("booking_payment", actions_taken=[f"unpaid-quote follow-up to lead {lead['id']}"])
        except Exception as e:
            log_action("booking_payment", errors=[f"follow-up send failed for {lead['id']}: {e}"])


async def lead_followups() -> None:
    """Spec: one gentle nudge at 24h of silence, mark cold at 3 days. Never nag."""
    for lead in await db.leads_needing_followup(24):
        if not lead.get("phone"):
            continue
        try:
            name = f" {lead['name']}" if lead.get("name") else ""
            await send_whatsapp(
                lead["phone"],
                f"Hi{name}! Just checking in about your event — happy to answer any questions "
                f"or adjust the plan. No rush at all 🎈",
            )
            await db.touch_lead(lead["id"], followup_sent=True)
            log_action("lead_quote", actions_taken=[f"24h follow-up sent to lead {lead['id']}"])
        except Exception as e:
            log_action("lead_quote", errors=[f"follow-up failed for {lead['id']}: {e}"])

    for lead in await db.leads_gone_cold(3):
        await db.set_lead_status(lead["id"], "cold")
        log_action("lead_quote", actions_skipped_or_escalated=[f"lead {lead['id']} marked cold after 3 days silence — no further contact"])


async def vendor_escalations() -> None:
    """Spec §7: a paid booking stuck without full vendor acceptance past the
    escalation window triggers proactive refund-or-reschedule outreach —
    never a silent exposed customer."""
    from datetime import datetime, timedelta, timezone

    from modules.booking_payment.agent import mark_at_risk_and_notify

    stuck = await db.bookings_pending_vendors_since(0)  # window applied per booking below
    for b in stuck:
        window = escalation_window_hours(b["date"])
        if b["created_at"] > (datetime.now(timezone.utc) - timedelta(hours=window)).isoformat():
            continue  # still inside this booking's window

        assignments = await db.assignments_for_booking(b["id"])
        accepted = {a["role"] for a in assignments if a["status"] == "accepted"}
        missing = [r for r in required_roles(b["event_type"], b.get("package")) if r not in accepted]
        if not missing:
            continue  # webhook confirm path probably racing; skip

        # mark stale requested assignments as no_response
        for a in assignments:
            if a["status"] == "requested":
                await db.set_assignment_status(a["id"], "no_response")

        await mark_at_risk_and_notify(b, missing, "booking-level escalation window blown")


async def at_risk_default_refunds() -> None:
    """Spec (booking_payment): customer silent 24h after the at-risk notice
    → default to a full refund. Silence never leaves money held against an
    undeliverable event."""
    from modules.booking_payment.agent import _refund
    for b in await db.at_risk_bookings_older_than(24):
        lead = await db.get_lead(b["lead_id"])
        if lead:
            await _refund(b, lead, reason="no reply 24h after at-risk notice — defaulted to refund")


async def balance_reminders() -> None:
    """Spec: balance-due reminder 3-5 days before the event."""
    for b in await db.bookings_due_balance_reminder(3, 5):
        lead = await db.get_lead(b["lead_id"])
        if not (lead and lead.get("phone")):
            continue
        balance = max((b.get("total_price") or 0) - (b.get("price") or 0), 0)
        if balance <= 0:
            await db.set_booking(b["id"], balance_reminder_sent=True)
            continue
        try:
            await send_whatsapp(
                lead["phone"],
                f"Getting excited for your {b['event_type']} on {b['date']}! 🎈\n\n"
                f"A friendly reminder: the balance of ₹{balance:,} is due at the event. "
                f"Any questions before the big day, just reply here!",
            )
            await db.set_booking(b["id"], balance_reminder_sent=True)
            log_action("booking_payment", actions_taken=[f"balance reminder (₹{balance:,}) sent for booking {b['id']}"])
        except Exception as e:
            log_action("booking_payment", errors=[f"balance reminder failed for {b['id']}: {e}"])


async def mark_done() -> None:
    """Flip yesterday's confirmed events to done."""
    for b in await db.bookings_finished_yesterday():
        if b["status"] != "done":
            await db.set_booking(b["id"], status="done")


async def main() -> None:
    from datetime import datetime, timezone

    from backend.vendor_dispatch import advance_stale_assignments, vendor_reminders, weekly_decline_summary
    from modules.marketing.agent import (
        engagement_check,
        send_review_followups,
        send_review_requests,
        weekly_posting,
    )

    jobs = [sweep_holds, unpaid_quote_followups, lead_followups,
            advance_stale_assignments, vendor_escalations,
            at_risk_default_refunds, balance_reminders, vendor_reminders,
            mark_done, send_review_requests, send_review_followups, engagement_check]
    if datetime.now(timezone.utc).weekday() == 0:  # Mondays
        jobs += [weekly_decline_summary, weekly_posting]
    for job in jobs:
        try:
            await job()
        except Exception as e:
            log_action("orchestrator", errors=[f"{job.__name__} crashed: {e}"])
            await slack_alert(f"⚠️ cron job {job.__name__} crashed: {e}")


if __name__ == "__main__":
    asyncio.run(main())
