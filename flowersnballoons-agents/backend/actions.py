"""Shadow mode — THE single checkpoint for every outbound side effect.

SHADOW_MODE=true: agents run full decision logic, write to the DB and
logs exactly as live, but every WhatsApp send, Instagram post/reply and
Razorpay charge is recorded in shadow_actions instead of firing.

Every side-effecting function (notify.py, payments.py) routes through
execute_or_shadow() — no per-call-site flag checks anywhere else.

Exception (deliberate, documented): send_owner_alert() and slack_alert()
bypass shadow — monitoring must reach a human DURING the shadow week,
that's the whole point of running one.
"""
from __future__ import annotations

import os
from typing import Any, Awaitable, Callable

from backend.db import client as db


def shadow_enabled() -> bool:
    return os.environ.get("SHADOW_MODE", "").strip().lower() in ("1", "true", "yes")


async def execute_or_shadow(
    action_type: str,                      # "whatsapp.send" | "instagram.dm" | "instagram.comment_reply" | "instagram.post" | "razorpay.payment_link" | "razorpay.refund"
    recipient: str | None,
    content: str | None,
    executor: Callable[[], Awaitable[Any]],
    amount: int | None = None,
    shadow_result: Any = None,
) -> Any:
    if not shadow_enabled():
        return await executor()

    module = action_type.split(".", 1)[0]
    try:
        await db._insert(  # noqa: SLF001 — deliberate: table has no other writers
            "shadow_actions",
            {
                "module": module,
                "action_type": action_type,
                "recipient": recipient,
                "content": (content or "")[:2000],
                "would_charge_amount": amount,
            },
        )
    except Exception:
        # shadow recording must never break agent logic; the log file still has it
        from orchestrator.logger import log_action
        log_action(module, errors=[f"shadow_actions write failed for {action_type} → {recipient}"])
    return shadow_result
