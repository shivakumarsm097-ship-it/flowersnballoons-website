"""Lead & Quote agent runtime — Claude tool-use loop.

Fully autonomous per the owner's instruction: no human reviews quotes.
The autonomy is bounded by deterministic tools, not trust in the model:
  - a date can only be quoted through quote_and_hold(), which runs the
    availability check and creates the TTL hold atomically (spec §4.1-2)
  - price floors (backend/catalog.py) are enforced in the tool AND as a
    post-check on every outbound message — a below-floor figure never
    reaches the customer
  - genuinely out-of-scope requests go through escalate_to_owner, the
    agent cannot quote them

Degrades safely: no ANTHROPIC_API_KEY or API failure → customer gets a
human-warm holding message, owner gets a Slack alert. A lead is never
left with silence.
"""
from __future__ import annotations

import json
import os
import re
from datetime import date

from backend import availability, catalog, payments
from backend.db import client as db
from backend.notify import send_whatsapp, slack_alert
from orchestrator.logger import log_action

MODEL = os.environ.get("AGENT_MODEL", "claude-sonnet-5")
MAX_ROUNDS = 5
enabled = bool(os.environ.get("ANTHROPIC_API_KEY"))

_client = None


def _get_client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.AsyncAnthropic()
    return _client


TOOLS = [
    {
        "name": "check_availability",
        "description": "Check whether a specific date has capacity before discussing it. ALWAYS call this before mentioning any date as bookable. Returns availability plus nearest alternative dates if full.",
        "input_schema": {
            "type": "object",
            "properties": {"date": {"type": "string", "description": "ISO date YYYY-MM-DD"}},
            "required": ["date"],
        },
    },
    {
        "name": "quote_and_hold",
        "description": "Send a quote for a specific date. Creates the mandatory short-TTL calendar hold and a payment link in one step — you may NEVER state a price for a specific date except through this tool. Fails if the date lost capacity or the price is below the category floor.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "event_type": {
                    "type": "string",
                    "enum": list(catalog.STARTING_PRICES.keys()),
                },
                "total_price_inr": {"type": "integer", "description": "Total quote in ₹. Must be >= the category starting price."},
                "line_items": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Itemized breakdown, e.g. ['Base birthday package — ₹4,500', 'Balloon arch add-on — ₹1,500']. Itemization makes the no-hidden-charges promise concrete.",
                },
            },
            "required": ["date", "event_type", "total_price_inr", "line_items"],
        },
    },
    {
        "name": "save_lead_details",
        "description": "Persist event details as you learn them (event type, date wanted, budget, name).",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "event_type": {"type": "string", "enum": list(catalog.STARTING_PRICES.keys())},
                "event_date": {"type": "string", "description": "ISO date the customer is asking about"},
                "budget_range": {"type": "string"},
            },
        },
    },
    {
        "name": "escalate_to_owner",
        "description": "Hand off to the owner instead of quoting: use for requests outside roster capacity (e.g. 500-guest wedding), multi-day festivals, unusual venues/logistics, or custom packages materially different from standard categories. Never quote these yourself.",
        "input_schema": {
            "type": "object",
            "properties": {"reason": {"type": "string"}},
            "required": ["reason"],
        },
    },
]


def _system_prompt(lead: dict) -> str:
    return f"""You are the booking assistant for Flowers 'N' Balloons, a Bangalore event-decoration studio, chatting with a customer on WhatsApp. Warm, quick, local — a family booking a birthday, not a corporate transaction. Use the customer's name once you know it. Enthusiasm is good ("Sounds like a beautiful haldi ceremony!"), never over the top.

WhatsApp style: SHORT messages, line breaks, no walls of text. English, ₹ Indian format.

PACKAGES (starting prices — never quote below these):
{catalog.price_table_text()}
Quotes scale with guest count, theme complexity, add-ons (photography, catering, activities), venue.

PROCESS:
1. Learn: event type, date, rough guest count, location/venue, budget range, theme/must-haves. Save details with save_lead_details as you go. Conversational — don't interrogate.
2. NEVER mention a date as bookable without check_availability first. Date full → say so honestly, offer the returned alternatives.
3. Quote ONLY via quote_and_hold — itemized line items so "no hidden charges" is concretely true. The tool gives you the payment link and hold expiry; include both in your message with a clear next step ("Reply YES and pay the link to lock it in — I'm holding the date for you until {{expiry}}").
4. Out-of-scope (huge scale, multi-day, weird logistics, custom package) → escalate_to_owner, tell the customer the owner will call them personally.

Known lead info: {json.dumps({k: lead.get(k) for k in ('name', 'event_type', 'event_date', 'budget_range', 'source')})}

Never reveal you are an AI. Never invent availability, prices, or dates — tools only."""


async def _run_tool(name: str, inp: dict, lead: dict) -> str:
    if name == "check_availability":
        try:
            d = date.fromisoformat(inp["date"])
        except ValueError:
            return "Invalid date format — ask the customer to clarify the date."
        if d <= date.today():
            return "That date is in the past (or today — too late to book). Ask for a future date."
        if await availability.is_available(d):
            return f"{d.isoformat()} has capacity — you may quote it via quote_and_hold."
        alts = await availability.nearest_available(d, 3)
        return (
            f"{d.isoformat()} is at capacity — do NOT quote it. "
            f"Offer these instead: {', '.join(a.isoformat() for a in alts) or 'none within 60 days'}."
        )

    if name == "quote_and_hold":
        d = date.fromisoformat(inp["date"])
        floor = catalog.floor_for(inp["event_type"])
        if floor and inp["total_price_inr"] < floor:
            log_action("lead_quote", actions_skipped_or_escalated=[f"blocked below-floor quote ₹{inp['total_price_inr']} < ₹{floor} for lead {lead['id']}"])
            return f"REFUSED: ₹{inp['total_price_inr']:,} is below the ₹{floor:,} floor for {inp['event_type']}. Quote at or above the floor, or suggest trimming add-ons."
        hold = await availability.try_hold(d, inp["event_type"], lead["id"])
        if not hold:
            alts = await availability.nearest_available(d, 3)
            return f"REFUSED: {d.isoformat()} lost capacity (another lead holds it). Offer: {', '.join(a.isoformat() for a in alts)}."

        link_line = "Payment link unavailable — tell the customer you'll send it in a moment (owner alerted)."
        if payments.configured() and lead.get("phone"):
            try:
                link = await payments.create_payment_link(
                    inp["total_price_inr"],
                    f"{catalog.LABELS[inp['event_type']]} — {d.isoformat()}",
                    lead["phone"],
                    hold["id"],
                )
                await db.attach_payment_link(hold["id"], link["id"])
                link_line = f"Payment link: {link['short_url']}"
            except Exception as e:
                await slack_alert(f"⚠️ Payment link creation failed for lead {lead['id']}: {e}")
        else:
            await slack_alert(f"⚠️ Quote sent without payment link (Razorpay unconfigured) — lead {lead['id']}, ₹{inp['total_price_inr']:,} on {d.isoformat()}")

        await db.set_lead_status(lead["id"], "quoted")
        log_action(
            "lead_quote",
            actions_taken=[f"quote ₹{inp['total_price_inr']:,} for {inp['event_type']} on {d.isoformat()}, hold {hold['id']} created, lead {lead['id']}"],
        )
        return (
            f"Quote registered. Hold expires: {hold['expires_at']}. {link_line}\n"
            f"Now write the customer message: itemized quote ({'; '.join(inp['line_items'])}), "
            f"the payment link, and that the date is held until the expiry time."
        )

    if name == "save_lead_details":
        patch = {k: v for k, v in inp.items() if v and k in ("name", "event_type", "event_date", "budget_range")}
        if patch:
            await db._update("leads", {"id": f"eq.{lead['id']}"}, patch)  # noqa: SLF001
            lead.update(patch)
        return "Saved."

    if name == "escalate_to_owner":
        await db.set_lead_status(lead["id"], "escalated")
        await slack_alert(f"🙋 Lead {lead['id']} ({lead.get('phone')}) escalated to owner: {inp['reason']}")
        log_action("lead_quote", actions_skipped_or_escalated=[f"lead {lead['id']} escalated: {inp['reason']}"])
        return "Escalated — tell the customer the owner will personally call them shortly to scope this properly."

    return f"Unknown tool {name}"


_PRICE_RE = re.compile(r"(?:₹|rs\.?|inr)\s?([\d,]{3,})", re.I)


def _breaches_floor(text: str, event_type: str | None) -> bool:
    """An itemized quote legitimately contains small component prices
    (add-ons under the floor); what must never happen is the TOTAL offer
    being below floor. Heuristic: breach = the largest ₹ figure in the
    message is below the category floor."""
    floor = catalog.floor_for(event_type)
    if not floor:
        floor = min(catalog.STARTING_PRICES.values())
    prices = [int(m.group(1).replace(",", "")) for m in _PRICE_RE.finditer(text)]
    prices = [p for p in prices if p >= 1000]
    return bool(prices) and max(prices) < floor


async def handle_inbound(lead: dict, text: str) -> None:
    """Entry point: customer message in → agent replies on WhatsApp."""
    await db.add_message(lead["id"], "user", text)
    await db.touch_lead(lead["id"], followup_sent=False)
    if lead.get("status") == "new":
        await db.set_lead_status(lead["id"], "engaged")

    if not enabled:
        await _fallback(lead, "ANTHROPIC_API_KEY not set")
        return

    history = await db.conversation_history(lead["id"])
    messages = [{"role": r["role"], "content": r["content"]} for r in history]

    reply = None
    try:
        for _ in range(MAX_ROUNDS):
            res = await _get_client().messages.create(
                model=MODEL,
                max_tokens=1024,
                system=_system_prompt(lead),
                tools=TOOLS,
                messages=messages,
            )
            texts = [b.text for b in res.content if b.type == "text"]
            if texts:
                reply = "\n".join(texts).strip()
            tool_uses = [b for b in res.content if b.type == "tool_use"]
            if not tool_uses or res.stop_reason != "tool_use":
                break
            messages.append({"role": "assistant", "content": res.content})
            results = []
            for tu in tool_uses:
                out = await _run_tool(tu.name, tu.input, lead)
                results.append({"type": "tool_result", "tool_use_id": tu.id, "content": out})
            messages.append({"role": "user", "content": results})
    except Exception as e:
        log_action("lead_quote", errors=[f"agent LLM loop failed for lead {lead['id']}: {e}"])
        await _fallback(lead, str(e))
        return

    if not reply:
        reply = "Thanks for the details! Give me one moment and I'll get right back to you. 🎈"

    if _breaches_floor(reply, lead.get("event_type")):
        log_action("lead_quote", actions_skipped_or_escalated=[f"post-check blocked below-floor text for lead {lead['id']}"])
        await slack_alert(f"🚨 Floor guardrail: agent tried to send a below-floor price to lead {lead['id']}. Message blocked.")
        reply = "Let me double-check the best price for you with the team — back to you very shortly! 🙏"

    await send_whatsapp(lead["phone"], reply)
    await db.add_message(lead["id"], "assistant", reply)
    await db.touch_lead(lead["id"])


async def start_outbound(lead: dict) -> None:
    """Web-form / phone / IG lead with a phone number → open on WhatsApp
    (spec: never leave a form submission one-way)."""
    if not lead.get("phone"):
        return
    name = lead.get("name")
    etype = catalog.LABELS.get(lead.get("event_type") or "", None)
    hi = f"Hi {name}! " if name else "Hi! "
    about = f"about {etype}" if etype else "about your event"
    opener = (
        f"{hi}This is Flowers 'N' Balloons 🎈\n\n"
        f"Thanks for reaching out {about} — I'd love to help plan it.\n\n"
        f"Which date are you thinking of?"
    )
    try:
        await send_whatsapp(lead["phone"], opener)
        await db.add_message(lead["id"], "assistant", opener)
        await db.set_lead_status(lead["id"], "engaged")
        await db.touch_lead(lead["id"])
        log_action("lead_quote", actions_taken=[f"outbound opener sent to lead {lead['id']} ({lead['source']})"])
    except Exception as e:
        log_action("lead_quote", errors=[f"outbound opener failed for lead {lead['id']}: {e}"])
        await slack_alert(f"⚠️ Couldn't open WhatsApp with lead {lead['id']} ({lead.get('phone')}): {e}")


async def _fallback(lead: dict, why: str) -> None:
    msg = "Thanks for your message! I'm checking the details and will get back to you very shortly. 🎈"
    try:
        await send_whatsapp(lead["phone"], msg)
        await db.add_message(lead["id"], "assistant", msg)
    except Exception:
        pass
    await slack_alert(f"🚨 Lead agent DOWN ({why}) — lead {lead['id']} ({lead.get('phone')}) needs a human reply.")
