# Flowers 'N' Balloons — WhatsApp Automation Bot

End-to-end WhatsApp automation: **booking → confirmation → reminders → execution check-in → feedback**. Route B (custom code) — Twilio WhatsApp + Node.js + SQLite. No monthly SaaS fee, no cloud DB account.

## What it does

| Stage | Trigger | Message |
|---|---|---|
| **Auto-outreach** | Website/LP form submitted, *or* you text `lead <phone>` after a call | Bot messages the lead *first* as Shiva and starts qualifying |
| **Book** | Customer sends "hi" (or replies to outreach) | Menu → guided booking (name, date, area, venue, budget, notes) |
| **Capacity check** | Customer picks a date | If that date is already fully booked, bot apologises and offers the next open dates instead of overbooking |
| **Owner digest** | 07:30 IST, daily | WhatsApp summary: today/tomorrow's events, leads awaiting reply, approvals pending, month's pipeline |
| **Catalog** | Picks a service, or texts "prices"/"photos", or menu *7* | Sends package pricing + sample photos on WhatsApp |
| **Negotiate** | Customer bargains ("too expensive", "discount", "8k?") | Bot haggles like Shiva, never below 15% off |
| **Owner alert** | Booking confirmed | You get a WhatsApp with all details + "reply in 30 min" nudge |
| **Confirm** | You reply `confirm 12` | Customer told their booking #12 is confirmed |
| **Reminder** | 09:00 IST, day before event | Auto reminder to customer |
| **Check-in** | 08:00 IST, event day | "Team on the way" message; status → executing |
| **Dispatch** | You text `assign 12 2` | Staff member gets the job brief; `accept`/`decline`/`done` keeps you posted, `done` + photo forwards proof-of-work to the customer |
| **Feedback** | 11:00 IST, day after | Ask 1–5 stars. 4–5 → Google review link. 1–3 → collect complaint + alert you |
| **Track** | Customer sends "5" | Live status of their booking |

## Tech
- **Twilio WhatsApp** — messaging (sandbox for testing, approved number for production)
- **Express** — webhook server
- **node:sqlite** — built into Node 22.5+/24/26, zero native deps
- **node-cron** — the daily reminder/check-in/feedback jobs

## Setup

### 1. Install
```bash
cd whatsapp-bot
npm install
cp .env.example .env
```

### 2. Twilio credentials
1. Sign up at [twilio.com](https://www.twilio.com/try-twilio) (free trial has credit)
2. Console → find **Account SID** + **Auth Token** → paste into `.env`
3. **Testing:** Console → Messaging → Try it out → **WhatsApp sandbox**. Join by sending the given code to `+1 415 523 8886` from your phone. Keep `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886`.
4. **Production:** Apply for WhatsApp sender (needs a Meta Business account + your `+91 8867121207`). Once approved, set `TWILIO_WHATSAPP_FROM=whatsapp:+918867121207`.
5. Set `OWNER_WHATSAPP` to the number that should receive booking alerts.

### 3. Run locally + expose to Twilio
Twilio must reach your webhook over HTTPS. Use ngrok:
```bash
npm start                 # starts on :3000
npx ngrok http 3000       # in another terminal → gives https://xxxx.ngrok.app
```
Put the ngrok URL in `.env` as `PUBLIC_URL=https://xxxx.ngrok.app` (enables Twilio signature verification), then restart.

### 4. Point Twilio at the webhook
Twilio Console → WhatsApp sandbox settings → **"When a message comes in"**:
```
https://xxxx.ngrok.app/webhook      (POST)
```
Send "hi" from your joined phone → bot replies. Done.

### 5. Deploy (always-on)
ngrok is for testing. For production, deploy to **Railway** or **Render** (both have free tiers, keep the cron alive):
1. Push `whatsapp-bot/` to a repo
2. New service → set the env vars from `.env`
3. Set `PUBLIC_URL` to the deployed domain
4. Update the Twilio webhook URL to `https://your-app.up.railway.app/webhook`

> SQLite file (`data.sqlite`) lives on disk. On Railway/Render add a **persistent volume** so bookings survive redeploys. For higher volume, swap `lib/db.js` to Postgres.

## Owner (admin) commands
Send these from your `OWNER_WHATSAPP` number:
- `lead 9876543210` → just took a call from this number, no details yet — bot messages them and asks for their name
- `lead 9876543210 Priya Sharma` → name known — bot messages them and asks for the event date
- `lead 9876543210 Priya Sharma wedding` → name + service known — skips straight to date. Service keywords: `birthday`, `wedding`, `babyshower`/`baby`/`shower`, `corporate`/`corp`
- `confirm 12` → mark booking #12 confirmed (notifies customer)
- `executing 12` → mark in progress
- `done 12` → mark completed
- `pay 12 5000` → send customer a ₹5,000 Razorpay payment link
- `approve 3` → accept a below-floor deal at what the customer asked
- `approve 3 12000` → accept, but at your counter-price of ₹12,000
- `reject 3` → decline the deal (customer gets a warm "can't go that low")
- `staff add 9876543210 Ravi` → add a staff/vendor to your team
- `staff list` → list active staff with their IDs
- `staff remove 2` → deactivate staff #2
- `assign 12 2` → assign booking #12 to staff #2 (sends them the job brief on WhatsApp)
- `approve all` → approve every pending below-floor deal at the customer's asked price, in one go

## Proactive lead outreach (auto-message on new lead)

Whenever a lead comes in — **website form or phone call** — the bot messages them on WhatsApp **first** (as Shiva) and starts collecting event details. No waiting for them to text you.

**Form flow:** form submit → `POST /lead` → bot sends opener → seeds the conversation → lead replies → date/area/venue/budget/notes → booking.

**Call flow:** you take a call → text yourself `lead 9876543210 Priya wedding` (name/service optional) → bot sends the same opener → same seeded conversation → booking. See [Owner (admin) commands](#owner-admin-commands) above for the exact syntax.

### ⚠️ Meta's rule (important)
To message someone who **hasn't texted you first**, WhatsApp requires a **pre-approved Message Template**. Free-form messages only work for 24h *after* the customer messages you.
- **Sandbox/testing:** works with a plain message (the lead must have joined your Twilio sandbox).
- **Production:** create a Twilio Content **template**, get it approved (~24–48h), put its SID in `LEAD_TEMPLATE_SID`. The bot uses it automatically.

### Missed-call auto-capture
A call-tracking service (Exotel, Knowlarity, etc.) POSTs to `/missed-call` when someone calls your tracked number and hangs up (or doesn't get through) — bot messages them same way as form leads.

1. Sign up for a call-tracking service yourself and get a virtual number — that part not this bot's job.
2. In its webhook/callback config, set URL to `https://your-bot-domain/missed-call`, method POST.
3. Set an auth token/header value matching `MISSED_CALL_TOKEN` in `.env` (sent by them as `?token=` query param or `X-Lead-Token` header — check what your provider supports).
4. Accepts JSON or form-encoded body. Phone field name varies by provider — endpoint checks `phone`, `CallFrom`, `caller`, `from`, `CallerId`, `ANI` (whichever your provider sends). `name`/`service` optional if provider sends them.
5. Same dedupe (12h) and opener flow as form leads — feeds straight into `handleNewLead()`.

### Wiring the website
1. In `.env`: set `LEAD_WEBHOOK_TOKEN` to a random string.
2. In `js/main.js` (top of the FORM block) set:
   ```js
   var BOT_LEAD_URL   = 'https://your-bot-domain/lead';
   var BOT_LEAD_TOKEN = '<same as LEAD_WEBHOOK_TOKEN>';
   ```
3. Re-minify: `npx terser js/main.js --mangle -o js/main.min.js`
   (use `--mangle` only — `--compress` would strip the hook because the URL const is empty by default).

`/lead` accepts JSON or form-encoded `{ name, phone, service, source }`. Indian numbers are auto-normalized to `whatsapp:+91…`. Duplicate submits within 12h are ignored.

## LLM agent brain (full customer conversation, not just negotiation)

When `ANTHROPIC_API_KEY` is set, **every customer message** is handled by an LLM agent ([`lib/agent.js`](lib/agent.js)) instead of the scripted [`lib/flows.js`](lib/flows.js) state machine. The customer can talk naturally, in any order, off-script — the agent still books correctly because it can only change real state through tools, never by inventing text:

- `get_catalog` / `check_availability` / `save_booking_draft` / `request_owner_approval` / `confirm_booking` / `get_booking_status` / `handoff_to_human`
- Every tool runs the same deterministic code the scripted flow used to run directly (capacity check, floor-price rules, `flows.finalizeBooking()` for the actual booking write) — the model picks *when* to call them, it never touches the database or invents a price itself.
- **Price floor guardrail** (same pattern as [price negotiation](#price-negotiation-bot-bargains-like-a-human) below): every agent reply is scanned for a ₹ figure under the absolute floor; if found, it's replaced with a hold-firm line and you get an escalation alert.

**Fallback:** if the Claude API call fails, times out, or `ANTHROPIC_API_KEY` isn't set, the bot silently drops that turn to the scripted `flows.js` state machine — the customer keeps getting a reply either way, just less conversational. Booking mid-conversation when this happens resets to the main menu (rare — only on an API outage).

**Not agent-controlled:** replies to a scheduled feedback prompt (`awaiting_feedback_rating`/`_text`) and a customer waiting on an owner's below-floor decision (`awaiting_owner`) stay on the scripted flow — those conversations were started by the scheduler/owner, not the customer, so the deterministic flow finishes them.

**Cost:** ~₹0.20–0.50 per customer reply (same `claude-opus-4-8` tier as price negotiation), so a full 8–15 message booking conversation runs roughly ₹2–7.

## Further automation (reduces manual steps, doesn't remove you)

Six things automated on top of the base agent — each still keeps you in the loop for anything that actually needs a judgment call:

1. **Auto-assign staff on confirm.** When you `confirm <id>`, the booking is automatically assigned to your least-loaded active staff member (fewest open jobs) — no need to also run `assign <id> <staffId>`. You still get notified and can override with `assign <id> <staffId>` any time. No area-matching yet (staff don't have an area field) — purely load-balanced.
2. **`approve all`** — clear every pending below-floor approval at once (at the customer's asked price), instead of replying to each one individually.
3. **Auto-approve near-floor asks.** A below-floor price request within `AUTO_APPROVE_BAND` (default 5%) of the floor is approved automatically — the customer moves straight to booking, no wait. You still get a quiet FYI (not an interactive ask) and it's logged as a normal approval for the record. Anything further below the floor still escalates and waits for you as before. Tune or disable via `AUTO_APPROVE_BAND` in `.env` (`0` effectively disables it).
4. **Payment link reminders.** If a Razorpay link (`pay <id> <amount>`) goes unpaid for 24h, the bot sends one automatic nudge with the same link. One reminder only — no spam.
5. **Goodwill apology gesture on low ratings.** A 1–3 star rating still alerts you in full (unchanged) — but the bot also auto-sends the customer an apology + offer of a free add-on on their next booking, and remembers it (`customers.goodwill_note`) so the LLM agent naturally offers it when they come back, without you having to personally follow up every time. Cleared automatically once redeemed on their next booking.
6. **API-outage self-alert.** If the Claude API fails 3 times in a row, you get one WhatsApp alert that the agent is down (cooldown: at most once per 30 min) — instead of silently finding out later that customers got the dumber scripted bot. In-memory counter, resets on restart.

None of these remove you from pricing exceptions further below floor, staffing overrides, refunds/disputes, or the physical decoration work itself — see [What this doesn't automate](#owner-admin-commands) above.

## Packages, pricing & photos in chat
The bot sends package pricing and sample photos during the conversation:
- automatically when a customer picks a service,
- on demand when they text `prices`, `packages`, or `photos`,
- via menu option **7 — See prices & photos**.

**Edit packages/prices** in [`lib/catalog.js`](lib/catalog.js) (`PACKAGES`).
**Photos:** WhatsApp needs public image URLs, served from your website — set `SITE_URL` in `.env`. The catalog currently maps the site's generic decoration photos to every service; drop real per-service images into `images/` and update the `GALLERY` map in `lib/catalog.js`. Use `.jpg`/`.png` (WhatsApp previews those reliably — avoid `.webp`). Without `SITE_URL`, pricing text still sends; photos are skipped.

## Price negotiation (bot bargains like a human)
When a customer haggles, the bot replies as Shiva — acknowledging the ask, giving a little, justifying the value, and steering toward booking. It handles bargaining mid-booking (non-destructive — the booking resumes) or standalone; when the customer agrees ("ok deal"), it moves straight into collecting details.

**Discount floor is hard-capped at 15%.** Two safeguards:
1. The floor prices are baked into the AI's instructions (it's told never to go below them).
2. A post-check scans every reply for a ₹ figure below the floor; if found, it's replaced with a hold-firm line and **you get an escalation alert** to call the customer.

**Per-tier floors.** Each package sets its own `maxDiscount` in [`lib/catalog.js`](lib/catalog.js) — tighter on entry tiers, roomier on premium (default 8% / 12% / 18%). The bot is told each tier's floor and never crosses it. `MAX_DISCOUNT` in [`lib/negotiate.js`](lib/negotiate.js) is the fallback when a package sets none.

**Deal capture.** When the customer accepts ("ok deal"), the bot locks in the last price it offered — confirms it ("locked in at ₹13,800"), stores it on the booking (`amount`), shows it in the confirmation summary, and includes **"Negotiated price: ₹X"** in your new-booking alert so you know exactly what was agreed.

**Nothing is rejected without your say-so.** If a customer asks for a price *below the floor*, the bot never declines on its own. It tells them "let me check with my team," pings you with a **`🔒 DEAL APPROVAL NEEDED`** message (customer, service, what they want, your floor, how far under), and waits. You reply `approve <id>`, `approve <id> <amount>` (counter-price), or `reject <id>` — the bot relays your decision. On approval it carries the agreed price straight into the booking; on rejection it sends a warm decline and keeps the conversation open.

**AI vs scripted:** set `ANTHROPIC_API_KEY` in `.env` to enable natural, any-phrasing negotiation via Claude (model `claude-opus-4-8`, ~₹0.20–0.50/reply). Without a key, a **scripted tiered negotiator** runs instead (1st ask → 10% + free add-on, 2nd → more add-ons, 3rd → hold firm + offer a callback) — so the feature works either way.

## Add-ons (all optional — bot runs fine without them)

### PDF invoice (always on)
The **invoice is the only thing sent as a PDF** — everything else (packages, pricing, sample photos) is delivered as plain WhatsApp chat/media. On confirmation a branded invoice PDF is generated in `invoices/` (showing the agreed/negotiated amount when there is one) and, **if `PUBLIC_URL` is set**, attached to the customer's WhatsApp confirmation. No external account needed. Edit branding/layout in [`lib/invoice.js`](lib/invoice.js).

### Razorpay payment links
1. [razorpay.com](https://razorpay.com) → Dashboard → Settings → **API Keys** → put `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` in `.env`.
2. Settings → **Webhooks** → add `<PUBLIC_URL>/razorpay/webhook`, event `payment_link.paid`, set a secret → `RAZORPAY_WEBHOOK_SECRET`.
3. Quote a customer, then WhatsApp yourself `pay 12 5000`. Customer gets a UPI/card link. When they pay, the bot auto-marks the booking paid, confirms it, and pings you. **We never touch card data — Razorpay hosts checkout.**

### Google Sheets sync (for non-technical staff)
Every booking mirrored to a live sheet; status/payment/rating update in place. A second **Approvals** tab (auto-created) logs every below-floor ask — customer, service, requested price, your floor, status (pending/approved/rejected), the price you decided, and whether it **converted** to a booking — so you can track how often people push below floor and how many close.
1. [Google Cloud console](https://console.cloud.google.com) → create a **Service Account** → download its JSON key.
2. `GOOGLE_SERVICE_ACCOUNT_JSON=` path to that file (or paste the raw JSON).
3. Create a Google Sheet → **Share** it (Editor) with the service-account email (`...@...iam.gserviceaccount.com`).
4. `GOOGLE_SHEET_ID=` the ID from the sheet URL. Headers auto-created on first booking.

## Editing copy / prices
All customer text and service prices live in [`lib/messages.js`](lib/messages.js). Change the Google review link placeholder `YOUR_GOOGLE_REVIEW_LINK` to your real one.

## Testing the cron jobs without waiting
```bash
curl -X POST http://localhost:3000/cron/reminders
curl -X POST http://localhost:3000/cron/checkins
curl -X POST http://localhost:3000/cron/feedback
curl -X POST http://localhost:3000/cron/digest
curl -X POST http://localhost:3000/cron/payment-reminders
```
(Protect or remove these `/cron/*` routes before going public.)

## Booking capacity (double-booking protection)
Set `DAILY_BOOKING_CAPACITY` in `.env` (default **2**) — the max events the bot will book on any single date. When a customer's chosen date is already at capacity, the bot apologises and offers the next open dates instead of silently overbooking. Raise this once you have more than one team/vendor able to work the same day.

## Staff / vendor dispatch
Assign confirmed bookings to your team and track the job through to completion, all over WhatsApp — no new accounts needed, it uses the same bot number.

**Owner side** (send from `OWNER_WHATSAPP`):
- `staff add 9876543210 Ravi` → add Ravi to your team (phone auto-normalized to `whatsapp:+91…`)
- `staff list` → see active staff and their IDs
- `staff remove 2` → deactivate staff #2 (their history is kept, they just stop getting new jobs)
- `assign 12 2` → assign booking #12 to staff #2 — they immediately get a WhatsApp job brief (customer, service, date, venue) and you get notified once they respond

**Staff side** (the staff member replies from their own phone):
- `accept 12` → confirms they've got the job; you're notified
- `decline 12` → tells you they can't make it; you're notified so you can reassign
- `done 12` → marks the job completed. **Send a photo along with `done 12`** (as the caption) and the bot forwards it straight to the customer as proof-of-work with a "your decoration is ready" message; without a photo, the customer still gets the ready message, just no photo.

A staff member texting anything else while they have an active job gets a short "reply accept/decline/done" nudge. Everyone else's messages (customers, unrecognized numbers) flow through untouched — staff detection only kicks in for numbers you've added with `staff add`.

## File map
```
whatsapp-bot/
├── server.js            Express + Twilio webhook + admin commands
├── lib/
│   ├── db.js            SQLite schema + all queries
│   ├── flows.js         Conversation state machine + date parser
│   ├── messages.js      All customer-facing copy + prices  ← edit here
│   ├── twilio.js        Send helpers (text + media)
│   ├── leads.js         Inbound lead → phone normalize + auto-outreach
│   ├── dispatch.js      Staff/vendor dispatch (assign, accept/decline/done)
│   ├── catalog.js       Packages, prices, sample-photo map  ← edit prices here
│   ├── negotiate.js     AI/scripted price bargaining (15% floor)  ← tune floor here
│   ├── invoice.js       PDF booking-confirmation generator (pdfkit)
│   ├── payments.js      Razorpay payment links + webhook verify
│   ├── sheets.js        Google Sheets mirror (append/update)
│   └── scheduler.js     Daily cron: reminder / check-in / feedback
├── invoices/            (auto-created PDFs, git-ignored)
├── .env.example
└── data.sqlite          (auto-created, git-ignored)
```
