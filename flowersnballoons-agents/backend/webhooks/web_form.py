"""Receives the static site's contact/quote form POST.

Resilience rule: a lead must NEVER be lost. If Supabase is down or not
yet configured, the payload is appended to logs/failed_leads.jsonl and a
Slack alert fires — the form user still gets a 200.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Request

from backend.db import client as db
from backend.notify import slack_alert
from orchestrator.logger import log_action

router = APIRouter()

FALLBACK = Path(os.environ.get("LOG_DIR", Path(__file__).resolve().parents[2] / "logs")) / "failed_leads.jsonl"


def _normalize_phone(raw: str) -> str:
    digits = "".join(ch for ch in raw if ch.isdigit())
    if digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 10:
        digits = "91" + digits
    return "+" + digits if digits else ""


@router.post("/webhooks/web-form")
async def web_form(request: Request):
    ct = request.headers.get("content-type", "")
    if "application/json" in ct:
        body = await request.json()
    else:
        form = await request.form()
        body = dict(form)

    fields = {
        "source": "web",
        "name": (body.get("name") or "").strip()[:80] or None,
        "phone": _normalize_phone(body.get("phone") or body.get("mobile") or "") or None,
        "email": (body.get("email") or "").strip()[:120] or None,
        "event_type": (body.get("service") or body.get("event_type") or "").strip()[:40] or None,
        "raw_message": (body.get("message") or "").strip()[:2000] or None,
        "budget_range": (body.get("budget") or "").strip()[:40] or None,
    }

    try:
        if not db.configured():
            raise RuntimeError("Supabase not configured")
        if fields["phone"] and await db.recent_duplicate_lead(fields["phone"]):
            log_action("lead_quote", actions_skipped_or_escalated=[f"duplicate web lead {fields['phone']}"])
            return {"ok": True, "dedup": True}
        lead = await db.create_lead(**fields)
        log_action("lead_quote", actions_taken=[f"stored web lead {lead['id']} ({fields['phone']})"])
        await slack_alert(f"🌐 New web lead: {fields['name'] or '—'} {fields['phone'] or ''} — {fields['event_type'] or 'unspecified'}")
        return {"ok": True, "lead_id": lead["id"]}
    except Exception as e:
        FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        with FALLBACK.open("a") as f:
            f.write(json.dumps({"ts": datetime.now(timezone.utc).isoformat(), "fields": fields}) + "\n")
        log_action("lead_quote", errors=[f"web lead DB write failed, saved to fallback: {e}"])
        await slack_alert(f"⚠️ Web lead DB write FAILED (saved to fallback file): {e}")
        return {"ok": True, "fallback": True}
