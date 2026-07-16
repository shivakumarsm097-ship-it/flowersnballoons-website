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


IG_TOKEN = os.environ.get("INSTAGRAM_ACCESS_TOKEN", "")
IG_USER_ID = os.environ.get("INSTAGRAM_USER_ID", "")


async def send_instagram_dm(recipient_id: str, text: str) -> None:
    if not (IG_TOKEN and IG_USER_ID):
        raise RuntimeError("Instagram Graph API not configured")
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"https://graph.facebook.com/v21.0/{IG_USER_ID}/messages",
            params={"access_token": IG_TOKEN},
            json={"recipient": {"id": recipient_id}, "message": {"text": text}},
        )
        r.raise_for_status()


async def reply_instagram_comment(comment_id: str, text: str) -> None:
    if not IG_TOKEN:
        raise RuntimeError("Instagram Graph API not configured")
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            f"https://graph.facebook.com/v21.0/{comment_id}/replies",
            params={"access_token": IG_TOKEN},
            json={"message": text},
        )
        r.raise_for_status()


async def publish_instagram_post(image_url: str, caption: str) -> str:
    """Two-step Graph publish: create media container → publish. Returns IG media id."""
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


async def instagram_media_insights(media_id: str) -> dict:
    """Likes + comments counts for a published post."""
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(
            f"https://graph.facebook.com/v21.0/{media_id}",
            params={"access_token": IG_TOKEN, "fields": "like_count,comments_count"},
        )
        r.raise_for_status()
        d = r.json()
        return {"likes": d.get("like_count", 0), "comments": d.get("comments_count", 0)}


async def slack_alert(text: str) -> None:
    """Fire-and-forget ops alert. Never raises — alerting must not break flows."""
    if not SLACK_WEBHOOK:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            await c.post(SLACK_WEBHOOK, json={"text": text})
    except Exception:
        pass
