"""Instagram Graph API webhook — DMs and comments become leads.

Same verify handshake as WhatsApp (both are Meta Graph webhooks). IG
users rarely share a phone number in message one, so leads land with
source='instagram' and the IG-scoped user id in raw_message metadata;
the Lead & Quote agent's first job is to move them to WhatsApp.
"""
from __future__ import annotations

import os

from fastapi import APIRouter, Request, Response

from backend.db import client as db
from backend.notify import slack_alert
from orchestrator.logger import log_action

router = APIRouter()

VERIFY_TOKEN = os.environ.get("INSTAGRAM_VERIFY_TOKEN", "")


@router.get("/webhooks/instagram")
async def verify(request: Request):
    q = request.query_params
    if VERIFY_TOKEN and q.get("hub.mode") == "subscribe" and q.get("hub.verify_token") == VERIFY_TOKEN:
        return Response(content=q.get("hub.challenge", ""), media_type="text/plain")
    return Response(status_code=403)


@router.post("/webhooks/instagram")
async def receive(request: Request):
    payload = await request.json()
    try:
        for entry in payload.get("entry", []):
            # DMs — reply in-platform, steer real qualification to WhatsApp
            for msg_event in entry.get("messaging", []) or []:
                sender_id = msg_event.get("sender", {}).get("id")
                text = (msg_event.get("message") or {}).get("text")
                if not (sender_id and text):
                    continue
                lead = await db.create_lead(
                    source="instagram",
                    raw_message=f"[ig:{sender_id}] {text}"[:2000],
                )
                log_action("lead_quote", actions_taken=[f"new Instagram DM lead {lead['id']}"])
                await slack_alert(f"📸 New Instagram DM lead: {text[:120]}")
                try:
                    from backend.notify import send_instagram_dm
                    await send_instagram_dm(
                        sender_id,
                        "Thanks for reaching out! 🎈 For dates, packages and a quick quote, "
                        "message us on WhatsApp — we reply within minutes: https://wa.me/918867121207",
                    )
                except Exception as e:
                    log_action("lead_quote", errors=[f"IG DM reply failed: {e}"])
            # comments — short public steer to DM/WhatsApp, never quote publicly
            for change in entry.get("changes", []) or []:
                if change.get("field") != "comments":
                    continue
                value = change.get("value", {})
                text = value.get("text", "")
                commenter = value.get("from", {}).get("id", "")
                comment_id = value.get("id", "")
                lead = await db.create_lead(
                    source="instagram",
                    raw_message=f"[ig-comment:{commenter}] {text}"[:2000],
                )
                log_action("lead_quote", actions_taken=[f"new Instagram comment lead {lead['id']}"])
                if comment_id:
                    try:
                        from backend.notify import reply_instagram_comment
                        await reply_instagram_comment(
                            comment_id,
                            "Thank you! 🎈 DM us or WhatsApp +91 88671 21207 for packages & dates!",
                        )
                    except Exception as e:
                        log_action("lead_quote", errors=[f"IG comment reply failed: {e}"])
    except Exception as e:
        log_action("lead_quote", errors=[f"instagram webhook parse error: {e}"])
    return {"ok": True}
