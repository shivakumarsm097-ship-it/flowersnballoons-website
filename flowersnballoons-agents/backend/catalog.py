"""Package catalog — starting prices per category (₹).

These are FLOORS: the Lead & Quote agent may never quote below the
starting price for a category (enforced in code, not just prompt).
Actual quotes scale up with guest count, theme, add-ons, venue.
"""
from __future__ import annotations

STARTING_PRICES: dict[str, int] = {
    "birthday": 4500,
    "wedding": 15000,
    "babyshower": 5000,
    "housewarming": 6000,
    "engagement": 8000,
    "namingceremony": 5000,
    "corporate": 10000,
    "haldi": 7000,
    "babywelcome": 4000,
    "community": 8000,
}

LABELS: dict[str, str] = {
    "birthday": "Birthday Decoration",
    "wedding": "Wedding Decoration",
    "babyshower": "Baby Shower Decor",
    "housewarming": "Housewarming Decoration",
    "engagement": "Engagement Decoration",
    "namingceremony": "Naming Ceremony Decor",
    "corporate": "Corporate Event",
    "haldi": "Haldi Ceremony Decor",
    "babywelcome": "Baby Welcome Home",
    "community": "Community Event",
}


def floor_for(event_type: str | None) -> int | None:
    return STARTING_PRICES.get(event_type or "")


def price_table_text() -> str:
    return "\n".join(
        f"- {LABELS[k]}: from ₹{v:,}" for k, v in STARTING_PRICES.items()
    )
