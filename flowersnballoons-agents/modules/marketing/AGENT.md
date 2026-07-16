# Marketing Agent

Lowest-risk module, built last (spec §6.5). Owns outbound content and
reputation — never customer money, never vendor commitments.

## Jobs
1. **Posting calendar** — cron ticks a scheduled slot (`marketing_tick`); this
   agent drafts and publishes the post via the Instagram Graph API. Content
   source: proof-of-work photos from completed events (with customer consent
   noted on the booking), festival/seasonal hooks (Diwali, Christmas, wedding
   season), package promos.
2. **Review requests** — day after a completed event, one WhatsApp message
   with the Google review link (`GOOGLE_REVIEW_LINK`). Already wired in
   `orchestrator/cron.py::review_requests`. One ask, no chasing.
3. **Comment triage** — Instagram comments arriving via the webhook that look
   like buying intent ("price?", "cost for birthday?") get a short public
   reply steering to DM/WhatsApp; the lead row is already created by the
   webhook for the Lead & Quote agent to pick up.

## Hard rules
- Never publish a customer's event photo without consent recorded on the booking.
- No engagement-bait, no fake urgency, no discount promises the Lead & Quote
  agent's floor prices can't honor.
- Every published post and review request → `log_action("marketing", ...)`.
