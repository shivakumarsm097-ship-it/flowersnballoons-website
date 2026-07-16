"""Booking & Payment agent — deterministic runtime.

Owns: YES-confirmation → re-validated payment link (advance only),
payment webhook → booking conversion (in webhooks/razorpay.py, which
calls into here), REFUND / RESCHEDULE / CANCEL customer replies,
balance reminders, at-risk default-refund. No LLM needed — every path
here is money-touching and fully deterministic by design.

Hard limit (spec): never collect payment for a slot not re-verified as
available in the SAME conversation — quotes go stale.
"""
from __future__ import annotations

import os
import re
from datetime import date, datetime, timezone

from backend import availability, catalog, payments
from backend.db import client as db
from backend.notify import send_whatsapp, slack_alert
from orchestrator.logger import log_action

ADVANCE_PCT = float(os.environ.get("ADVANCE_PERCENT", "0.30"))  # 25-30% per site language

YES_RE = re.compile(r"^\s*(yes|yess*|confirm|book it|lets do it|let's do it|ok(ay)? book|done)\b", re.I)
REFUND_RE = re.compile(r"\brefund\b", re.I)
RESCHEDULE_RE = re.compile(r"\breschedul\w*\b", re.I)
CANCEL_RE = re.compile(r"\bcancel\b", re.I)
_DATE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")


def _inr(n: int) -> str:
    return f"₹{n:,}"


# ── YES after a quote → re-validate, then (and only then) payment link ──
async def handle_confirmation(lead: dict, text: str) -> bool:
    """Customer confirms a quote. Returns True if this module handled it."""
    if not YES_RE.search(text):
        return False
    hold = await db.active_hold_for_lead(lead["id"])
    if not hold:
        return False  # nothing to confirm — let the lead agent respond

    # spec §1: re-check in the SAME conversation — hold may have expired,
    # capacity may be gone. Never take payment on a stale quote.
    d = date.fromisoformat(hold["date"])
    expired = hold["expires_at"] <= datetime.now(timezone.utc).isoformat()
    if expired:
        await db.expire_hold(hold["id"])
        if await availability.is_available(d):
            # slot still open — issue a fresh hold and proceed honestly
            hold = await availability.try_hold(
                d, hold["event_type"], lead["id"],
                quoted_price=hold.get("quoted_price"), advance_price=hold.get("advance_price"),
            )
            if not hold:
                return await _offer_alternatives(lead, d)
        else:
            return await _offer_alternatives(lead, d)

    total = hold.get("quoted_price") or 0
    advance = hold.get("advance_price") or max(500, round(total * ADVANCE_PCT / 100) * 100)
    balance = max(total - advance, 0)

    if not payments.configured():
        await slack_alert(f"🚨 Lead {lead['id']} confirmed but Razorpay unconfigured — manual payment link needed NOW.")
        await send_whatsapp(lead["phone"], "Wonderful! I'm preparing your payment link — you'll have it in a few minutes. 🎈")
        log_action("booking_payment", actions_skipped_or_escalated=[f"confirmation without Razorpay for lead {lead['id']}"])
        return True

    try:
        link = await payments.create_payment_link(
            advance,
            f"{catalog.LABELS.get(hold['event_type'], hold['event_type'])} — {hold['date']} (advance)",
            lead["phone"],
            hold["id"],
        )
        await db.attach_payment_link(hold["id"], link["id"])
        await send_whatsapp(
            lead["phone"],
            f"Wonderful{', ' + lead['name'] if lead.get('name') else ''}! 🎈\n\n"
            f"To lock in {hold['date']}:\n"
            f"• Advance now: {_inr(advance)}\n"
            f"• Balance at the event: {_inr(balance)}\n"
            f"• Total: {_inr(total)}\n\n"
            f"Pay here: {link['short_url']}\n\n"
            f"The date is held for you until {hold['expires_at'][:16].replace('T', ' ')} — "
            f"once paid, it's yours.",
        )
        log_action("booking_payment", actions_taken=[f"advance payment link ({_inr(advance)}) sent to lead {lead['id']} for {hold['date']}"])
    except Exception as e:
        log_action("booking_payment", errors=[f"payment link failed for lead {lead['id']}: {e}"])
        await slack_alert(f"🚨 Payment link creation failed for confirmed lead {lead['id']}: {e}")
        await send_whatsapp(lead["phone"], "One moment — small hiccup preparing your payment link. I'll send it right over! 🙏")
    return True


async def _offer_alternatives(lead: dict, d: date) -> bool:
    alts = await availability.nearest_available(d, 3)
    alt_text = "\n".join(f"• {a.isoformat()}" for a in alts) or "— let me check more dates for you"
    await send_whatsapp(
        lead["phone"],
        f"I have to be honest with you — while you were deciding, {d.isoformat()} got booked "
        f"(I only hold quotes for a short time so dates stay fair for everyone). 🙏\n\n"
        f"Nearest open dates:\n{alt_text}\n\n"
        f"Reply with a date and I'll re-quote it right away — same package, same price.",
    )
    log_action(
        "booking_payment",
        actions_skipped_or_escalated=[f"lead {lead['id']} confirmed a stale hold for {d.isoformat()} — offered alternatives, NO payment collected"],
    )
    return True


# ── post-payment customer messages: REFUND / RESCHEDULE / CANCEL ──────
async def handle_booking_message(booking: dict, lead: dict, text: str) -> bool:
    """Keyword-routed money flows for a customer with a live booking.
    Returns True if handled."""
    if REFUND_RE.search(text) and booking["status"] in ("at_risk", "rescheduling"):
        await _refund(booking, lead, reason="customer chose refund after at-risk notice")
        return True

    if CANCEL_RE.search(text):
        # standard cancellation policy: direct refund, no justification needed
        await _refund(booking, lead, reason="customer cancellation per standard policy")
        return True

    if RESCHEDULE_RE.search(text):
        d = date.fromisoformat(booking["date"])
        alts = await availability.nearest_available(d, 3)
        alt_text = "\n".join(f"• {a.isoformat()}" for a in alts)
        await db.set_booking(booking["id"], status="rescheduling")
        await send_whatsapp(
            lead["phone"],
            f"Absolutely — here are the nearest open dates:\n{alt_text}\n\n"
            f"Reply with the date you'd like (e.g. {alts[0].isoformat() if alts else '2026-08-01'}) "
            f"and I'll move everything over. Or reply REFUND for a full refund instead.",
        )
        log_action("booking_payment", actions_taken=[f"reschedule options sent for booking {booking['id']}"])
        return True

    if booking["status"] == "rescheduling":
        m = _DATE_RE.search(text)
        if m:
            new_d = date.fromisoformat(m.group(1))
            if not await availability.is_available(new_d):
                alts = await availability.nearest_available(new_d, 3)
                await send_whatsapp(
                    lead["phone"],
                    f"{new_d.isoformat()} just filled up 🙏 Still open:\n"
                    + "\n".join(f"• {a.isoformat()}" for a in alts),
                )
                return True
            await db.set_booking(booking["id"], date=new_d.isoformat(), status="pending_vendors", at_risk_at=None)
            await send_whatsapp(
                lead["phone"],
                f"Done! Your {booking['event_type']} is moved to {new_d.isoformat()} — "
                f"same package, advance carries over. Re-confirming the team now. 🎈",
            )
            log_action("booking_payment", actions_taken=[f"booking {booking['id']} rescheduled {booking['date']} → {new_d.isoformat()}"])
            from backend.vendor_dispatch import dispatch_for_booking
            fresh = await db.get_booking(booking["id"])
            await dispatch_for_booking(fresh or booking)
            return True

    return False


async def _refund(booking: dict, lead: dict, reason: str) -> None:
    pid = booking.get("razorpay_payment_id")
    ok = False
    if pid and payments.configured():
        try:
            await payments.refund_payment(pid)
            ok = True
        except Exception as e:
            log_action("booking_payment", errors=[f"refund API failed for booking {booking['id']}: {e}"])
            await slack_alert(f"🚨 Refund FAILED for booking {booking['id']} ({pid}): {e} — manual refund needed NOW.")
    else:
        await slack_alert(f"🚨 Refund needed for booking {booking['id']} but Razorpay unavailable — manual refund required.")

    await db.set_booking(booking["id"], status="refunded", payment_status="refund_initiated" if ok else "refund_initiated")
    await send_whatsapp(
        lead["phone"],
        f"Your refund of {_inr(booking.get('price') or 0)} is on its way — it typically reaches your "
        f"account in 5-7 working days. I'm sorry we couldn't make this one work; we'd love to "
        f"decorate for you another time. 🙏",
    )
    log_action("booking_payment", actions_taken=[f"refund initiated for booking {booking['id']} — {reason}"])


# ── double-book near-miss detector (spec hard limit) ──────────────────
async def near_miss_check(booking: dict) -> None:
    d = date.fromisoformat(booking["date"])
    cap = await availability.capacity_for(d)
    booked = len(await db.bookings_on(d))
    if booked > cap:
        msg = (
            f"🚨🚨 CAPACITY BREACH: {booked} bookings on {booking['date']} vs capacity {cap} "
            f"(latest: {booking['id']}). Hold TTL / capacity check needs tightening — investigate TODAY."
        )
        await slack_alert(msg)
        log_action("booking_payment", errors=[msg])
