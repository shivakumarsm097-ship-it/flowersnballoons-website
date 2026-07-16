"""The availability guarantee (spec §4). Single source of truth for
"can we quote this date?".

Capacity for a date = min(active decorator count, DAILY_EVENT_CAPACITY).
Every event needs one decorator, so the decorator roster is the binding
resource (see modules/vendor_coordination/AGENT.md).

Slots taken on a date = non-cancelled bookings + non-expired holds.
A quote may only be sent through try_hold(); it reserves the slot with a
short TTL so two simultaneous leads can't both be quoted the same slot.
"""
from __future__ import annotations

import os
from datetime import date, timedelta
from typing import Any

from backend.db import client as db

HOLD_TTL_HOURS = float(os.environ.get("HOLD_TTL_HOURS", "2"))


async def capacity_for(d: date) -> int:
    cap = int(os.environ.get("DAILY_EVENT_CAPACITY", "2"))
    decorators = await db.active_vendors("decorator")
    if decorators:
        cap = min(cap, len(decorators))
    return cap


async def slots_taken(d: date) -> int:
    bookings = await db.bookings_on(d)
    holds = await db.active_holds_on(d)
    held_lead_ids = {h["lead_id"] for h in holds}
    return len(bookings) + len(held_lead_ids)


async def is_available(d: date) -> bool:
    return await slots_taken(d) < await capacity_for(d)


async def nearest_available(after: date, count: int = 3, horizon_days: int = 60) -> list[date]:
    out: list[date] = []
    cursor = after
    for _ in range(horizon_days):
        cursor += timedelta(days=1)
        if await is_available(cursor):
            out.append(cursor)
            if len(out) >= count:
                break
    return out


async def try_hold(d: date, event_type: str, lead_id: str) -> dict[str, Any] | None:
    """Atomically-enough reserve a slot before quoting.

    Insert the hold first, then re-count; if the insert pushed the date
    over capacity (two leads raced), delete our own hold and return None.
    PostgREST has no transactions over HTTP, so insert-then-verify is the
    guard: at worst both racers self-revoke, never both get quoted.
    """
    if not await is_available(d):
        return None
    hold = await db.create_hold(d, event_type, lead_id, HOLD_TTL_HOURS)
    if await slots_taken(d) > await capacity_for(d):
        await db.delete_hold(hold["id"])
        return None
    return hold
