"""Outbound channels: WhatsApp (Meta Cloud API) + Slack alerts."""
from __future__ import annotations

import os

import httpx

WA_TOKEN = os.environ.get("WHATSAPP_ACCESS_TOKEN", "")
WA_PHONE_ID = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
SLACK_WEBHOOK = os.environ.get("SLACK_WEBHOOK_URL", "")


async def send_whatsapp(to: str, text: str) -> None:
    """to: +91XXXXXXXXXX (no 'whatsapp:' prefix — Cloud API wants bare E.164)."""
    if not (WA_TOKEN and WA_PHONE_ID):
        raise RuntimeError("WhatsApp Cloud API not configured")
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"https://graph.facebook.com/v21.0/{WA_PHONE_ID}/messages",
            headers={"Authorization": f"Bearer {WA_TOKEN}"},
            json={
                "messaging_product": "whatsapp",
                "to": to.lstrip("+"),
                "type": "text",
                "text": {"body": text},
            },
        )
        r.raise_for_status()


async def slack_alert(text: str) -> None:
    """Fire-and-forget ops alert. Never raises — alerting must not break flows."""
    if not SLACK_WEBHOOK:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            await c.post(SLACK_WEBHOOK, json={"text": text})
    except Exception:
        pass
