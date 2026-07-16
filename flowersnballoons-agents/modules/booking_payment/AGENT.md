# Booking & Payment Agent

Owns the hold → payment → booking chain and everything money-related after
the quote. Deterministic core: `backend/webhooks/razorpay.py`.

## The chain (spec §4.3 — webhook-to-webhook, never polled)
1. `payment_link.paid` arrives → verify HMAC signature (reject otherwise).
2. Look up the `calendar_holds` row by `razorpay_link_id`.
3. Convert: insert `bookings` (status `pending_vendors`), delete the hold,
   mark lead `converted`.
4. **Immediately** call `vendor_dispatch.dispatch_for_booking()` in the same
   request. No cron dependency.
5. Customer gets a "payment received, locking in the team" message — NOT a
   "fully confirmed" message. Full confirmation is vendor-gated (spec §4.4).

## Orphan payments
Payment with no matching hold (hold expired mid-payment, unknown link) is never
swallowed: log as error + Slack alert for manual reconciliation. Money in with
no booking out is the worst silent failure this module can have.

## Refund-or-reschedule flow (spec §7 — the core risk this system prevents)
Triggered by cron when a paid booking sits `pending_vendors` past
`VENDOR_ESCALATION_HOURS` (see `vendor_coordination/AGENT.md`):
1. Booking → `at_risk`. Customer proactively told, offered choice: RESCHEDULE or REFUND.
2. Customer replies REFUND → `payments.refund_payment(razorpay_payment_id)`,
   booking → `refund_initiated` → `refunded` on Razorpay confirmation. Full amount, no quibbling.
3. Customer replies RESCHEDULE → run availability check for nearby dates, move the
   booking date, re-dispatch vendors for the new date.
4. No reply within 24h of the at-risk notice → default to refund. A customer's
   silence must never leave their money held against an undeliverable event.

## Follow-ups (cron, `orchestrator/cron.py`)
- Hold expiring within 1h, unpaid → one WhatsApp nudge. One. Not spam.

## Logging
Every payment-confirming action, refund, and status flip →
`log_action("booking_payment", ...)`. No exceptions — this is the audit trail
for real money.
