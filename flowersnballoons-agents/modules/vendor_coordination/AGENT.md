# Vendor Coordination Agent

Owns getting real humans committed to every paid booking. Deterministic core:
`backend/vendor_dispatch.py`.

## Capacity determination (referenced by the availability check)
- Every event requires the roles in `ROLE_REQUIREMENTS[event_type]`
  (today: one decorator per event; extend per event type as the roster grows).
- **Daily capacity = min(number of active decorators, DAILY_EVENT_CAPACITY).**
  The decorator roster is the binding resource. `availability.capacity_for()`
  implements this; the Lead & Quote agent must never quote past it.

## Dispatch (triggered directly by the Razorpay webhook)
1. For each required role: pick the least-loaded active vendor (fewest open
   requested/accepted assignments) and WhatsApp them the job:
   `YES <id>` / `NO <id>` reply protocol.
2. Vendor declines → immediately re-dispatch to the next vendor for that role.
   No alternative vendor → Slack alert; the escalation window is the safety net.
3. Vendor accepts → assignment `accepted`. When **every** required role has an
   accepted assignment, booking → `confirmed`, `confirmed_at` set, customer
   gets the "fully confirmed" message. Never before (spec §4.4).

## Escalation window
- `VENDOR_ESCALATION_HOURS` (default **6h**) from booking creation.
- Cron checks paid bookings still `pending_vendors` past the window:
  stale `requested` assignments → `no_response`, booking → `at_risk`,
  customer proactively contacted with the refund-or-reschedule choice
  (see `booking_payment/AGENT.md`). A paid, unconfirmed booking never sits
  silent — that is the one unforgivable failure mode.

## Roster
- Start small: 1–2 real vendors per role to validate the loop before scaling.
- `vendors.active=false` removes someone from dispatch without losing history.

## Logging
Every assignment request, acceptance, decline, re-dispatch, and escalation →
`log_action("vendor_coordination", ...)`.
