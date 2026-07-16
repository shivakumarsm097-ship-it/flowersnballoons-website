"""Lead & Quote agent test (spec §6.2) — fake WhatsApp conversation with a
scripted mock LLM. Verifies loop mechanics + guardrails without an API key:

  1. tool loop: check_availability → quote_and_hold → customer message with link
  2. below-floor tool call REFUSED, hold not created
  3. post-check blocks a below-floor price in outbound text
  4. escalation tool path
  5. no-key fallback still answers the customer + alerts Slack

Run: .venv/bin/python -m tests.test_lead_agent
"""
from __future__ import annotations

import asyncio
import os
from datetime import date, timedelta
from types import SimpleNamespace as NS

os.environ.setdefault("DAILY_EVENT_CAPACITY", "2")

# reuse the in-memory fake DB from the chain test (importing applies patches)
from tests.test_chain import TABLES, fake_insert  # noqa: E402

import modules.lead_quote.agent as agent  # noqa: E402
from backend.db import client as db  # noqa: E402

SENT: list[tuple[str, str]] = []
ALERTS: list[str] = []


async def fake_wa(to, text):
    SENT.append((to, text))


async def fake_slack(text):
    ALERTS.append(text)


agent.send_whatsapp = fake_wa
agent.slack_alert = fake_slack

# also silence payment-link creation (razorpay unconfigured in tests)
import backend.payments as payments  # noqa: E402

assert not payments.configured()

D = (date.today() + timedelta(days=45)).isoformat()


class MockLLM:
    """Returns a scripted sequence of responses per .create() call."""

    def __init__(self, script):
        self.script = list(script)
        self.messages = NS(create=self._create)

    async def _create(self, **kwargs):
        return self.script.pop(0)


def text_block(t):
    return NS(type="text", text=t)


def tool_block(name, inp, id_="tu_1"):
    return NS(type="tool_use", name=name, input=inp, id=id_)


def resp(blocks, stop="end_turn"):
    return NS(content=blocks, stop_reason=stop)


async def main():
    agent.enabled = True

    # ── 1. happy path: availability → quote → message with link/hold ──
    lead = await fake_insert("leads", {"source": "whatsapp", "phone": "+919111111111", "name": "Priya", "event_type": "birthday"})
    agent._client = MockLLM([
        resp([tool_block("check_availability", {"date": D})], stop="tool_use"),
        resp([tool_block("quote_and_hold", {
            "date": D, "event_type": "birthday", "total_price_inr": 6000,
            "line_items": ["Base birthday package — ₹4,500", "Balloon arch — ₹1,500"],
        })], stop="tool_use"),
        resp([text_block(f"Here's your quote Priya! 🎈\nBase package ₹4,500 + balloon arch ₹1,500 = ₹6,000 total.\nReply YES to lock in {D}!")]),
    ])
    await agent.handle_inbound(lead, f"hi! birthday decor for my daughter on {D}, around 30 guests, want a balloon arch")

    assert TABLES["calendar_holds"], "quote created the hold"
    assert lead_status(lead) == "quoted"
    assert "₹6,000" in SENT[-1][1], "customer got the itemized quote"
    convo = [r for r in TABLES["conversations"] if r["lead_id"] == lead["id"]]
    assert len(convo) == 2, "history stored both directions"

    # ── 2. below-floor tool call refused ──
    lead2 = await fake_insert("leads", {"source": "whatsapp", "phone": "+919222222222", "event_type": "wedding"})
    holds_before = len(TABLES["calendar_holds"])
    agent._client = MockLLM([
        resp([tool_block("quote_and_hold", {
            "date": (date.today() + timedelta(days=60)).isoformat(), "event_type": "wedding",
            "total_price_inr": 9000, "line_items": ["Basic wedding — ₹9,000"],
        })], stop="tool_use"),
        resp([text_block("Our wedding packages start at ₹15,000 — here's what that includes...")]),
    ])
    await agent.handle_inbound(lead2, "wedding decor but my budget is only 9000")
    assert len(TABLES["calendar_holds"]) == holds_before, "below-floor quote must NOT create a hold"
    assert "₹15,000" in SENT[-1][1]

    # ── 3. post-check blocks below-floor text ──
    lead3 = await fake_insert("leads", {"source": "whatsapp", "phone": "+919333333333", "event_type": "birthday"})
    agent._client = MockLLM([
        resp([text_block("Special deal just for you: ₹3,000 for the full birthday setup!")]),
    ])
    await agent.handle_inbound(lead3, "cheapest birthday option?")
    assert "₹3,000" not in SENT[-1][1], "below-floor text must be blocked"
    assert any("Floor guardrail" in a for a in ALERTS), "owner alerted on guardrail trip"

    # ── 4. escalation path ──
    lead4 = await fake_insert("leads", {"source": "whatsapp", "phone": "+919444444444"})
    agent._client = MockLLM([
        resp([tool_block("escalate_to_owner", {"reason": "500-guest 3-day wedding festival, beyond roster"})], stop="tool_use"),
        resp([text_block("This deserves personal attention — our owner will call you today to plan it properly!")]),
    ])
    await agent.handle_inbound(lead4, "3 day wedding festival, 500 guests, full catering + logistics")
    assert lead_status(lead4) == "escalated"
    assert any("escalated to owner" in a for a in ALERTS)

    # ── 5. no-key fallback ──
    agent.enabled = False
    lead5 = await fake_insert("leads", {"source": "whatsapp", "phone": "+919555555555"})
    await agent.handle_inbound(lead5, "hello?")
    assert "shortly" in SENT[-1][1].lower(), "customer never left in silence"
    assert any("Lead agent DOWN" in a for a in ALERTS)

    print("ALL LEAD AGENT TESTS PASSED")


def lead_status(lead):
    return next(r["status"] for r in TABLES["leads"] if r["id"] == lead["id"])


if __name__ == "__main__":
    asyncio.run(main())
