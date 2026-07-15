/* Conversation state machine. Given an incoming message + saved session,
   returns an array of reply strings and advances/clears the session.

   Steps:
     (no session)            → menu router
     awaiting_name
     awaiting_date
     awaiting_area
     awaiting_venue
     awaiting_budget
     awaiting_notes
     awaiting_confirm
     awaiting_feedback_rating
     awaiting_feedback_text
*/
'use strict';

const db = require('./db');
const M = require('./messages');
const { notifyOwner, sendMedia, send } = require('./twilio');
const sheets = require('./sheets');
const invoice = require('./invoice');
const catalog = require('./catalog');
const negotiate = require('./negotiate');

/* haggling signals — trigger AI price negotiation */
const HAGGLE_RE = /\b(discount|expensive|costly|cheaper|cheap|reduce|reduc\w*|lower|less|budget|too\s*much|too\s*high|best\s*price|final\s*price|offer|deal|negotiat\w*|kam\s*karo|price\s*down|any\s*less)\b/i;
function isHaggle(text) {
  if (HAGGLE_RE.test(text)) return true;
  // a bare rupee counter-offer like "12k", "₹8000", "8 thousand"
  if (/(?:₹|rs\.?|inr)\s?\d{3,}/i.test(text)) return true;
  if (/\b\d{1,3}\s?k\b/i.test(text)) return true;
  return false;
}
const YES_TO_BOOK = /\b(yes|yeah|ok|okay|sure|book|confirm|done|proceed|let'?s\s*do|go\s*ahead|deal)\b/i;

/* If the customer is asking below our floor, don't reject — pause and ask the
   owner. Returns a customer reply string if escalated, else null. */
async function tryEscalate(phone, text, draft) {
  const key = draft.service || null;
  const floor = negotiate.serviceFloor(key);
  const target = negotiate.parseTarget(text);
  if (!floor || !target || target < 500 || target >= floor) return null;

  const id = db.createApproval({ phone, name: draft.name || null, service: key, requested: target, floor });

  // Within the auto-approve band (default 5% under floor) — approve without
  // waking the owner, but still log + notify so nothing is silent.
  const band = parseFloat(process.env.AUTO_APPROVE_BAND) || 0.05;
  if (target >= floor * (1 - band)) {
    db.setApprovalStatus(id, 'approved', target);
    sheets.updateApproval(db.getApproval(id)).catch(() => {});
    notifyOwner(`ℹ️ Auto-approved near-floor ask #${id} — ₹${target.toLocaleString('en-IN')} vs floor ₹${floor.toLocaleString('en-IN')} (within ${Math.round(band * 100)}% band). No action needed.`).catch(() => {});
    const needName = !draft.name;
    db.setSession(phone, needName ? 'awaiting_name' : 'awaiting_date',
      { service: key, serviceLabel: SERVICE_LABEL[key], name: draft.name, agreedAmount: target, approvalId: id });
    return M.customerApproved(draft.name, target, SERVICE_LABEL[key], needName);
  }

  db.setSession(phone, 'awaiting_owner', { ...draft, requestedAmount: target, approvalId: id });
  // mirror to the Approvals sheet (non-blocking)
  sheets.appendApproval(db.getApproval(id))
    .then((rowNum) => { if (rowNum) db.setApprovalSheetRow(id, rowNum); })
    .catch(() => {});
  await notifyOwner(M.ownerApprovalAsk({
    id, name: draft.name, phone, service: key,
    serviceLabel: SERVICE_LABEL[key], requested: target, floor,
  }));
  return M.customerChecking();
}

/* Run one negotiation turn; persists rolling history on the given session draft. */
async function runNegotiation(phone, text, draft, keepStep) {
  const key = draft.service || null;
  const hist = draft._neg || [];
  const { text: out, offer } = await negotiate.reply(key, hist, text);
  hist.push({ role: 'user', text });
  hist.push({ role: 'assistant', text: out });
  draft._neg = hist.slice(-12);
  if (offer) draft._negPrice = offer;    // remember the latest price the bot offered
  db.setSession(phone, keepStep, draft);
  return out;
}

const SERVICE_LABEL = {
  birthday: 'Birthday Decoration', wedding: 'Wedding Decoration',
  babyshower: 'Baby Shower Decor', corporate: 'Corporate Event',
};

/* Send packages + sample photos for a service, in order. */
async function sendCatalog(phone, key) {
  const label = SERVICE_LABEL[key] || 'event';
  const pkgs = catalog.PACKAGES[key];
  if (pkgs) await send(phone, M.priceList(label, pkgs));

  const photos = catalog.photoUrls(key, 3);
  if (photos.length) {
    await send(phone, M.photoCaption(label));
    for (const p of photos) {
      try { await sendMedia(phone, p.caption, p.url); }
      catch (e) { console.error('photo send failed:', p.url, e.message); }
    }
  } else if (!catalog.hasPhotos) {
    await send(phone, M.noPhotos(label));
  }
}

/* ---- tiny date parser → {iso, human} or null ---- */
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function parseDate(text) {
  const t = text.trim().toLowerCase();
  let d, m, y;

  // dd/mm/yyyy or dd-mm-yyyy
  let mm = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (mm) { d = +mm[1]; m = +mm[2] - 1; y = +mm[3]; }

  // "25 Dec 2026" / "25 december 2026"
  if (!mm) {
    const nm = t.match(/^(\d{1,2})\s+([a-z]{3,})\s+(\d{2,4})$/);
    if (nm && MONTHS[nm[2].slice(0, 3)] !== undefined) {
      d = +nm[1]; m = MONTHS[nm[2].slice(0, 3)]; y = +nm[3];
    }
  }

  if (d === undefined) return null;
  if (y < 100) y += 2000;
  const dt = new Date(y, m, d);
  if (isNaN(dt) || dt.getDate() !== d || dt.getMonth() !== m) return null;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (dt < today) return null; // no past dates

  const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const human = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return { iso, human };
}

/* ---- main entry ---- */
async function handle(phone, rawText) {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();
  const session = db.getSession(phone);

  // Global escapes — work at any step
  if (['hi', 'hello', 'hey', 'menu', 'start', 'hii'].includes(lower)) {
    db.clearSession(phone);
    return [M.welcome()];
  }
  if (['cancel', 'stop', 'exit'].includes(lower)) {
    db.clearSession(phone);
    return ['No problem — cancelled. Reply *hi* anytime. 🎈'];
  }

  // On-demand: prices / packages / photos — works any time
  if (['prices', 'price', 'packages', 'package', 'pricing', 'cost', 'rates',
       'photos', 'photo', 'pics', 'gallery', 'samples', 'catalog'].includes(lower)) {
    const key = session && session.draft && session.draft.service;
    if (key) { await sendCatalog(phone, key); return []; }
    return [M.catalogMenu()];
  }

  // Price haggling → AI negotiation as Shiva (unless a step already handles it)
  if (isHaggle(lower) &&
      (!session || !['negotiating', 'awaiting_owner', 'awaiting_confirm', 'awaiting_feedback_rating', 'awaiting_feedback_text'].includes(session.step))) {
    if (session && session.step && session.step.startsWith('awaiting_')) {
      // mid-booking: below-floor ask → escalate; else answer, keep the step
      const esc = await tryEscalate(phone, text, session.draft);
      if (esc) return [esc];
      const out = await runNegotiation(phone, text, session.draft, session.step);
      return [out];
    }
    const draft = (session && session.draft) ? session.draft : {};
    const esc = await tryEscalate(phone, text, draft);
    if (esc) return [esc];
    const out = await runNegotiation(phone, text, draft, 'negotiating');
    return [out];
  }

  // No active session → route from main menu
  if (!session) return route(phone, text, lower);

  // Active session → dispatch by step
  switch (session.step) {
    case 'negotiating':      return stepNegotiating(phone, text, lower, session);
    case 'awaiting_owner':   return stepAwaitingOwner(phone, text, session);
    case 'awaiting_name':    return stepName(phone, text, session);
    case 'awaiting_date':    return stepDate(phone, text, session);
    case 'awaiting_area':    return stepArea(phone, text, session);
    case 'awaiting_venue':   return stepVenue(phone, text, session);
    case 'awaiting_budget':  return stepBudget(phone, text, session);
    case 'awaiting_notes':   return stepNotes(phone, text, session);
    case 'awaiting_confirm': return stepConfirm(phone, lower, session);
    case 'awaiting_feedback_rating': return stepFeedbackRating(phone, text, session);
    case 'awaiting_feedback_text':   return stepFeedbackText(phone, text, session);
    default:
      db.clearSession(phone);
      return [M.welcome()];
  }
}

/* ---- menu router (no session) ---- */
async function route(phone, text, lower) {
  const svc = M.SERVICES[text.trim()];
  if (svc) {
    db.setSession(phone, 'awaiting_name', { service: svc.key, serviceLabel: svc.label });
    await sendCatalog(phone, svc.key);          // show packages + photos first
    return [M.askName(svc)];
  }
  if (text.trim() === '5') return track(phone);
  if (text.trim() === '6') return [M.human()];
  if (text.trim() === '7') return [M.catalogMenu()];
  return [M.fallback()];
}

/* ---- negotiation step: keep bargaining until they're ready to book ---- */
async function stepNegotiating(phone, text, lower, s) {
  if (YES_TO_BOOK.test(lower)) {
    const key = s.draft.service;
    if (key) {
      const agreedAmount = s.draft._negPrice || null;
      db.setSession(phone, 'awaiting_name', { service: key, serviceLabel: SERVICE_LABEL[key], agreedAmount });
      const priceLine = agreedAmount
        ? `Wonderful — locked in at *₹${Number(agreedAmount).toLocaleString('en-IN')}* 🎈 `
        : `Wonderful — let's get you booked! 🎈 `;
      return [priceLine + `May I have your *name*, please?`];
    }
    db.clearSession(phone);
    return [M.welcome()];
  }
  const esc = await tryEscalate(phone, text, s.draft);
  if (esc) return [esc];
  const out = await runNegotiation(phone, text, s.draft, 'negotiating');
  return [out];
}

/* ---- waiting on owner's approve/reject for a below-floor ask ---- */
function stepAwaitingOwner(phone, text, s) {
  return [M.customerStillChecking()];
}

function track(phone) {
  const b = db.latestActiveBooking(phone);
  return [b ? M.trackStatus(b) : M.trackNone()];
}

/* ---- booking steps ---- */
function stepName(phone, text, s) {
  const name = text.slice(0, 60);
  db.upsertCustomer(phone, name);
  db.setSession(phone, 'awaiting_date', { ...s.draft, name });
  return [M.askDate()];
}

function stepDate(phone, text, s) {
  const parsed = parseDate(text);
  if (!parsed) return [M.dateError()];

  const capacity = parseInt(process.env.DAILY_BOOKING_CAPACITY, 10) || 2;
  if (db.countBookingsOnDate(parsed.iso) >= capacity) {
    const alt = nextAvailableDates(parsed.iso, capacity, 3);
    return [M.dateFullyBooked(parsed.human, alt)];
  }

  db.setSession(phone, 'awaiting_area',
    { ...s.draft, event_date: parsed.iso, event_date_h: parsed.human });
  return [M.askArea()];
}

/* find the next `count` dates (after fromIso) with capacity remaining */
function nextAvailableDates(fromIso, capacity, count) {
  const [y, m, d] = fromIso.split('-').map(Number);
  const cursor = new Date(y, m - 1, d);
  const results = [];
  for (let i = 0; results.length < count && i < 60; i++) {
    cursor.setDate(cursor.getDate() + 1);
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    if (db.countBookingsOnDate(iso) < capacity) {
      results.push({ iso, human: cursor.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) });
    }
  }
  return results;
}

function stepArea(phone, text, s) {
  db.setSession(phone, 'awaiting_venue', { ...s.draft, area: text.slice(0, 80) });
  return [M.askVenue()];
}

function stepVenue(phone, text, s) {
  db.setSession(phone, 'awaiting_budget', { ...s.draft, venue: text.slice(0, 120) });
  return [M.askBudget()];
}

function stepBudget(phone, text, s) {
  db.setSession(phone, 'awaiting_notes', { ...s.draft, budget: M.budgetLabel(text) });
  return [M.askNotes()];
}

function stepNotes(phone, text, s) {
  const notes = text.slice(0, 300);
  const draft = { ...s.draft, notes };
  db.setSession(phone, 'awaiting_confirm', draft);
  return [M.confirmSummary(draft)];
}

async function stepConfirm(phone, lower, s) {
  if (lower === 'edit' || lower === 'no') {
    db.clearSession(phone);
    return ['Let\'s start fresh. Reply *hi* to see the menu. 🎈'];
  }
  if (lower === 'yes' || lower === 'y' || lower === 'confirm') {
    const { replies } = await finalizeBooking(phone, s.draft);
    return replies;
  }
  return ['Please reply *YES* to confirm or *EDIT* to start over.'];
}

/* Create the booking, alert the owner, mirror to sheets, send the invoice.
   Shared by the scripted flow's final confirm step and the LLM agent's
   confirm_booking tool — single source of truth for "what happens on booking". */
async function finalizeBooking(phone, b) {
  const id = db.createBooking({
    phone, name: b.name, service: b.service, event_date: b.event_date,
    venue: b.venue, area: b.area, budget: b.budget, notes: b.notes,
    amount: b.agreedAmount || null,
  });
  db.clearSession(phone);
  db.clearGoodwill(phone); // one booking redeems any pending apology gesture

  // If this customer came in as a lead, mark it converted
  const lead = db.recentLead(phone, 720); // within 30 days
  if (lead) db.markLead(lead.id, 'converted');

  // If this booking came from an approved below-floor deal, mark it converted
  if (b.approvalId) {
    db.markApprovalConverted(b.approvalId);
    sheets.updateApproval(db.getApproval(b.approvalId)).catch(() => {});
  }

  // Owner alert
  await notifyOwner(M.ownerAlert({ ...b, phone }, id));

  // Mirror to Google Sheet (non-blocking, optional)
  sheets.appendBooking(db.getBooking(id))
    .then(rowNum => { if (rowNum) db.setSheetRow(id, rowNum); })
    .catch(() => {});

  // Generate the PDF invoice; attach it if we have a public URL for Twilio to fetch
  try {
    const file = await invoice.generate(db.getBooking(id));
    db.setInvoiceFile(id, file);
    const base = process.env.PUBLIC_URL;
    if (base) {
      await sendMedia(phone, M.booked(id), `${base}/invoices/${file}`);
      return { id, replies: [] }; // confirmation text rides along with the PDF
    }
  } catch (e) {
    console.error('invoice generation failed:', e.message);
  }
  return { id, replies: [M.booked(id)] };
}

/* ---- feedback steps (triggered by scheduler, replied to here) ---- */
function stepFeedbackRating(phone, text, s) {
  const n = parseInt(text.trim(), 10);
  if (!(n >= 1 && n <= 5)) return ['Please reply with a number *1* to *5* ⭐'];
  db.saveFeedback(s.draft.bookingId, n, null);
  if (n >= 4) {
    db.clearSession(phone);
    return [M.feedbackThanksHigh()];
  }
  db.setSession(phone, 'awaiting_feedback_text', s.draft);
  return [M.feedbackThanksLow()];
}

function stepFeedbackText(phone, text, s) {
  const existing = db.getBooking(s.draft.bookingId);
  db.saveFeedback(s.draft.bookingId, existing ? existing.rating : null, text.slice(0, 500));
  db.clearSession(phone);
  notifyOwner(`⚠️ *LOW RATING FOLLOW-UP* #${s.draft.bookingId}\n\n"${text.slice(0, 500)}"\n\n📞 ${phone.replace('whatsapp:', '')}`);

  // Auto goodwill gesture — always still notifies you above, this just
  // saves you personally reaching out with the apology every time.
  const customer = db.getCustomer(phone);
  const name = customer && customer.name;
  db.setGoodwill(phone, 'Owed a free add-on apology gesture from a past low rating — offer it on their next booking.');
  return [M.feedbackNoted(), M.goodwillApology(name)];
}

module.exports = { handle, parseDate, nextAvailableDates, sendCatalog, finalizeBooking, track, SERVICE_LABEL };
