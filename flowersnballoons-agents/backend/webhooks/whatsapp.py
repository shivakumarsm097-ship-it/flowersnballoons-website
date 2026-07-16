"""Meta WhatsApp Cloud API webhook.

GET  — subscription verification (hub.challenge echo).
POST — inbound messages. Routing order:
  1. sender is an active vendor  → vendor_dispatch.handle_vendor_reply
  2. anyone else                 → stored/updated as a lead; the Lead &
     Quote agent (modules/lead_quote/AGENT.md) owns the conversation.
"""
from __future__ import annotations

import os

from fastapi import APIRouter, Request, Response

from backend.db import client as db
from backend.notify import slack_alert
from backend.vendor_dispatch import handle_vendor_reply
from orchestrator.logger import log_action

router = APIRouter()

VERIFY_TOKEN = os.environ.get("WHATSAPP_VERIFY_TOKEN", "")


@router.get("/webhooks/whatsapp")
async def verify(request: Request):
    q = request.query_params
    if VERIFY_TOKEN and q.get("hub.mode") == "subscribe" and q.get("hub.verify_token") == VERIFY_TOKEN:
        return Response(content=q.get("hub.challenge", ""), media_type="text/plain")
    return Response(status_code=403)


@router.post("/webhooks/whatsapp")
async def receive(request: Request):
    payload = await request.json()
    try:
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                for msg in change.get("value", {}).get("messages", []) or []:
                    sender = "+" + msg["from"]

                    # vendor photo upload (event wrap-up) → marketing intake
                    if msg.get("type") == "image":
                        vendor = await db.vendor_by_contact(sender)
                        if vendor:
                            from modules.marketing.agent import intake_vendor_photo
                            await intake_vendor_photo(vendor, msg["image"].get("id"))
                        continue

                    if msg.get("type") != "text":
                        continue
                    text = msg["text"]["body"]

                    vendor = await db.vendor_by_contact(sender)
                    if vendor:
                        await handle_vendor_reply(vendor, text)
                        continue

                    # customer routing, most-specific first:
                    #  1. live booking + money keyword → Booking & Payment agent
                    #  2. quoted lead saying YES        → Booking & Payment agent
                    #  3. everything else               → Lead & Quote agent
                    lead = await db.find_lead_by_phone(sender)
                    if not lead:
                        lead = await db.create_lead(source="whatsapp", phone=sender, raw_message=text[:2000])
                        log_action("lead_quote", actions_taken=[f"new WhatsApp lead {lead['id']} ({sender})"])
                        await slack_alert(f"💬 New WhatsApp lead {sender}: {text[:120]}")

                    from modules.booking_payment.agent import handle_booking_message, handle_confirmation
                    booking = await db.active_booking_for_phone(sender)
                    if booking and await handle_booking_message(booking, lead, text):
                        continue
                    if lead.get("status") == "quoted" and await handle_confirmation(lead, text):
                        continue

                    # reply to a pending review request → marketing owns it
                    review_booking = await db.booking_awaiting_review_reply(sender)
                    if review_booking:
                        from modules.marketing.agent import handle_review_reply
                        if await handle_review_reply(review_booking, lead, text):
                            continue

                    from modules.lead_quote.agent import handle_inbound
                    await handle_inbound(lead, text)
    except Exception as e:
        log_action("lead_quote", errors=[f"whatsapp webhook parse error: {e}"])
    return {"ok": True}
