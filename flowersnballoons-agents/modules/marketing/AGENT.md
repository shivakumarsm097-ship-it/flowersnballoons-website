# Marketing & Reputation Agent

Keep Instagram active with real event photos, answer non-booking inbound,
turn happy customers into public reviews. Lowest-risk module — no money, no
vendor commitments — but the same discipline. Runtime: `agent.py`
(deterministic).

## Posting (weekly, Mondays via cron)
1. Photo source: vendors send finished-setup photos on WhatsApp at wrap-up
   (the morning-of vendor reminder asks for them → `intake_vendor_photo`
   attaches to the matching recent booking; `event_photos.url` must point to
   public storage before a photo is publishable).
2. Pick 1-2 events from the past week — **variety over repetition**: event
   types posted in the last 3 posts go to the back of the queue, never two
   of the same type in one week.
3. Caption: specific (event type, locality, package), soft CTA, 5-8 local
   hashtags — not 30.
4. **Tag the customer only on an explicit yes** (`bookings.tag_permission`);
   a positive WhatsApp message is not permission.
5. 48h after each post: engagement (likes/comments) logged
   (`engagement_check`, daily cron).

## Inbound Instagram (real-time webhook)
- General/pricing questions → **answered directly** from the catalog
  (starting price for the asked event type). No "DM us" deflection for a
  question we can answer.
- Real booking intent (dates, "book", availability) → warm WhatsApp handoff
  (`wa.me` link) — the Lead & Quote agent owns qualification.
- Comments: brief + warm; pricing questions answered **in the reply** — an
  engaged commenter shouldn't be sent on a detour.

## Review requests (cron)
1. **+2 days** after the event: one thank-you with the review link
   (`send_review_requests`, `review_requested_at` set).
2. **+5 days** no response: exactly one follow-up (`send_review_followups`,
   outcome `no_response`). Never a third — nagging generates bad reviews.
3. Customer reply routed via the WhatsApp webhook (`handle_review_reply`):
   - negative signal → outcome `dissatisfied`, sequence stops, **no link
     pushed again**, escalated to resolution (Slack). Asking an unhappy
     customer for a public review is worse than not asking.
   - positive/"done" → outcome `reviewed`, warm thanks.

## Definition of done
Weekly cadence maintained; inbound IG answered same-day; every completed
event gets exactly one review sequence (1-2 messages, never more); no
review asked of anyone who signaled dissatisfaction.

## Logging
Posts + 48h engagement, DMs/comments answered vs handed off, review
requests sent and outcome (reviewed / no_response / dissatisfied-skipped)
→ `log_action("marketing", ...)`.
