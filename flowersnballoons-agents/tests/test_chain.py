"""End-to-end chain test (spec §6.3) with an in-memory fake DB:

  quote hold → capacity blocking → TTL expiry → signed payment webhook →
  booking created → vendor dispatched → vendor accepts → confirmed →
  escalation path for a stuck booking.

Run: .venv/bin/python -m tests.test_chain
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import uuid
from datetime import date, datetime, timedelta, timezone

os.environ.setdefault("RAZORPAY_WEBHOOK_SECRET", "test-secret")
os.environ.setdefault("DAILY_EVENT_CAPACITY", "2")
os.environ.setdefault("HOLD_TTL_HOURS", "2")

from backend.db import client as db  # noqa: E402

# ── in-memory fake PostgREST ──────────────────────────────────────────
TABLES: dict[str, list[dict]] = {"leads": [], "vendors": [], "calendar_holds": [], "bookings": [], "vendor_assignments": [], "conversations": []}


def _match(row: dict, params: dict[str, str]) -> bool:
    for key, cond in params.items():
        if key in ("order", "limit", "and"):
            continue
        val = row.get(key)
        if cond.startswith("eq."):
            if str(val).lower() != cond[3:].lower():  # PostgREST booleans are lowercase
                return False
        elif cond.startswith("gt."):
            if not (val and str(val) > cond[3:]):
                return False
        elif cond.startswith("gte."):
            if not (val and str(val) >= cond[4:]):
                return False
        elif cond.startswith("lt."):
            if not (val and str(val) < cond[3:]):
                return False
        elif cond.startswith("in.("):
            if str(val) not in cond[4:-1].split(","):
                return False
        elif cond.startswith("not.in.("):
            if str(val) in cond[8:-1].split(","):
                return False
    return True


async def fake_get(table, params):
    rows = [r for r in TABLES[table] if _match(r, params)]
    if params.get("limit"):
        rows = rows[: int(params["limit"])]
    return rows


async def fake_insert(table, row):
    row = {"id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc).isoformat(), **row}
    row.setdefault("status", {"leads": "new", "bookings": "pending_vendors", "vendor_assignments": "requested", "calendar_holds": "active"}.get(table))
    if table == "vendor_assignments":
        row.setdefault("requested_at", row["created_at"])  # mirrors Postgres default now()
    row.setdefault("active", True) if table == "vendors" else None
    TABLES[table].append(row)
    return row


async def fake_update(table, params, patch):
    out = []
    for r in TABLES[table]:
        if _match(r, params):
            r.update(patch)
            out.append(r)
    return out


async def fake_delete(table, params):
    TABLES[table][:] = [r for r in TABLES[table] if not _match(r, params)]


db._get, db._insert, db._update, db._delete = fake_get, fake_insert, fake_update, fake_delete

# capture outbound messages instead of hitting Meta/Slack
import backend.notify as notify  # noqa: E402

SENT: list[tuple[str, str]] = []


async def fake_wa(to, text):
    SENT.append((to, text))


notify.send_whatsapp = fake_wa
notify.slack_alert = lambda text: asyncio.sleep(0)

import backend.availability as availability  # noqa: E402
import backend.vendor_dispatch as vd  # noqa: E402

vd.send_whatsapp = fake_wa
vd.slack_alert = notify.slack_alert


async def main():
    d = date.today() + timedelta(days=30)

    # roster: one decorator → capacity = min(1, 2) = 1
    ravi = await fake_insert("vendors", {"name": "Ravi", "role": "decorator", "contact": "+919000000001", "service_areas": []})
    lead1 = await fake_insert("leads", {"source": "web", "phone": "+919111111111", "name": "Meera"})
    lead2 = await fake_insert("leads", {"source": "whatsapp", "phone": "+919222222222", "name": "Arjun"})

    # 1. capacity: single decorator → 1 slot
    assert await availability.capacity_for(d) == 1, "capacity should be decorator-bound"

    # 2. first lead gets the hold
    hold = await availability.try_hold(d, "birthday", lead1["id"])
    assert hold, "first hold must succeed"

    # 3. second lead is blocked while hold lives
    assert await availability.try_hold(d, "birthday", lead2["id"]) is None, "second hold must be refused"
    alts = await availability.nearest_available(d, 2)
    assert len(alts) == 2 and d not in alts, "alternatives offered exclude the held date"

    # 4. TTL expiry frees the slot
    for h in TABLES["calendar_holds"]:
        h["expires_at"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    assert await availability.is_available(d), "expired hold must free the slot"
    await db.sweep_expired_holds()
    assert all(h["status"] == "expired" for h in TABLES["calendar_holds"]), "sweep marks holds expired (audit trail)"

    # 5. fresh hold + payment link → signed razorpay webhook converts it
    hold = await availability.try_hold(d, "birthday", lead1["id"])
    await db.attach_payment_link(hold["id"], "plink_test123")

    from backend.webhooks import razorpay as rzp

    payload = {
        "event": "payment_link.paid",
        "payload": {
            "payment_link": {"entity": {"id": "plink_test123", "amount": 600000}},
            "payment": {"entity": {"id": "pay_test456"}},
        },
    }
    body = json.dumps(payload).encode()
    sig = hmac.new(b"test-secret", body, hashlib.sha256).hexdigest()

    class FakeReq:
        headers = {"x-razorpay-signature": sig}
        async def body(self):
            return body
        async def json(self):
            return payload

    res = await rzp.razorpay_webhook(FakeReq())
    assert res.get("booking_id"), "webhook must create booking"
    booking = TABLES["bookings"][0]
    assert booking["price"] == 6000 and booking["status"] == "pending_vendors"
    assert any(h["status"] == "converted" for h in TABLES["calendar_holds"]), "hold marked converted on payment"
    assert not await db.active_holds_on(d), "converted hold no longer counts against capacity"
    assert TABLES["vendor_assignments"], "vendor dispatched in the SAME webhook call"
    assert any("New job" in t for _, t in SENT), "vendor got the job message"
    assert any("Payment received" in t for _, t in SENT), "customer got payment ack"
    assert not any("fully confirmed" in t for _, t in SENT), "no full confirm before vendor accepts"

    # 6. wrong signature must 403
    class BadReq(FakeReq):
        headers = {"x-razorpay-signature": "junk"}
    try:
        await rzp.razorpay_webhook(BadReq())
        raise AssertionError("bad signature accepted!")
    except Exception as e:
        assert getattr(e, "status_code", None) == 403

    # 7. vendor accepts → booking fully confirmed, customer told
    await vd.handle_vendor_reply(ravi, f"YES {booking['id'][:8]}")
    assert booking["status"] == "confirmed" and booking["confirmed_at"]
    assert any("fully confirmed" in t for _, t in SENT), "customer gets full confirmation"

    # 8. escalation: stuck booking past window → at_risk + refund/reschedule outreach
    stuck = await fake_insert("bookings", {
        "lead_id": lead2["id"], "date": (d + timedelta(days=1)).isoformat(), "event_type": "wedding",
        "price": 15000, "payment_status": "paid", "razorpay_payment_id": "pay_x",
    })
    stuck["created_at"] = (datetime.now(timezone.utc) - timedelta(hours=50)).isoformat()  # past even the 48h far-out window
    await fake_insert("vendor_assignments", {"booking_id": stuck["id"], "vendor_id": ravi["id"], "role": "decorator"})

    from orchestrator import cron
    cron.send_whatsapp = fake_wa
    cron.slack_alert = notify.slack_alert
    await cron.vendor_escalations()
    assert stuck["status"] == "at_risk"
    assert any("REFUND" in t for _, t in SENT), "customer proactively offered refund/reschedule"
    assert all(a["status"] != "requested" for a in TABLES["vendor_assignments"] if a["booking_id"] == stuck["id"])

    print("ALL CHAIN TESTS PASSED")
    print(f"  messages sent: {len(SENT)}")


if __name__ == "__main__":
    asyncio.run(main())
