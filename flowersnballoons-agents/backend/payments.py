"""Razorpay REST helpers — payment links + refunds. httpx, no SDK."""
from __future__ import annotations

import os
from typing import Any

import httpx

RZP_KEY = os.environ.get("RAZORPAY_KEY_ID", "")
RZP_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
BASE = "https://api.razorpay.com/v1"


def configured() -> bool:
    return bool(RZP_KEY and RZP_SECRET)


async def create_payment_link(amount_inr: int, description: str, customer_phone: str, reference_id: str) -> dict[str, Any]:
    """Returns the Razorpay payment_link object (id + short_url)."""
    async with httpx.AsyncClient(timeout=20, auth=(RZP_KEY, RZP_SECRET)) as c:
        r = await c.post(
            f"{BASE}/payment_links",
            json={
                "amount": amount_inr * 100,  # paise
                "currency": "INR",
                "description": description,
                "reference_id": reference_id,
                "customer": {"contact": customer_phone},
                "notify": {"sms": True},
                "reminder_enable": True,
            },
        )
        r.raise_for_status()
        return r.json()


async def refund_payment(payment_id: str, amount_inr: int | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {}
    if amount_inr is not None:
        body["amount"] = amount_inr * 100
    async with httpx.AsyncClient(timeout=20, auth=(RZP_KEY, RZP_SECRET)) as c:
        r = await c.post(f"{BASE}/payments/{payment_id}/refund", json=body)
        r.raise_for_status()
        return r.json()
