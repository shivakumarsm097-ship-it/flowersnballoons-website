"""Vendor & Staff Coordination test — the roster loop (spec §6.4):

  1. package tiers determine roles (basic → decorator; premium → +photo +activity)
  2. candidate filtering: service area, busy-on-date, already-tried
  3. decline → automatic advance to next candidate
  4. roster exhausted → immediate at-risk escalation (customer told)
  5. response timeout → no_response → next candidate (48/24h windows)
  6. imminent event (<3 days): 4h window + immediate escalation on timeout
  7. accept-then-cancel → urgent re-dispatch, confirmed booking demoted
  8. vendor reminders (48h + morning-of)
  9. weekly decline summary

Run: .venv/bin/python -m tests.test_vendor_coordination
"""
from __future__ import annotations

import asyncio
import os
from datetime import date, datetime, timedelta, timezone

os.environ.setdefault("DAILY_EVENT_CAPACITY", "5")  # capacity not under test here

from tests.test_chain import TABLES, fake_insert  # noqa: E402  (applies DB fakes)

import backend.vendor_dispatch as vd  # noqa: E402
import modules.booking_payment.agent as bp  # noqa: E402
from backend.db import client as db  # noqa: E402

SENT: list[tuple[str, str]] = []
ALERTS: list[str] = []


async def fake_wa(to, text):
    SENT.append((to, text))


async def fake_slack(text):
    ALERTS.append(text)


vd.send_whatsapp = fake_wa
vd.slack_alert = fake_slack
bp.send_whatsapp = fake_wa
bp.slack_alert = fake_slack

FAR = date.today() + timedelta(days=30)     # 24h window band
SOON = date.today() + timedelta(days=1)     # <3 days → 4h window


def iso_ago(hours):
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def wa_to(contact):
    return [t for to, t in SENT if to == contact]


async def main():
    # ── 1. role requirements by package ──
    assert vd.required_roles("birthday", None) == ["decorator"]
    assert set(vd.required_roles("birthday", "Premium")) == {"decorator", "photographer", "activity-staff"}
    assert "caterer" in vd.required_roles("wedding", "Royal + catering")

    # ── 2. candidate filtering ──
    lead = await fake_insert("leads", {"source": "web", "phone": "+919111111111", "area": "Koramangala"})
    v_kor = await fake_insert("vendors", {"name": "KorDecor", "role": "decorator", "contact": "+919000000001", "service_areas": ["Koramangala", "HSR"]})
    v_wf = await fake_insert("vendors", {"name": "WFDecor", "role": "decorator", "contact": "+919000000002", "service_areas": ["Whitefield"]})
    v_any = await fake_insert("vendors", {"name": "AnyDecor", "role": "decorator", "contact": "+919000000003", "service_areas": []})

    b1 = await fake_insert("bookings", {
        "lead_id": lead["id"], "date": FAR.isoformat(), "event_type": "birthday",
        "location": "Koramangala", "package": "Basic", "price": 1800, "total_price": 6000,
        "status": "pending_vendors", "razorpay_payment_id": "pay_1",
    })
    cands = await vd._candidates(b1, "decorator")
    names = [c["name"] for c in cands]
    assert "WFDecor" not in names, "out-of-area vendor excluded"
    assert "KorDecor" in names and "AnyDecor" in names, "area match + empty-area vendor included"

    # busy-on-date exclusion: commit KorDecor to another booking same date
    other = await fake_insert("bookings", {"lead_id": lead["id"], "date": FAR.isoformat(), "event_type": "haldi", "status": "confirmed"})
    await fake_insert("vendor_assignments", {"booking_id": other["id"], "vendor_id": v_kor["id"], "role": "decorator", "status": "accepted", "requested_at": iso_ago(1)})
    cands = await vd._candidates(b1, "decorator")
    assert [c["name"] for c in cands] == ["AnyDecor"], "busy vendor excluded"

    # ── 3. dispatch → decline → auto-advance ──
    await vd.dispatch_for_booking(b1)
    assert "New job" in wa_to("+919000000003")[-1], "AnyDecor got the brief"
    assert "₹2,400" in wa_to("+919000000003")[-1], "expected pay (40% of 6000) in brief"
    await vd.handle_vendor_reply(v_any, f"NO {b1['id'][:8]}")
    # AnyDecor declined; already-tried filter leaves nobody (KorDecor busy) → escalated
    assert b1["status"] == "at_risk", "roster exhausted → immediate at-risk"
    assert any("REFUND" in t for to, t in SENT if to == "+919111111111"), "customer told, offered choice"
    assert any("EXHAUSTED" in a or "AT RISK" in a for a in ALERTS)

    # ── 5. timeout → no_response → advance ──
    lead2 = await fake_insert("leads", {"source": "web", "phone": "+919222222222", "area": "HSR"})
    b2 = await fake_insert("bookings", {
        "lead_id": lead2["id"], "date": (date.today() + timedelta(days=10)).isoformat(),
        "event_type": "engagement", "location": "HSR", "package": "Basic",
        "price": 2400, "total_price": 8000, "status": "pending_vendors", "razorpay_payment_id": "pay_2",
    })
    v_h1 = await fake_insert("vendors", {"name": "H1", "role": "decorator", "contact": "+919000000011", "service_areas": ["HSR"]})
    v_h2 = await fake_insert("vendors", {"name": "H2", "role": "decorator", "contact": "+919000000012", "service_areas": ["HSR"]})
    a2 = await fake_insert("vendor_assignments", {"booking_id": b2["id"], "vendor_id": v_h1["id"], "role": "decorator", "status": "requested", "requested_at": iso_ago(25)})  # 3-14d band → 24h window
    n_sent = len(SENT)
    await vd.advance_stale_assignments()
    assert a2["status"] == "no_response", "24h timeout marked"
    new_briefs = [(to, t) for to, t in SENT[n_sent:] if "New job" in t]
    assert new_briefs and new_briefs[0][0] != "+919000000011", "advanced to a NEXT candidate (not the timed-out one)"
    next_assignee = [a for a in TABLES["vendor_assignments"] if a["booking_id"] == b2["id"] and a["status"] == "requested"]
    assert next_assignee and next_assignee[0]["vendor_id"] != v_h1["id"], "fresh assignment row for a different vendor"
    assert b2["status"] == "pending_vendors", "10-days-out event: no premature escalation"

    # ── 6. imminent event: 4h window + immediate escalation ──
    lead3 = await fake_insert("leads", {"source": "web", "phone": "+919333333333", "area": "Indiranagar"})
    b3 = await fake_insert("bookings", {
        "lead_id": lead3["id"], "date": SOON.isoformat(), "event_type": "birthday",
        "location": "Indiranagar", "package": "Basic", "price": 1500, "total_price": 5000,
        "status": "pending_vendors", "razorpay_payment_id": "pay_3",
    })
    v_i1 = await fake_insert("vendors", {"name": "I1", "role": "decorator", "contact": "+919000000021", "service_areas": []})
    v_i2 = await fake_insert("vendors", {"name": "I2", "role": "decorator", "contact": "+919000000022", "service_areas": []})
    a3 = await fake_insert("vendor_assignments", {"booking_id": b3["id"], "vendor_id": v_i1["id"], "role": "decorator", "status": "requested", "requested_at": iso_ago(5)})  # > 4h window
    await vd.advance_stale_assignments()
    assert a3["status"] == "no_response"
    assert b3["status"] == "at_risk", "imminent event escalates on FIRST blown window"
    assert any("New job" in t for to, t in SENT if to == "+919000000022"), "still keeps trying next candidate"

    # ── 7. accept-then-cancel → urgent re-dispatch + demotion ──
    a3b = [a for a in TABLES["vendor_assignments"] if a["booking_id"] == b3["id"] and a["status"] == "requested"][-1]
    await vd.handle_vendor_reply(v_i2, f"YES {b3['id'][:8]}")
    assert a3b["status"] == "accepted"
    b3["status"] = "confirmed"  # (accept flow confirms; force for clarity)
    await vd.handle_vendor_reply(v_i2, f"CANCEL {b3['id'][:8]}")
    assert a3b["status"] == "declined"
    assert b3["status"] in ("pending_vendors", "at_risk"), "confirmed booking demoted on vendor cancel"
    assert any("CANCELLED accepted" in a for a in ALERTS), "urgent alert fired"

    # ── 8. reminders: 48h + morning-of ──
    lead4 = await fake_insert("leads", {"source": "web", "phone": "+919444444444"})
    for offset in (2, 0):
        d = (date.today() + timedelta(days=offset)).isoformat()
        bk = await fake_insert("bookings", {"lead_id": lead4["id"], "date": d, "event_type": "haldi", "location": "JP Nagar", "status": "confirmed"})
        await fake_insert("vendor_assignments", {"booking_id": bk["id"], "vendor_id": v_h2["id"], "role": "decorator", "status": "accepted", "requested_at": iso_ago(50)})
    n_before = len(wa_to("+919000000012"))
    await vd.vendor_reminders()
    reminders = wa_to("+919000000012")[n_before:]
    assert len(reminders) == 2 and any("TODAY" in r for r in reminders) and any("2 days" in r for r in reminders)

    # ── 9. weekly decline summary ──
    ALERTS.clear()
    await vd.weekly_decline_summary()
    assert any("Weekly vendor declines" in a for a in ALERTS)

    print("ALL VENDOR COORDINATION TESTS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
