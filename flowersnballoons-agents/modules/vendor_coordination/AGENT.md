# Vendor & Staff Coordination Agent

Once a booking is paid, get real vendors committed to that date — and make
sure someone knows immediately when that isn't happening. A payment isn't a
delivered event; a human still has to show up. Runtime:
`backend/vendor_dispatch.py` (fully deterministic).

## Trigger
Fired directly by the Razorpay payment webhook — assignment starts within
minutes of payment, never on the next cron cycle. Cron handles only the
passage of time: response timeouts, reminders, weekly analytics.

## Required roles (from event type + package)
- Every event: **decorator** (the binding capacity resource —
  daily capacity = min(active decorators, `DAILY_EVENT_CAPACITY`), used by
  the availability check).
- Package containing premium/grand/royal: **+ photographer + activity-staff**.
- Package mentioning catering: **+ caterer**.

## Candidate selection (per role)
Active vendors for the role, filtered to those who:
1. service the booking's location (`service_areas` overlap; empty = serves all),
2. aren't already requested/accepted on another live booking that date,
3. haven't already been asked for this booking+role.
Ranked least-loaded first so requests rotate across the roster instead of
hammering the same one or two vendors.

## Assignment protocol (WhatsApp)
Job brief: date, event type, package, location, role, expected pay
(`VENDOR_PAY_PERCENT` of booking total). Replies:
- `YES <id>` → accepted; when every required role is accepted → booking
  `confirmed`, customer told. Time-to-assignment logged.
- `NO <id>` → declined → next candidate immediately.
- `CANCEL <id>` (after accepting) → **same urgency as a fresh assignment**:
  booking drops back to `pending_vendors` if it was confirmed, urgent
  re-dispatch, loud Slack alert. Never a background task.

## Response windows (per vendor, distance-scaled)
- Event >14 days out: 48h to respond.
- 3–14 days: 24h.
- <3 days: **4h**, and a blown window immediately triggers the Booking &
  Payment agent's at-risk path — no waiting out a full cycle when the event
  is imminent. (`advance_stale_assignments` in cron enforces timeouts;
  timed-out = `no_response` → next candidate.)

## Escalation (→ Booking & Payment agent + loud log)
- **Roster exhausted** for a required role, regardless of time remaining →
  `mark_at_risk_and_notify` — the customer refund/reschedule conversation
  starts NOW. Don't sit on it.
- Accept-then-cancel close to the event → handled above with full urgency.

## Reminders
Accepted vendors get a reminder 48h before the event and the morning of,
with an explicit "reply CANCEL now, not on the day" prompt.

## Analytics
`weekly_decline_summary` (Mondays): declines/timeouts per vendor over 7
days → Slack. Rising declines = revisit that vendor's pricing or reliability.

## Definition of done
Every required role on every paid booking has an accepted vendor or an
active escalation in progress. Nothing sits unassigned without someone —
agent or human — actively working it.

## Logging
Role, candidates tried in order, each response (accept/decline/timeout),
final outcome, time-to-assignment → `log_action("vendor_coordination", ...)`.
