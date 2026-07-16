"""Booking & Payment agent test — the money paths (spec §6.3 continued):

  1. YES on a valid hold → advance link with now-vs-later breakdown
  2. YES on an expired hold, slot gone → honest alternatives, NO payment asked
  3. YES on an expired hold, slot still free → fresh hold + link (proceed)
  4. REFUND reply on an at-risk booking → Razorpay refund + warm confirmation
  5. CANCEL on a confirmed booking → standard-policy refund
  6. RESCHEDULE → options → date reply → booking moved, vendors re-dispatched
  7. capacity near-miss → loud alert
  8. balance reminder cron (3-5 days out, once)
  9. at-risk 24h silence → automatic default refund

Run: .venv/bin/python -m tests.test_booking_payment
"""
from __future__ import annotations

import asyncio
import os
from datetime import date, datetime, timedelta, timezone

os.environ.setdefault("DAILY_EVENT_CAPACITY", "2")
os.environ.setdefault("ADVANCE_PERCENT", "0.30")

from tests.test_chain import TABLES, fake_insert  # noqa: E402  (applies DB fakes)

import backend.payments as payments  # noqa: E402
import modules.booking_payment.agent as bp  # noqa: E402
from backend.db import client as db  # noqa: E402

SENT: list[tuple[str, str]] = []
ALERTS: list[str] = []
REFUNDED: list[str] = []
DISPATCHED: list[str] = []


async def fake_wa(to, text):
    SENT.append((to, text))


async def fake_slack(text):
    ALERTS.append(text)


bp.send_whatsapp = fake_wa
bp.slack_alert = fake_slack

payments.configured = lambda: True


async def fake_link(amount, desc, phone, ref):
    return {"id": f"plink_{ref[:6]}", "short_url": f"https://rzp.io/{ref[:6]}"}


async def fake_refund(pid, amount_inr=None):
    REFUNDED.append(pid)
    return {"id": "rfnd_1"}


payments.create_payment_link = fake_link
payments.refund_payment = fake_refund

import backend.vendor_dispatch as vd  # noqa: E402


async def fake_dispatch(booking):
    DISPATCHED.append(booking["id"])


vd_dispatch_orig = vd.dispatch_for_booking
vd.dispatch_for_booking = fake_dispatch

FUTURE = date.today() + timedelta(days=40)


def past_iso(hours=1):
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def future_iso(hours=2):
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


async def main():
    # ── 1. YES on valid hold → advance link + breakdown ──
    lead = await fake_insert("leads", {"source": "whatsapp", "phone": "+919111111111", "name": "Priya", "status": "quoted"})
    await fake_insert("calendar_holds", {
        "date": FUTURE.isoformat(), "event_type": "birthday", "lead_id": lead["id"],
        "quoted_price": 6000, "advance_price": 1800, "status": "active", "expires_at": future_iso(),
    })
    handled = await bp.handle_confirmation(lead, "YES let's book it!")
    assert handled
    msg = SENT[-1][1]
    assert "₹1,800" in msg and "₹4,200" in msg and "rzp.io" in msg, "advance + balance breakdown + link"

    # ── 2. YES on expired hold, slot GONE → honest alternatives, no payment ──
    lead2 = await fake_insert("leads", {"source": "whatsapp", "phone": "+919222222222", "status": "quoted"})
    gone = date.today() + timedelta(days=50)
    await fake_insert("calendar_holds", {
        "date": gone.isoformat(), "event_type": "wedding", "lead_id": lead2["id"],
        "quoted_price": 20000, "advance_price": 6000, "status": "active", "expires_at": past_iso(),
    })
    # fill the date to capacity with other bookings
    for i in range(2):
        await fake_insert("bookings", {"lead_id": lead2["id"], "date": gone.isoformat(), "event_type": "wedding", "status": "confirmed"})
    await bp.handle_confirmation(lead2, "yes")
    msg = SENT[-1][1]
    assert "got booked" in msg and "rzp.io" not in msg, "stale slot: honesty, no payment link"

    # ── 3. YES on expired hold, slot still FREE → fresh hold + proceed ──
    lead3 = await fake_insert("leads", {"source": "whatsapp", "phone": "+919333333333", "status": "quoted"})
    free_d = date.today() + timedelta(days=55)
    await fake_insert("calendar_holds", {
        "date": free_d.isoformat(), "event_type": "haldi", "lead_id": lead3["id"],
        "quoted_price": 8000, "advance_price": 2400, "status": "active", "expires_at": past_iso(),
    })
    await bp.handle_confirmation(lead3, "Yes")
    assert "rzp.io" in SENT[-1][1], "slot still free after expiry → re-held and link sent"
    fresh = [h for h in TABLES["calendar_holds"] if h["lead_id"] == lead3["id"] and h["status"] == "active"]
    assert fresh, "fresh hold created"

    # ── 4. REFUND on at-risk booking ──
    lead4 = await fake_insert("leads", {"source": "whatsapp", "phone": "+919444444444"})
    b4 = await fake_insert("bookings", {
        "lead_id": lead4["id"], "date": FUTURE.isoformat(), "event_type": "birthday",
        "price": 1800, "total_price": 6000, "status": "at_risk",
        "razorpay_payment_id": "pay_at_risk", "at_risk_at": past_iso(2),
    })
    assert await bp.handle_booking_message(b4, lead4, "REFUND please")
    assert "pay_at_risk" in REFUNDED
    assert b4["status"] == "refunded"
    assert "refund" in SENT[-1][1].lower()

    # ── 5. CANCEL on confirmed booking → policy refund ──
    lead5 = await fake_insert("leads", {"source": "whatsapp", "phone": "+919555555555"})
    b5 = await fake_insert("bookings", {
        "lead_id": lead5["id"], "date": FUTURE.isoformat(), "event_type": "corporate",
        "price": 3000, "total_price": 10000, "status": "confirmed", "razorpay_payment_id": "pay_cancel",
    })
    assert await bp.handle_booking_message(b5, lead5, "I need to cancel our event")
    assert "pay_cancel" in REFUNDED and b5["status"] == "refunded"

    # ── 6. RESCHEDULE → options → date reply → moved + re-dispatched ──
    lead6 = await fake_insert("leads", {"source": "whatsapp", "phone": "+919666666666"})
    b6 = await fake_insert("bookings", {
        "lead_id": lead6["id"], "date": FUTURE.isoformat(), "event_type": "babyshower",
        "price": 1500, "total_price": 5000, "status": "at_risk",
        "razorpay_payment_id": "pay_resch", "at_risk_at": past_iso(1),
    })
    assert await bp.handle_booking_message(b6, lead6, "can we reschedule?")
    assert b6["status"] == "rescheduling"
    new_date = (date.today() + timedelta(days=70)).isoformat()
    assert await bp.handle_booking_message(b6, lead6, f"ok {new_date} works")
    assert b6["date"] == new_date and b6["status"] == "pending_vendors"
    assert DISPATCHED and DISPATCHED[-1] == b6["id"], "vendors re-dispatched for new date"

    # ── 7. near-miss detector ──
    crowd = date.today() + timedelta(days=80)
    for i in range(3):  # capacity is 2 (or 1 with tiny roster) — 3 is a breach
        b = await fake_insert("bookings", {"lead_id": lead6["id"], "date": crowd.isoformat(), "event_type": "birthday", "status": "confirmed"})
    await bp.near_miss_check(b)
    assert any("CAPACITY BREACH" in a for a in ALERTS), "near-miss logged loudly"

    # ── 8. balance reminder (3-5 days out, once) ──
    from orchestrator import cron
    cron.send_whatsapp = fake_wa
    cron.slack_alert = fake_slack
    lead8 = await fake_insert("leads", {"source": "web", "phone": "+919888888888"})
    soon = (date.today() + timedelta(days=4)).isoformat()
    b8 = await fake_insert("bookings", {
        "lead_id": lead8["id"], "date": soon, "event_type": "engagement",
        "price": 2400, "total_price": 8000, "status": "confirmed", "balance_reminder_sent": False,
    })
    await cron.balance_reminders()
    assert "₹5,600" in SENT[-1][1], "balance amount in reminder"
    assert b8["balance_reminder_sent"] is True
    n = len(SENT)
    await cron.balance_reminders()
    assert len(SENT) == n, "reminder sent exactly once"

    # ── 9. at-risk 24h silence → automatic default refund ──
    lead9 = await fake_insert("leads", {"source": "whatsapp", "phone": "+919999999999"})
    b9 = await fake_insert("bookings", {
        "lead_id": lead9["id"], "date": FUTURE.isoformat(), "event_type": "community",
        "price": 2400, "total_price": 8000, "status": "at_risk",
        "razorpay_payment_id": "pay_silent", "at_risk_at": past_iso(30),
    })
    await cron.at_risk_default_refunds()
    assert "pay_silent" in REFUNDED and b9["status"] == "refunded", "silence defaults to refund"

    print("ALL BOOKING & PAYMENT TESTS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
