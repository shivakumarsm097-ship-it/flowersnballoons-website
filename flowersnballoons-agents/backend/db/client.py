"""Thin Supabase (PostgREST) client — httpx only, no heavy SDK.

Every table helper the webhooks and agents need lives here so the rest of
the codebase never builds a REST query by hand.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


def configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_KEY)


def _url(table: str) -> str:
    return f"{SUPABASE_URL}/rest/v1/{table}"


async def _get(table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(_url(table), params=params, headers=_HEADERS)
        r.raise_for_status()
        return r.json()


async def _insert(table: str, row: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(_url(table), json=row, headers=_HEADERS)
        r.raise_for_status()
        return r.json()[0]


async def _update(table: str, params: dict[str, str], patch: dict[str, Any]) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.patch(_url(table), params=params, json=patch, headers=_HEADERS)
        r.raise_for_status()
        return r.json()


async def _delete(table: str, params: dict[str, str]) -> None:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.delete(_url(table), params=params, headers=_HEADERS)
        r.raise_for_status()


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── leads ──────────────────────────────────────────────────────────────
async def create_lead(**fields: Any) -> dict[str, Any]:
    return await _insert("leads", fields)


async def get_lead(lead_id: str) -> dict[str, Any] | None:
    rows = await _get("leads", {"id": f"eq.{lead_id}"})
    return rows[0] if rows else None


async def find_lead_by_phone(phone: str) -> dict[str, Any] | None:
    rows = await _get("leads", {"phone": f"eq.{phone}", "order": "created_at.desc", "limit": "1"})
    return rows[0] if rows else None


async def set_lead_status(lead_id: str, status: str) -> None:
    await _update("leads", {"id": f"eq.{lead_id}"}, {"status": status})


async def recent_duplicate_lead(phone: str, hours: int = 12) -> bool:
    since = (_now() - timedelta(hours=hours)).isoformat()
    rows = await _get("leads", {"phone": f"eq.{phone}", "created_at": f"gte.{since}", "limit": "1"})
    return bool(rows)


async def touch_lead(lead_id: str, **extra: Any) -> None:
    await _update("leads", {"id": f"eq.{lead_id}"}, {"last_contact_at": _now().isoformat(), **extra})


async def leads_needing_followup(hours: float = 24) -> list[dict[str, Any]]:
    cutoff = (_now() - timedelta(hours=hours)).isoformat()
    return await _get(
        "leads",
        {"status": "in.(engaged,quoted)", "followup_sent": "eq.false", "last_contact_at": f"lt.{cutoff}"},
    )


async def leads_gone_cold(days: float = 3) -> list[dict[str, Any]]:
    cutoff = (_now() - timedelta(days=days)).isoformat()
    return await _get(
        "leads",
        {"status": "in.(new,engaged,quoted)", "last_contact_at": f"lt.{cutoff}"},
    )


# ── conversations ─────────────────────────────────────────────────────
async def add_message(lead_id: str, role: str, content: str) -> None:
    await _insert("conversations", {"lead_id": lead_id, "role": role, "content": content})


async def conversation_history(lead_id: str, limit: int = 20) -> list[dict[str, Any]]:
    rows = await _get(
        "conversations",
        {"lead_id": f"eq.{lead_id}", "order": "created_at.desc", "limit": str(limit)},
    )
    return list(reversed(rows))


# ── calendar_holds ─────────────────────────────────────────────────────
async def active_holds_on(d: date) -> list[dict[str, Any]]:
    return await _get(
        "calendar_holds",
        {"date": f"eq.{d.isoformat()}", "status": "eq.active", "expires_at": f"gt.{_now().isoformat()}"},
    )


async def create_hold(d: date, event_type: str, lead_id: str, ttl_hours: float, **extra: Any) -> dict[str, Any]:
    return await _insert(
        "calendar_holds",
        {
            "date": d.isoformat(),
            "event_type": event_type,
            "lead_id": lead_id,
            "status": "active",
            "expires_at": (_now() + timedelta(hours=ttl_hours)).isoformat(),
            **extra,
        },
    )


async def delete_hold(hold_id: str) -> None:
    await _delete("calendar_holds", {"id": f"eq.{hold_id}"})


async def convert_hold(hold_id: str) -> None:
    """Paid: mark converted — an audit trail, not a deletion (spec §3)."""
    await _update("calendar_holds", {"id": f"eq.{hold_id}"}, {"status": "converted"})


async def expire_hold(hold_id: str) -> None:
    await _update("calendar_holds", {"id": f"eq.{hold_id}"}, {"status": "expired"})


async def active_hold_for_lead(lead_id: str) -> dict[str, Any] | None:
    rows = await _get(
        "calendar_holds",
        {"lead_id": f"eq.{lead_id}", "status": "eq.active", "order": "created_at.desc", "limit": "1"},
    )
    return rows[0] if rows else None


async def attach_payment_link(hold_id: str, link_id: str) -> None:
    await _update("calendar_holds", {"id": f"eq.{hold_id}"}, {"razorpay_link_id": link_id})


async def hold_by_payment_link(link_id: str) -> dict[str, Any] | None:
    rows = await _get("calendar_holds", {"razorpay_link_id": f"eq.{link_id}"})
    return rows[0] if rows else None


async def sweep_expired_holds() -> None:
    await _update(
        "calendar_holds",
        {"status": "eq.active", "expires_at": f"lt.{_now().isoformat()}"},
        {"status": "expired"},
    )


async def holds_expiring_within(hours: float) -> list[dict[str, Any]]:
    now = _now()
    return await _get(
        "calendar_holds",
        {
            "status": "eq.active",
            "expires_at": f"gt.{now.isoformat()}",
            "and": f"(expires_at.lt.{(now + timedelta(hours=hours)).isoformat()})",
        },
    )


# ── bookings ───────────────────────────────────────────────────────────
async def bookings_on(d: date) -> list[dict[str, Any]]:
    return await _get(
        "bookings",
        {"date": f"eq.{d.isoformat()}", "status": "not.in.(refunded,cancelled)"},
    )


async def create_booking(**fields: Any) -> dict[str, Any]:
    return await _insert("bookings", fields)


async def get_booking(booking_id: str) -> dict[str, Any] | None:
    rows = await _get("bookings", {"id": f"eq.{booking_id}"})
    return rows[0] if rows else None


async def set_booking(booking_id: str, **patch: Any) -> None:
    await _update("bookings", {"id": f"eq.{booking_id}"}, patch)


async def bookings_pending_vendors_since(hours: float) -> list[dict[str, Any]]:
    cutoff = (_now() - timedelta(hours=hours)).isoformat()
    return await _get(
        "bookings",
        {"status": "eq.pending_vendors", "created_at": f"lt.{cutoff}"},
    )


async def bookings_finished_yesterday() -> list[dict[str, Any]]:
    y = (_now() - timedelta(days=1)).date().isoformat()
    return await _get("bookings", {"date": f"eq.{y}", "status": "in.(confirmed,done)"})


async def active_booking_for_phone(phone: str) -> dict[str, Any] | None:
    lead = await find_lead_by_phone(phone)
    if not lead:
        return None
    rows = await _get(
        "bookings",
        {"lead_id": f"eq.{lead['id']}", "status": "in.(pending_vendors,confirmed,at_risk,rescheduling)",
         "order": "created_at.desc", "limit": "1"},
    )
    return rows[0] if rows else None


async def bookings_due_balance_reminder(days_min: int = 3, days_max: int = 5) -> list[dict[str, Any]]:
    lo = (_now() + timedelta(days=days_min)).date().isoformat()
    hi = (_now() + timedelta(days=days_max)).date().isoformat()
    return await _get(
        "bookings",
        {"status": "eq.confirmed", "balance_reminder_sent": "eq.false",
         "date": f"gte.{lo}", "and": f"(date.lte.{hi})"},
    )


async def at_risk_bookings_older_than(hours: float) -> list[dict[str, Any]]:
    cutoff = (_now() - timedelta(hours=hours)).isoformat()
    return await _get("bookings", {"status": "eq.at_risk", "at_risk_at": f"lt.{cutoff}"})


# ── vendors ────────────────────────────────────────────────────────────
async def active_vendors(role: str | None = None) -> list[dict[str, Any]]:
    params: dict[str, str] = {"active": "eq.true"}
    if role:
        params["role"] = f"eq.{role}"
    return await _get("vendors", params)


async def vendor_by_contact(contact: str) -> dict[str, Any] | None:
    rows = await _get("vendors", {"contact": f"eq.{contact}", "active": "eq.true"})
    return rows[0] if rows else None


# ── vendor_assignments ────────────────────────────────────────────────
async def create_assignment(booking_id: str, vendor_id: str, role: str) -> dict[str, Any]:
    return await _insert(
        "vendor_assignments",
        {"booking_id": booking_id, "vendor_id": vendor_id, "role": role},
    )


async def assignments_for_booking(booking_id: str) -> list[dict[str, Any]]:
    return await _get("vendor_assignments", {"booking_id": f"eq.{booking_id}"})


async def open_assignment_for_vendor(vendor_id: str, booking_id: str) -> dict[str, Any] | None:
    rows = await _get(
        "vendor_assignments",
        {"vendor_id": f"eq.{vendor_id}", "booking_id": f"eq.{booking_id}", "status": "eq.requested"},
    )
    return rows[0] if rows else None


async def set_assignment_status(assignment_id: str, status: str) -> None:
    await _update(
        "vendor_assignments",
        {"id": f"eq.{assignment_id}"},
        {"status": status, "responded_at": _now().isoformat()},
    )


async def all_requested_assignments() -> list[dict[str, Any]]:
    return await _get("vendor_assignments", {"status": "eq.requested"})


async def assignments_for_booking_role(booking_id: str, role: str) -> list[dict[str, Any]]:
    return await _get("vendor_assignments", {"booking_id": f"eq.{booking_id}", "role": f"eq.{role}"})


async def vendor_ids_busy_on(d: date) -> set[str]:
    """Vendors already committed (requested or accepted) to any live booking on this date."""
    bookings = await _get(
        "bookings",
        {"date": f"eq.{d.isoformat()}", "status": "in.(pending_vendors,confirmed,at_risk,rescheduling)"},
    )
    busy: set[str] = set()
    for b in bookings:
        for a in await _get(
            "vendor_assignments",
            {"booking_id": f"eq.{b['id']}", "status": "in.(requested,accepted)"},
        ):
            busy.add(a["vendor_id"])
    return busy


async def accepted_assignments_for_event_date(d: date) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for b in await _get("bookings", {"date": f"eq.{d.isoformat()}", "status": "in.(confirmed,pending_vendors)"}):
        for a in await _get("vendor_assignments", {"booking_id": f"eq.{b['id']}", "status": "eq.accepted"}):
            out.append({**a, "booking": b})
    return out


async def declines_since(days: int = 7) -> list[dict[str, Any]]:
    cutoff = (_now() - timedelta(days=days)).isoformat()
    return await _get(
        "vendor_assignments",
        {"status": "in.(declined,no_response)", "responded_at": f"gte.{cutoff}"},
    )
