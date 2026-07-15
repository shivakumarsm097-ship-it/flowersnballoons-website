/* Inbound lead → proactive WhatsApp outreach.
   Called by POST /lead when a website/LP form is submitted.
   Normalizes the number, sends Shiva's opener, and seeds the conversation so
   the lead's first reply continues qualification (date → area → venue → …). */
'use strict';

const db = require('./db');
const M = require('./messages');
const { sendOpener, notifyOwner } = require('./twilio');

const SERVICE_LABEL = {
  birthday: 'Birthday Decoration',
  wedding: 'Wedding Decoration',
  babyshower: 'Baby Shower Decor',
  corporate: 'Corporate Event',
};

/* Indian mobile → whatsapp:+91XXXXXXXXXX (best-effort) */
function toWhatsApp(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '91' + d;                 // bare 10-digit
  if (d.length === 12 && d.startsWith('91')) return 'whatsapp:+' + d;
  if (d.length >= 11 && d.length <= 15) return 'whatsapp:+' + d; // already has cc
  return null;                                       // unparseable
}

/* returns { ok, reason?, leadId? } */
async function handleNewLead({ phone, name, service, source }) {
  const wa = toWhatsApp(phone);
  if (!wa) return { ok: false, reason: 'invalid_phone' };

  // Dedupe — don't re-open if we already reached out in the last 12h
  if (db.recentLead(wa)) return { ok: false, reason: 'duplicate' };

  const key = service && SERVICE_LABEL[service] ? service : null;
  const serviceLabel = key ? SERVICE_LABEL[key] : null;
  const cleanName = name ? String(name).trim().slice(0, 60) : null;

  const leadId = db.createLead({ phone: wa, name: cleanName, service: key, source });
  if (cleanName) db.upsertCustomer(wa, cleanName);

  // Seed the conversation so their reply lands mid-flow (skip menu).
  // Name known → ask for date next. Name unknown → ask for name next.
  const draft = { service: key, serviceLabel: serviceLabel || 'your event' };
  if (cleanName) {
    draft.name = cleanName;
    db.setSession(wa, 'awaiting_date', draft);
  } else {
    db.setSession(wa, 'awaiting_name', draft);
  }

  // Send Shiva's opener (template in prod, plain in sandbox/24h window)
  try {
    await sendOpener(wa, M.leadTemplateVars(cleanName, serviceLabel), M.leadOpener(cleanName, serviceLabel));
    db.markLead(leadId, 'engaged');
  } catch (e) {
    console.error('lead opener send failed:', e.message);
    return { ok: false, reason: 'send_failed', leadId };
  }

  await notifyOwner(M.ownerLeadAlert({ phone: wa, name: cleanName, service: key, serviceLabel, source }, leadId));
  return { ok: true, leadId };
}

module.exports = { handleNewLead, toWhatsApp };
