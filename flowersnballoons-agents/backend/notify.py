"""Outbound channels: WhatsApp (Meta Cloud API), Instagram, Slack, owner alerts.

Every customer/vendor-facing send routes through actions.execute_or_shadow —
SHADOW_MODE records the intent instead of firing. slack_alert and
send_owner_alert deliberately bypass shadow: monitoring must reach a human
during the shadow week.
"""
from __future__ import annotations

import os

import httpx

from backend.actions import execute_or_shadow

WA_TOKEN = os.environ.get("WHATSAPP_ACCESS_TOKEN", "")
WA_PHONE_ID = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
SLACK_WEBHOOK = os.environ.get("SLACK_WEBHOOK_URL", "")
IG_TOKEN = os.environ.get("INSTAGRAM_ACCESS_TOKEN", "")
IG_USER_ID = os.environ.get("INSTAGRAM_USER_ID", "")
OWNER_WHATSAPP = os.environ.get("OWNER_WHATSAPP_NUMBER", "")


async def _wa_send_raw(to: str, text: str) -> None:
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


async def send_whatsapp(to: str, text: str) -> None:
    """to: +91XXXXXXXXXX (no 'whatsapp:' prefix — Cloud API wants bare E.164)."""
    await execute_or_shadow("whatsapp.send", to, text, lambda: _wa_send_raw(to, text))


async def send_instagram_dm(recipient_id: str, text: str) -> None:
    async def _raw():
        if not (IG_TOKEN and IG_USER_ID):
            raise RuntimeError("Instagram Graph API not configured")
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                f"https://graph.facebook.com/v21.0/{IG_USER_ID}/messages",
                params={"access_token": IG_TOKEN},
                json={"recipient": {"id": recipient_id}, "message": {"text": text}},
            )
            r.raise_for_status()

    await execute_or_shadow("instagram.dm", recipient_id, text, _raw)


async def reply_instagram_comment(comment_id: str, text: str) -> None:
    async def _raw():
        if not IG_TOKEN:
            raise RuntimeError("Instagram Graph API not configured")
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                f"https://graph.facebook.com/v21.0/{comment_id}/replies",
                params={"access_token": IG_TOKEN},
                json={"message": text},
            )
            r.raise_for_status()

    await execute_or_shadow("instagram.comment_reply", comment_id, text, _raw)


async def publish_instagram_post(image_url: str, caption: str) -> str:
    """Two-step Graph publish: create media container → publish. Returns IG media id."""
    async def _raw() -> str:
        if not (IG_TOKEN and IG_USER_ID):
            raise RuntimeError("Instagram Graph API not configured")
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(
                f"https://graph.facebook.com/v21.0/{IG_USER_ID}/media",
                params={"access_token": IG_TOKEN},
                json={"image_url": image_url, "caption": caption},
            )
            r.raise_for_status()
            container_id = r.json()["id"]
            r = await c.post(
                f"https://graph.facebook.com/v21.0/{IG_USER_ID}/media_publish",
                params={"access_token": IG_TOKEN},
                json={"creation_id": container_id},
            )
            r.raise_for_status()
            return r.json()["id"]

    return await execute_or_shadow(
        "instagram.post", None, f"{image_url}\n\n{caption}", _raw,
        shadow_result="shadow_ig_media",
    )


async def instagram_media_insights(media_id: str) -> dict:
    """Likes + comments counts for a published post (read-only — no shadow)."""
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(
            f"https://graph.facebook.com/v21.0/{media_id}",
            params={"access_token": IG_TOKEN, "fields": "like_count,comments_count"},
        )
        r.raise_for_status()
        d = r.json()
        return {"likes": d.get("like_count", 0), "comments": d.get("comments_count", 0)}


async def send_owner_alert(message: str) -> None:
    """Real-time WhatsApp to the owner. DELIBERATELY bypasses shadow mode —
    escalation alerts must reach a human even (especially) during the shadow
    week. Never raises: alerting must not break the flow it's reporting on."""
    if not OWNER_WHATSAPP:
        return
    try:
        await _wa_send_raw(OWNER_WHATSAPP, f"🔔 FnB: {message}")
    except Exception:
        pass


async def slack_alert(text: str) -> None:
    """Fire-and-forget ops alert. Never raises — alerting must not break flows."""
    if not SLACK_WEBHOOK:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            await c.post(SLACK_WEBHOOK, json={"text": text})
    except Exception:
        pass
