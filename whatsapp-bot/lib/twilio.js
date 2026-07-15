/* Twilio send helpers. */
'use strict';

const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const FROM = process.env.TWILIO_WHATSAPP_FROM;
const OWNER = process.env.OWNER_WHATSAPP;

async function send(to, body) {
  return client.messages.create({ from: FROM, to, body });
}

/* send with an attached media file (must be a public HTTPS URL) */
async function sendMedia(to, body, mediaUrl) {
  return client.messages.create({ from: FROM, to, body, mediaUrl: [mediaUrl] });
}

/* Business-initiated opener to a NEW lead.
   Production: uses an approved Twilio Content template (LEAD_TEMPLATE_SID) with
   variables — the ONLY compliant way to message outside the 24h window.
   Sandbox/dev: if no template SID, falls back to a plain send (works when the
   number has joined the sandbox, or inside an open 24h window). */
async function sendOpener(to, contentVariables, fallbackBody) {
  const sid = process.env.LEAD_TEMPLATE_SID;
  if (sid) {
    return client.messages.create({
      from: FROM, to,
      contentSid: sid,
      contentVariables: JSON.stringify(contentVariables || {}),
    });
  }
  return client.messages.create({ from: FROM, to, body: fallbackBody });
}

async function notifyOwner(body) {
  if (!OWNER) return;
  try { await send(OWNER, body); }
  catch (e) { console.error('owner notify failed:', e.message); }
}

module.exports = { send, sendMedia, sendOpener, notifyOwner, client };
