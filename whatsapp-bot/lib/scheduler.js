/* Cron jobs — lifecycle automation.
   Runs daily at fixed IST times:
     07:30  owner digest — today/tomorrow's events, pending leads & approvals, month pipeline
     09:00  reminder for events happening TOMORROW
     08:00  check-in for events happening TODAY
     11:00  feedback ask for events that happened YESTERDAY

   Feedback ask primes the customer's session to 'awaiting_feedback_rating',
   so their next reply (1–5) is captured by flows.js.
*/
'use strict';

const cron = require('node-cron');
const db = require('./db');
const M = require('./messages');
const { send, notifyOwner } = require('./twilio');

function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function runReminders() {
  const rows = db.dueForReminder(isoOffset(1));
  for (const b of rows) {
    try { await send(b.phone, M.reminder(b)); db.markFlag(b.id, 'reminder_sent'); }
    catch (e) { console.error('reminder fail', b.id, e.message); }
  }
  if (rows.length) console.log(`[cron] sent ${rows.length} reminder(s)`);
}

async function runCheckins() {
  const rows = db.dueForCheckin(isoOffset(0));
  for (const b of rows) {
    try {
      await send(b.phone, M.checkin(b));
      db.markFlag(b.id, 'checkin_sent');
      db.setStatus(b.id, 'executing');
    } catch (e) { console.error('checkin fail', b.id, e.message); }
  }
  if (rows.length) console.log(`[cron] sent ${rows.length} check-in(s)`);
}

async function runFeedback() {
  const rows = db.dueForFeedback(isoOffset(-1));
  for (const b of rows) {
    try {
      await send(b.phone, M.feedbackAsk(b));
      db.markFlag(b.id, 'feedback_sent');
      db.setStatus(b.id, 'done');
      // prime session so their 1–5 reply is captured
      db.setSession(b.phone, 'awaiting_feedback_rating', { bookingId: b.id });
    } catch (e) { console.error('feedback fail', b.id, e.message); }
  }
  if (rows.length) console.log(`[cron] sent ${rows.length} feedback ask(s)`);
}

async function runPaymentReminders() {
  const rows = db.duePaymentReminders(24);
  for (const b of rows) {
    try { await send(b.phone, M.paymentReminder(b)); db.markPaymentReminderSent(b.id); }
    catch (e) { console.error('payment reminder fail', b.id, e.message); }
  }
  if (rows.length) console.log(`[cron] sent ${rows.length} payment reminder(s)`);
}

async function runOwnerDigest() {
  const today = isoOffset(0);
  const tomorrow = isoOffset(1);
  try {
    await notifyOwner(M.ownerDigest({
      today: db.eventsOnDate(today),
      tomorrow: db.eventsOnDate(tomorrow),
      leads: db.recentLeadsPending(24),
      approvals: db.pendingApprovals(),
      month: db.monthSummary(),
    }));
    console.log('[cron] sent owner daily digest');
  } catch (e) { console.error('owner digest fail', e.message); }
}

function start() {
  const tz = { timezone: process.env.TZ || 'Asia/Kolkata' };
  cron.schedule('30 7 * * *', runOwnerDigest, tz);
  cron.schedule('0 8 * * *',  runCheckins,  tz);
  cron.schedule('0 9 * * *',  runReminders, tz);
  cron.schedule('0 11 * * *', runFeedback,  tz);
  cron.schedule('0 * * * *',  runPaymentReminders, tz); // hourly scan, only fires once a link has been unpaid 24h
  console.log('[cron] scheduler started (IST): digest 07:30, checkin 08:00, reminder 09:00, feedback 11:00, payment-reminder scan hourly');
}

module.exports = { start, runReminders, runCheckins, runFeedback, runOwnerDigest, runPaymentReminders };
