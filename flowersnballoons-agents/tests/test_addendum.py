"""Addendum test — the five improvements:

  1. shadow mode: sends/charges intercepted into shadow_actions, live path when off
  2. owner alerts: fire on escalation AND bypass shadow
  3. reliability: score weights, rolling window, complaints, per-vendor daily
     capacity, score-first ranking, ~5-point rotation band
  4. seasonal pricing: raised floor enforced, label surfaced to the model
  5. repeat nudges: recurring set for birthdays not weddings, one nudge only,
     dissatisfied customers skipped

Run: .venv/bin/python -m tests.test_addendum
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
from datetime import date, datetime, timedelta, timezone

os.environ.setdefault("DAILY_EVENT_CAPACITY", "5")
os.environ.setdefault("RAZORPAY_WEBHOOK_SECRET", "test-secret")

from tests.test_chain import TABLES, fake_insert  # noqa: E402  (applies DB fakes)

import importlib  # noqa: E402

import backend.notify as notify  # noqa: E402

# test_chain's module-level patches clobber notify.send_whatsapp with a fake —
# reload to restore the REAL shadow-routing functions, then stub only the
# lowest-level raw sender so nothing hits the network.
importlib.reload(notify)

import backend.payments as payments  # noqa: E402
import backend.vendor_dispatch as vd  # noqa: E402
from backend.db import client as db  # noqa: E402

WA_RAW: list[tuple[str, str]] = []


async def fake_wa_raw(to, text):
    WA_RAW.append((to, text))


notify._wa_send_raw = fake_wa_raw
notify.OWNER_WHATSAPP = "+918867121207"


def iso_ago(**kw):
    return (datetime.now(timezone.utc) - timedelta(**kw)).isoformat()


def d_ago(days):
    return (date.today() - timedelta(days=days)).isoformat()


async def main():
    # ── 1. SHADOW MODE ──
    os.environ["SHADOW_MODE"] = "true"

    await notify.send_whatsapp("+919111111111", "hello from shadow")  # unconfigured API — must NOT raise
    assert TABLES["shadow_actions"][-1]["action_type"] == "whatsapp.send"
    assert TABLES["shadow_actions"][-1]["recipient"] == "+919111111111"

    link = await payments.create_payment_link(1800, "test advance", "+919111111111", "hold-abc-123")
    assert link["id"].startswith("shadow_plink_"), "no real charge in shadow"
    row = TABLES["shadow_actions"][-1]
    assert row["action_type"] == "razorpay.payment_link" and row["would_charge_amount"] == 1800

    rf = await payments.refund_payment("pay_test", 1800)
    assert rf["id"].startswith("shadow_rfnd_")

    post = await notify.publish_instagram_post("https://x/img.jpg", "caption")
    assert post == "shadow_ig_media"
    assert TABLES["shadow_actions"][-1]["action_type"] == "instagram.post"

    # ── 2. owner alerts bypass shadow ──
    WA_RAW.clear()
    await notify.send_owner_alert("roster exhausted test")
    assert WA_RAW and WA_RAW[-1][0] == "+918867121207", "owner alert sent for real DURING shadow"
    assert "roster exhausted test" in WA_RAW[-1][1]

    os.environ["SHADOW_MODE"] = "false"
    try:
        # notify module was imported with empty tokens → live path must raise
        import backend.notify as n2
        n2._wa_send_raw = notify.__dict__["_wa_send_raw"]  # keep raw fake off for this check
        raised = False
        n_shadow = len(TABLES["shadow_actions"])

        async def boom():
            raise RuntimeError("live path reached")

        from backend.actions import execute_or_shadow
        try:
            await execute_or_shadow("whatsapp.send", "+91x", "y", boom)
        except RuntimeError:
            raised = True
        assert raised and len(TABLES["shadow_actions"]) == n_shadow, "SHADOW_MODE=false → executor runs, nothing recorded"
    finally:
        pass

    # ── 3. RELIABILITY ──
    # weights: on-time failure hurts more than accept failure
    perfect = vd.compute_reliability(1.0, 1.0, 0)
    low_accept = vd.compute_reliability(0.5, 1.0, 0)
    low_ontime = vd.compute_reliability(1.0, 0.5, 0)
    complained = vd.compute_reliability(1.0, 1.0, 2)
    assert perfect == 100.0
    assert low_ontime < low_accept, "on-time weighted heavier than accept rate"
    assert complained < perfect

    # rolling window recompute
    v1 = await fake_insert("vendors", {"name": "Solid", "role": "decorator", "contact": "+919000000031", "service_areas": []})
    for i in range(10):
        await fake_insert("vendor_assignments", {"vendor_id": v1["id"], "booking_id": f"b{i}", "role": "decorator",
                                                 "status": "accepted", "arrived_on_time": True, "requested_at": iso_ago(days=i + 1)})
    score1 = await vd.recompute_reliability(v1["id"])
    assert score1 == 100.0 and v1["accept_rate"] == 1.0

    v2 = await fake_insert("vendors", {"name": "Flaky", "role": "decorator", "contact": "+919000000032", "service_areas": []})
    for i in range(5):
        await fake_insert("vendor_assignments", {"vendor_id": v2["id"], "booking_id": f"c{i}", "role": "decorator",
                                                 "status": "declined" if i % 2 else "accepted",
                                                 "arrived_on_time": (i == 0), "requested_at": iso_ago(days=i + 1)})
    score2 = await vd.recompute_reliability(v2["id"])
    assert score2 < score1, "flaky vendor scores below solid one"

    # per-vendor daily capacity: max_events_per_day=2 → still eligible with 1 accepted job
    lead = await fake_insert("leads", {"source": "web", "phone": "+919555000001", "area": "HSR"})
    D = (date.today() + timedelta(days=20)).isoformat()
    v1["max_events_per_day"] = 2
    existing = await fake_insert("bookings", {"lead_id": lead["id"], "date": D, "event_type": "birthday", "status": "confirmed"})
    await fake_insert("vendor_assignments", {"vendor_id": v1["id"], "booking_id": existing["id"], "role": "decorator", "status": "accepted"})

    target = await fake_insert("bookings", {"lead_id": lead["id"], "date": D, "event_type": "haldi",
                                            "location": "HSR", "package": "Basic", "status": "pending_vendors", "total_price": 8000})
    cands = await vd._candidates(target, "decorator")
    names = [c["name"] for c in cands]
    assert "Solid" in names, "capacity 2 with 1 job → still eligible"
    v1["max_events_per_day"] = 1
    cands = await vd._candidates(target, "decorator")
    assert "Solid" not in [c["name"] for c in cands], "capacity 1 with 1 job → excluded"
    v1["max_events_per_day"] = 2

    # score-first ranking: Solid (100) ahead of Flaky
    cands = await vd._candidates(target, "decorator")
    assert cands[0]["name"] == "Solid", f"reliability-ranked first, got {[c['name'] for c in cands]}"

    # rotation band: two vendors within 5 points → least-loaded first
    v3 = await fake_insert("vendors", {"name": "AlsoSolid", "role": "decorator", "contact": "+919000000033",
                                       "service_areas": [], "reliability_score": 97.0, "max_events_per_day": 3})
    # Solid currently has 11 open/accepted assignments; AlsoSolid has none → AlsoSolid rotates in
    cands = await vd._candidates(target, "decorator")
    assert cands[0]["name"] == "AlsoSolid", "within-band rotation prefers the less-loaded near-equal"

    # ── 4. SEASONAL PRICING ──
    import modules.lead_quote.agent as lq
    festival_day = (date.today() + timedelta(days=25))
    await fake_insert("seasonal_pricing", {"date_range_start": (festival_day - timedelta(days=5)).isoformat(),
                                           "date_range_end": (festival_day + timedelta(days=5)).isoformat(),
                                           "label": "Diwali season", "multiplier": 1.25})
    lead_s = await fake_insert("leads", {"source": "whatsapp", "phone": "+919555000002", "event_type": "birthday"})
    out = await lq._run_tool("check_availability", {"date": festival_day.isoformat()}, lead_s)
    assert "Diwali season" in out and "1.25" in out, "seasonal surfaced before quoting"

    # floor rises: birthday 4500 * 1.25 = 5625 → 5000 refused, 6000 accepted
    out = await lq._run_tool("quote_and_hold", {"date": festival_day.isoformat(), "event_type": "birthday",
                                                "total_price_inr": 5000, "line_items": ["Base — ₹5,000"]}, lead_s)
    assert out.startswith("REFUSED") and "Diwali" in out, "seasonal floor enforced"
    out = await lq._run_tool("quote_and_hold", {"date": festival_day.isoformat(), "event_type": "birthday",
                                                "total_price_inr": 6000, "line_items": ["Base — ₹5,625", "Arch — ₹375"]}, lead_s)
    assert "STATE THIS PLAINLY" in out, "model instructed to state seasonal pricing openly"

    # ── 5. REPEAT NUDGES ──
    # recurring set for birthday, not for wedding (via the real payment webhook)
    from backend.webhooks import razorpay as rzp
    import modules.booking_payment.agent as bp
    bp.send_whatsapp = lambda *a: asyncio.sleep(0)
    bp.slack_alert = lambda *a: asyncio.sleep(0)
    vd.send_whatsapp = lambda *a: asyncio.sleep(0)
    vd.slack_alert = lambda *a: asyncio.sleep(0)

    async def paid_webhook(link_id):
        payload = {"event": "payment_link.paid",
                   "payload": {"payment_link": {"entity": {"id": link_id, "amount": 500000}},
                               "payment": {"entity": {"id": f"pay_{link_id}"}}}}
        body = json.dumps(payload).encode()
        sig = hmac.new(b"test-secret", body, hashlib.sha256).hexdigest()

        class Req:
            headers = {"x-razorpay-signature": sig}
            async def body(self_):
                return body
            async def json(self_):
                return payload
        return await rzp.razorpay_webhook(Req())

    lead_r = await fake_insert("leads", {"source": "web", "phone": "+919555000003", "name": "Priya", "area": "HSR"})
    h_bday = await fake_insert("calendar_holds", {"date": (date.today() + timedelta(days=15)).isoformat(), "event_type": "birthday",
                                                  "lead_id": lead_r["id"], "quoted_price": 6000, "razorpay_link_id": "plink_bday",
                                                  "status": "active", "expires_at": iso_ago(hours=-2)})
    h_wed = await fake_insert("calendar_holds", {"date": (date.today() + timedelta(days=16)).isoformat(), "event_type": "wedding",
                                                 "lead_id": lead_r["id"], "quoted_price": 20000, "razorpay_link_id": "plink_wed",
                                                 "status": "active", "expires_at": iso_ago(hours=-2)})
    r1 = await paid_webhook("plink_bday")
    r2 = await paid_webhook("plink_wed")
    b_bday = next(b for b in TABLES["bookings"] if b["id"] == r1["booking_id"])
    b_wed = next(b for b in TABLES["bookings"] if b["id"] == r2["booking_id"])
    assert b_bday["recurring_occasion_date"] == b_bday["date"], "birthday → recurring set"
    assert b_wed["recurring_occasion_date"] is None, "wedding → never recurring"

    # nudge fires once at ~11 months, skips dissatisfied
    from orchestrator import cron
    NUDGES: list[tuple[str, str]] = []

    async def nudge_wa(to, text):
        NUDGES.append((to, text))

    cron.send_whatsapp = nudge_wa
    cron.slack_alert = lambda *a: asyncio.sleep(0)

    lead_n = await fake_insert("leads", {"source": "web", "phone": "+919555000004", "name": "Meera"})
    b_n = await fake_insert("bookings", {"lead_id": lead_n["id"], "date": d_ago(335), "event_type": "birthday",
                                         "status": "done", "recurring_occasion_date": d_ago(335)})
    lead_sad = await fake_insert("leads", {"source": "web", "phone": "+919555000005"})
    b_sad = await fake_insert("bookings", {"lead_id": lead_sad["id"], "date": d_ago(335), "event_type": "birthday",
                                           "status": "done", "recurring_occasion_date": d_ago(335),
                                           "review_outcome": "dissatisfied"})
    await cron.repeat_customer_nudges()
    assert len(NUDGES) == 1 and NUDGES[0][0] == "+919555000004", "one nudge, dissatisfied skipped"
    assert "Meera" in NUDGES[0][1] and d_ago(335) in NUDGES[0][1], "references the specific past event"
    assert b_n["repeat_nudge_sent"] and b_sad["repeat_nudge_sent"]
    await cron.repeat_customer_nudges()
    assert len(NUDGES) == 1, "never a second nudge"

    print("ALL ADDENDUM TESTS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
