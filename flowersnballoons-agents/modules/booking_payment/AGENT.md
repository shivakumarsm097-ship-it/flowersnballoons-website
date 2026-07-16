# Booking & Payment Agent

Convert a confirmed quote into a paid, locked booking — and own the
responsibility that comes with taking money for a future event: deliver it,
or make it right. Fully autonomous, fully deterministic (`agent.py` — no LLM
on any money path).

## Triggers
1. **Customer replies YES** after a quote → `handle_confirmation()`:
   - **Re-validate in the same conversation** (spec hard limit): hold still
     active? Expired but slot still free → fresh hold, proceed. Slot gone →
     honest message + alternatives, **no payment collected on a stale quote**.
   - Payment link = **advance only** (`ADVANCE_PERCENT`, default 30%, matching
     the site's "small advance confirms your booking"), sent with an explicit
     now-vs-at-event breakdown. Total and advance were fixed at quote time on
     the hold (`quoted_price` / `advance_price`).
2. **Razorpay `payment_link.paid`** (webhooks/razorpay.py) — the main event:
   - hold → `converted` (audit state, not deletion), `bookings` row written
     (`price`=advance, `total_price`=quote, status `pending_vendors`)
   - customer confirmation with date + advance/balance breakdown
   - **vendor dispatch triggered in the same request** — never waits for cron
   - `near_miss_check()`: bookings on the date > capacity → loud log + Slack;
     that's the earliest signal the hold TTL / capacity check needs tightening.

## Vendor-confirmation responsibility (customer-facing side)
Booking is "paid" at the webhook, genuinely secure only when every required
role has an accepted vendor. Escalation window scales with event distance
(`escalation_window_hours`): ≤7 days out → 12h, ≤30 days → 24h, else 48h.
- Vendor found late → proceed, no customer action.
- Window blown → cron flips booking `at_risk` (+`at_risk_at`), customer gets
  the honest message with the REFUND / RESCHEDULE choice.
- **Silent 24h after the at-risk notice → automatic full refund**
  (`at_risk_default_refunds`). Money is never held against an undeliverable
  event by default.

## Customer message routing (whatsapp webhook, before the lead agent)
- `REFUND` (at-risk/rescheduling) → full refund via Razorpay, warm confirmation.
- `CANCEL` → standard-policy refund, no justification required beyond identity
  (matched by phone → booking).
- `RESCHEDULE` → nearest open dates offered; customer replies a date →
  availability re-checked, booking moved, advance carries over, vendors
  re-dispatched for the new date.

## Balance reminder
3-5 days before the event: one WhatsApp reminder of the balance due
(`balance_reminders`, `balance_reminder_sent` flag — one only).

## Hard limits
- Never collect payment for a date/capacity not re-verified in the same
  conversation.
- Never double-book: any detected capacity breach is logged loudly — it's a
  bug signal, not a condition to handle quietly.
- Refund failures alert Slack immediately for manual action — a promised
  refund that silently fails is treated as the worst outcome.

## Definition of done
Every confirmed quote → completed booking with vendor confirmation, an honest
refund/reschedule resolution, or still inside its normal follow-up window.

## Logging
Payment link sent, payment confirmed, booking created, vendor status at each
check, every refund/reschedule + why, every availability-vs-outcome
disagreement → `log_action("booking_payment", ...)`.
