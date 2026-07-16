"""Razorpay webhook — the payment→booking→vendor chain (spec §4.3).

payment_link.paid:
  1. verify HMAC signature
  2. find the calendar_hold carrying this payment link id
  3. convert hold → bookings row (delete the hold)
  4. IMMEDIATELY trigger vendor dispatch — same request, no cron wait
  5. tell the customer payment landed (full confirmation comes only after
     vendors accept, per spec §4.4)
"""
from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from backend.db import client as db
from backend.notify import send_whatsapp, slack_alert
from backend.vendor_dispatch import dispatch_for_booking
from orchestrator.logger import log_action

router = APIRouter()

WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")


def _verify(body: bytes, signature: str) -> bool:
    if not WEBHOOK_SECRET:
        return False
    expected = hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


@router.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request):
    body = await request.body()
    if not _verify(body, request.headers.get("x-razorpay-signature", "")):
        log_action("booking_payment", errors=["razorpay webhook signature verification failed"])
        raise HTTPException(status_code=403, detail="bad signature")

    payload = await request.json()
    if payload.get("event") != "payment_link.paid":
        return {"ok": True, "ignored": payload.get("event")}

    entity = payload["payload"]["payment_link"]["entity"]
    link_id = entity["id"]
    payment_id = (
        payload["payload"].get("payment", {}).get("entity", {}).get("id")
    )
    amount_inr = entity["amount"] // 100

    hold = await db.hold_by_payment_link(link_id)
    if not hold:
        # paid but hold missing (expired mid-payment or unknown link) — never
        # swallow money silently: alert for manual reconciliation.
        log_action("booking_payment", errors=[f"payment {payment_id} for link {link_id} has no matching hold"])
        await slack_alert(f"🚨 Razorpay payment {payment_id} ({amount_inr}₹) has NO matching hold — manual reconciliation needed.")
        return {"ok": True, "orphan": True}

    booking = await db.create_booking(
        lead_id=hold["lead_id"],
        date=hold["date"],
        event_type=hold["event_type"],
        price=amount_inr,
        payment_status="paid",
        razorpay_payment_id=payment_id,
        status="pending_vendors",
    )
    await db.delete_hold(hold["id"])
    await db.set_lead_status(hold["lead_id"], "converted")
    log_action(
        "booking_payment",
        actions_taken=[f"payment {payment_id} converted hold {hold['id']} → booking {booking['id']} ({amount_inr}₹)"],
    )

    lead = await db.get_lead(hold["lead_id"])
    if lead and lead.get("phone"):
        try:
            await send_whatsapp(
                lead["phone"],
                f"Payment received — thank you! 🎉 Your {booking['event_type']} on {booking['date']} is booked. "
                f"I'm locking in the team now and will confirm everything shortly.",
            )
        except Exception as e:
            log_action("booking_payment", errors=[f"customer payment ack failed: {e}"])

    # spec §4.3: webhook-to-webhook chain — dispatch NOW, not next cron cycle
    try:
        await dispatch_for_booking(booking)
    except Exception as e:
        log_action("vendor_coordination", errors=[f"immediate dispatch failed for {booking['id']}: {e}"])
        await slack_alert(f"🚨 Vendor dispatch failed for paid booking {booking['id']}: {e}")

    return {"ok": True, "booking_id": booking["id"]}
