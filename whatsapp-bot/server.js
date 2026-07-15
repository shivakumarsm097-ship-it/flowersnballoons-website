/* Express server — Twilio WhatsApp webhook + admin commands + payments + cron. */
'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const twilio = require('twilio');

const flows = require('./lib/flows');
const scheduler = require('./lib/scheduler');
const db = require('./lib/db');
const M = require('./lib/messages');
const payments = require('./lib/payments');
const sheets = require('./lib/sheets');
const leads = require('./lib/leads');
const dispatch = require('./lib/dispatch');
const agent = require('./lib/agent');
const { send } = require('./lib/twilio');

const app = express();
const OWNER = process.env.OWNER_WHATSAPP;

/* ---- Razorpay webhook needs the RAW body for signature check → mount FIRST ---- */
app.post('/razorpay/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  const sig = req.headers['x-razorpay-signature'];
  if (!payments.verifyWebhook(req.body, sig)) return res.status(400).send('bad signature');
  res.status(200).send('ok');
  try {
    const evt = JSON.parse(req.body.toString('utf8'));
    if (evt.event === 'payment_link.paid' || evt.event === 'payment.captured') {
      const bookingId = evt.payload?.payment_link?.entity?.notes?.booking_id
        || evt.payload?.payment?.entity?.notes?.booking_id;
      if (bookingId) await onPaid(parseInt(bookingId, 10));
    }
  } catch (e) { console.error('razorpay webhook parse error:', e.message); }
});

/* JSON + urlencoded for everything else */
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* Serve generated invoice PDFs so Twilio can attach them via mediaUrl */
app.use('/invoices', express.static(path.join(__dirname, 'invoices')));

/* ---- health check ---- */
app.get('/', (_req, res) => res.send("Flowers 'N' Balloons WhatsApp bot — running ✅"));

/* ---- NEW LEAD → auto-message the customer & start qualifying ----
   Website / landing-page forms POST here (JSON or form-encoded):
     { name, phone, service, source }
   Protect with LEAD_WEBHOOK_TOKEN (sent as ?token= or X-Lead-Token header). */
app.post('/lead', async (req, res) => {
  const need = process.env.LEAD_WEBHOOK_TOKEN;
  const got = req.headers['x-lead-token'] || req.query.token;
  if (need && got !== need) return res.status(403).json({ ok: false, error: 'forbidden' });

  const { name, phone, service, source } = req.body || {};
  if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });

  try {
    const result = await leads.handleNewLead({ name, phone, service, source });
    return res.status(result.ok ? 200 : 202).json(result);
  } catch (e) {
    console.error('/lead error:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

/* ---- MISSED CALL → auto-message the caller & start qualifying ----
   Point your call-tracking service's webhook (Exotel/Knowlarity/etc.) here.
   Accepts JSON or form-encoded. Phone field name varies by provider, so we
   check the common ones: phone, CallFrom, caller, from, CallerId, ANI.
   Protect with MISSED_CALL_TOKEN (sent as ?token= or X-Lead-Token header). */
app.post('/missed-call', async (req, res) => {
  const need = process.env.MISSED_CALL_TOKEN;
  const got = req.headers['x-lead-token'] || req.query.token;
  if (need && got !== need) return res.status(403).json({ ok: false, error: 'forbidden' });

  const b = req.body || {};
  const phone = b.phone || b.CallFrom || b.caller || b.from || b.CallerId || b.ANI;
  if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });

  try {
    const result = await leads.handleNewLead({ phone, name: b.name, service: b.service, source: 'missed_call' });
    return res.status(result.ok ? 200 : 202).json(result);
  } catch (e) {
    console.error('/missed-call error:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

/* ---- Twilio inbound webhook ---- */
app.post('/webhook', async (req, res) => {
  const sig = req.headers['x-twilio-signature'];
  const url = (process.env.PUBLIC_URL || '') + '/webhook';
  const valid = process.env.PUBLIC_URL
    ? twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, sig, url, req.body)
    : true; // skip check if PUBLIC_URL not set (local dev)
  if (!valid) { console.warn('invalid twilio signature'); return res.status(403).end(); }

  const from = req.body.From;   // whatsapp:+91...
  const body = req.body.Body || '';
  const mediaUrl = parseInt(req.body.NumMedia, 10) > 0 ? req.body.MediaUrl0 : null;
  res.status(200).type('text/xml').send('<Response/>'); // ack immediately
  if (!from) return;

  try {
    // Owner admin commands from your own WhatsApp
    if (OWNER && from === OWNER && /^approve\s+all$/i.test(body.trim())) {
      return approveAllPending(from);
    }
    if (OWNER && from === OWNER && /^(confirm|done|executing|pay|approve|reject)\s+\d+/i.test(body.trim())) {
      return handleAdmin(from, body.trim());
    }
    if (OWNER && from === OWNER && /^lead\s+\S+/i.test(body.trim())) {
      return handleLeadCommand(from, body.trim());
    }
    if (OWNER && from === OWNER && /^staff\s+(add|list|remove)\b/i.test(body.trim())) {
      return handleStaffAdmin(from, body.trim());
    }
    if (OWNER && from === OWNER && /^assign\s+\d+\s+\d+/i.test(body.trim())) {
      const [, bId, sId] = body.trim().match(/^assign\s+(\d+)\s+(\d+)/i);
      return dispatch.assign(from, parseInt(bId, 10), parseInt(sId, 10));
    }

    // Staff replying accept/decline/done for their assigned bookings
    const staffResult = await dispatch.handleStaffMessage(from, body, mediaUrl);
    if (staffResult.handled) return;

    // System-driven steps (owner still deciding a below-floor ask, or a
    // scheduled feedback prompt) stay on the deterministic flow — the LLM
    // agent didn't start these conversations, so it shouldn't finish them.
    const session = db.getSession(from);
    const scriptedStep = session && ['awaiting_owner', 'awaiting_feedback_rating', 'awaiting_feedback_text'].includes(session.step);

    if (!scriptedStep && agent.enabled) {
      try {
        await agent.handle(from, body);
        return;
      } catch (e) {
        if (!(e instanceof agent.AgentUnavailable)) throw e;
        console.error('agent unavailable, falling back to scripted flow:', e.message);
        // fall through to scripted flow below
      }
    }

    const replies = await flows.handle(from, body);
    for (const r of replies) await send(from, r);
  } catch (e) {
    console.error('handler error:', e);
    try { await send(from, 'Oops, something glitched. Please call +91 8867121207 📞'); }
    catch (_) {}
  }
});

/* ---- owner admin: "staff add <phone> <name>" | "staff list" | "staff remove <id>" ---- */
async function handleStaffAdmin(from, text) {
  const parts = text.split(/\s+/);
  const sub = (parts[1] || '').toLowerCase();
  if (sub === 'add') return dispatch.staffAdd(from, parts.slice(2));
  if (sub === 'list') return dispatch.staffList(from);
  if (sub === 'remove') return dispatch.staffRemove(from, parseInt(parts[2], 10));
  return send(from, `Usage: staff add <phone> <name> | staff list | staff remove <id>`);
}

/* ---- owner admin: "confirm 12" | "executing 12" | "done 12" | "pay 12 5000" ---- */
const SERVICE_LABEL = {
  birthday: 'Birthday Decoration', wedding: 'Wedding Decoration',
  babyshower: 'Baby Shower Decor', corporate: 'Corporate Event',
};

async function handleAdmin(from, text) {
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const id = parseInt(parts[1], 10);

  // approve <id> [amount] | reject <id> — below-floor deal approvals
  if (cmd === 'approve' || cmd === 'reject') {
    return handleApproval(from, cmd, id, parseInt(parts[2], 10));
  }

  const b = db.getBooking(id);
  if (!b) return send(from, `No booking #${id} found.`);

  // pay <id> <amount> → generate Razorpay link, send to customer
  if (cmd === 'pay') {
    const amount = parseInt(parts[2], 10);
    if (!(amount > 0)) return send(from, 'Usage: pay <id> <amount>  e.g. pay 12 5000');
    if (!payments.enabled) return send(from, '⚠️ Razorpay not configured (set RAZORPAY_KEY_ID / SECRET).');
    try {
      const { short_url } = await payments.createLink(b, amount);
      db.setPayment(id, short_url, amount);
      await send(b.phone, M.payLink(b, short_url, amount));
      await send(from, `💳 Payment link sent to ${b.name} for ₹${amount}.`);
      sheets.updateBooking(db.getBooking(id)).catch(() => {});
    } catch (e) {
      await send(from, `Payment link failed: ${e.message}`);
    }
    return;
  }

  // status changes — map command word to the schema's actual status values
  const STATUS_MAP = { confirm: 'confirmed', executing: 'executing', done: 'done' };
  const status = STATUS_MAP[cmd];
  if (!status) return send(from, `Unknown command "${cmd}". Try: confirm / executing / done <id>`);
  db.setStatus(id, status);
  await send(from, `✅ Booking #${id} → *${status}*`);
  sheets.updateBooking(db.getBooking(id)).catch(() => {});

  if (status === 'confirmed') {
    await send(b.phone,
      `🎉 Good news ${b.name}! Your *${b.service}* booking (#${id}) for ${b.event_date} is *confirmed*. ` +
      `We can't wait to make it special! 🎈`);
    dispatch.autoAssign(id).catch((e) => console.error('auto-assign failed:', e.message));
  }
}

/* ---- owner admin: "approve all" — clear every pending below-floor approval at the customer's asked price ---- */
async function approveAllPending(from) {
  const pending = db.pendingApprovals();
  if (!pending.length) return send(from, 'No pending approvals right now.');
  for (const a of pending) await handleApproval(from, 'approve', a.id, undefined);
  return send(from, `✅ Approved all ${pending.length} pending approval(s).`);
}

/* ---- owner logs a lead from a phone call: "lead <phone> [name] [service]" ----
   Examples:
     lead 9876543210
     lead 9876543210 Priya
     lead 9876543210 Priya Sharma wedding
   Trailing word is checked against known service keywords; everything else is the name. */
const LEAD_SERVICE_ALIASES = {
  birthday: 'birthday',
  wedding: 'wedding',
  babyshower: 'babyshower', baby: 'babyshower', shower: 'babyshower',
  corporate: 'corporate', corp: 'corporate',
};

async function handleLeadCommand(from, text) {
  const tokens = text.split(/\s+/).slice(1); // drop the leading "lead"
  const phone = tokens.shift();
  let service = null;
  if (tokens.length) {
    const last = tokens[tokens.length - 1].toLowerCase();
    if (LEAD_SERVICE_ALIASES[last]) {
      service = LEAD_SERVICE_ALIASES[last];
      tokens.pop();
    }
  }
  const name = tokens.join(' ') || null;

  const result = await leads.handleNewLead({ phone, name, service, source: 'phone-call' });

  if (result.ok) {
    return send(from, `📞 Started the conversation with ${name || 'the lead'} (${phone}) — I've messaged them as you.`);
  }
  const reasons = {
    invalid_phone: `Couldn't read that phone number. Usage: *lead <phone> [name] [service]*`,
    duplicate: `Already reached out to ${phone} in the last 12h — skipping to avoid double-messaging.`,
    send_failed: `Lead saved (#${result.leadId}) but the WhatsApp message failed to send — check Twilio.`,
  };
  return send(from, reasons[result.reason] || `Couldn't log that lead (${result.reason}).`);
}

/* ---- owner approves / rejects a below-floor deal ---- */
async function handleApproval(from, cmd, id, amountArg) {
  const a = db.getApproval(id);
  if (!a) return send(from, `No approval #${id} found.`);
  if (a.status !== 'pending') return send(from, `Approval #${id} already ${a.status}.`);

  const label = SERVICE_LABEL[a.service] || a.service || 'event';
  const sess = db.getSession(a.phone);
  const name = (sess && sess.draft && sess.draft.name) || a.name || null;

  if (cmd === 'reject') {
    db.setApprovalStatus(id, 'rejected');
    sheets.updateApproval(db.getApproval(id)).catch(() => {});
    // let them keep talking to Shiva
    db.setSession(a.phone, 'negotiating', { service: a.service, serviceLabel: label, name });
    await send(a.phone, M.customerRejected(name, label));
    return send(from, `❌ Rejected #${id} — ${name || 'customer'} notified.`);
  }

  // approve — use owner's counter-price if given, else what the customer asked
  const amount = amountArg > 0 ? amountArg : a.requested;
  db.setApprovalStatus(id, 'approved', amount);
  sheets.updateApproval(db.getApproval(id)).catch(() => {});
  const needName = !name;
  const nextStep = needName ? 'awaiting_name' : 'awaiting_date';
  db.setSession(a.phone, nextStep, { service: a.service, serviceLabel: label, name, agreedAmount: amount, approvalId: id });
  await send(a.phone, M.customerApproved(name, amount, label, needName));
  return send(from, `✅ Approved #${id} at ₹${amount.toLocaleString('en-IN')} — ${name || 'customer'} notified.`);
}

/* ---- called when Razorpay confirms payment ---- */
async function onPaid(id) {
  const b = db.getBooking(id);
  if (!b) return;
  db.setPaymentStatus(id, 'paid');
  if (b.status === 'new') db.setStatus(id, 'confirmed');
  const fresh = db.getBooking(id);
  await send(b.phone, M.paidCustomer(fresh));
  await require('./lib/twilio').notifyOwner(M.paidOwner(fresh, fresh.amount));
  sheets.updateBooking(fresh).catch(() => {});
}

/* ---- manual cron triggers (testing) — protect/remove in prod ---- */
app.post('/cron/:job', async (req, res) => {
  const jobs = { reminders: scheduler.runReminders, checkins: scheduler.runCheckins, feedback: scheduler.runFeedback, digest: scheduler.runOwnerDigest, 'payment-reminders': scheduler.runPaymentReminders };
  const fn = jobs[req.params.job];
  if (!fn) return res.status(404).send('unknown job');
  await fn();
  res.send(`ran ${req.params.job}`);
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🎈 WhatsApp bot listening on :${PORT}`);
    console.log(`   payments: ${payments.enabled ? 'Razorpay ON' : 'off'} · sheets: ${sheets.enabled ? 'ON' : 'off'}`);
    scheduler.start();
  });
}

module.exports = { app, handleAdmin, handleApproval, handleLeadCommand, handleStaffAdmin, approveAllPending };
