/* Staff / vendor dispatch — turns the bot into an internal ops tool too.
   Owner assigns a confirmed booking to a staff member; the bot sends the
   job brief, collects accept/decline, and forwards a proof-of-work photo
   to the customer when the staff member marks the job done. */
'use strict';

const db = require('./db');
const M = require('./messages');
const { send, sendMedia, notifyOwner } = require('./twilio');

/* ---- owner-side: manage staff + assign bookings ---- */

function toWhatsApp(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  if (d.length >= 11 && d.length <= 15) return 'whatsapp:+' + d;
  return null;
}

/* "staff add <phone> <name...>" */
async function staffAdd(ownerPhone, parts) {
  const wa = toWhatsApp(parts[0]);
  const name = parts.slice(1).join(' ') || null;
  if (!wa) return send(ownerPhone, `Usage: staff add <phone> <name>`);
  const id = db.addStaff(wa, name);
  return send(ownerPhone, `✅ Added #${id} ${name || wa} to your team.`);
}

async function staffList(ownerPhone) {
  return send(ownerPhone, M.ownerStaffList(db.listStaff()));
}

async function staffRemove(ownerPhone, id) {
  const s = db.getStaff(id);
  if (!s) return send(ownerPhone, `No staff #${id} found.`);
  db.removeStaff(id);
  return send(ownerPhone, `Removed ${s.name || s.phone} from your team.`);
}

/* "assign <bookingId> <staffId>" — send the job brief */
async function assign(ownerPhone, bookingId, staffId) {
  const booking = db.getBooking(bookingId);
  if (!booking) return send(ownerPhone, `No booking #${bookingId} found.`);
  const staff = db.getStaff(staffId);
  if (!staff || !staff.active) return send(ownerPhone, `No active staff #${staffId} found. Try *staff list*.`);

  db.assignBooking(bookingId, staffId);
  try {
    await send(staff.phone, M.staffJobBrief(booking, staff.name));
    await notifyOwner(M.ownerStaffAssigned(staff.name || staff.phone, bookingId));
  } catch (e) {
    await send(ownerPhone, `Assigned, but the message to ${staff.name || staff.phone} failed to send: ${e.message}`);
  }
}

/* Auto-assign to the least-loaded active staff member (fewest open
   notified/accepted jobs). No area-matching yet — staff don't have an area
   field. Non-fatal: returns null and leaves the booking unassigned if there
   are no active staff, so `assign <id> <staffId>` still works manually. */
async function autoAssign(bookingId) {
  const staffList = db.listStaff();
  if (!staffList.length) return null;

  let best = null, bestLoad = Infinity;
  for (const s of staffList) {
    const load = db.activeAssignmentsForStaff(s.id).length;
    if (load < bestLoad) { bestLoad = load; best = s; }
  }
  if (!best) return null;

  const booking = db.getBooking(bookingId);
  if (!booking) return null;

  db.assignBooking(bookingId, best.id);
  try {
    await send(best.phone, M.staffJobBrief(booking, best.name));
    await notifyOwner(M.ownerAutoAssigned(best.name || best.phone, bookingId));
  } catch (e) {
    await notifyOwner(`Auto-assigned booking #${bookingId} to ${best.name || best.phone}, but the message to them failed: ${e.message}`);
  }
  return best;
}

/* ---- staff-side: accept / decline / done ---- */

/* returns { handled: bool, replies: [] } — call before the owner/customer routing */
async function handleStaffMessage(fromPhone, text, mediaUrl) {
  const staff = db.getStaffByPhone(fromPhone);
  if (!staff) return { handled: false };

  const m = text.trim().match(/^(accept|decline|done)\s+(\d+)/i);
  if (!m) {
    // a bare photo with no command, or unrecognized text — only respond if they have active jobs
    if (db.activeAssignmentsForStaff(staff.id).length) await send(fromPhone, M.staffUnknownCommand());
    return { handled: true };
  }

  const cmd = m[1].toLowerCase();
  const bookingId = parseInt(m[2], 10);
  const booking = db.bookingForStaffAssignment(bookingId, staff.id);
  if (!booking) {
    await send(fromPhone, `Booking #${bookingId} isn't assigned to you.`);
    return { handled: true };
  }

  if (cmd === 'accept') {
    db.setDispatchStatus(bookingId, 'accepted');
    await send(fromPhone, M.staffAcceptedAck(bookingId));
    await notifyOwner(M.ownerStaffAccepted(staff.name || staff.phone, bookingId));
    return { handled: true };
  }

  if (cmd === 'decline') {
    db.setDispatchStatus(bookingId, 'declined');
    await send(fromPhone, M.staffDeclineAck(bookingId));
    await notifyOwner(M.ownerStaffDeclined(staff.name || staff.phone, bookingId));
    return { handled: true };
  }

  if (cmd === 'done') {
    db.setDispatchStatus(bookingId, 'completed');
    let photoSent = false;
    if (mediaUrl) {
      try { await sendMedia(booking.phone, M.customerDecorationReady(booking), mediaUrl); photoSent = true; }
      catch (e) { console.error('proof-of-work forward failed:', e.message); }
    }
    if (!photoSent) await send(booking.phone, M.customerDecorationReady(booking));
    await send(fromPhone, photoSent ? M.staffDoneWithPhoto(bookingId) : M.staffDoneNoPhoto(bookingId));
    await notifyOwner(M.ownerStaffCompleted(staff.name || staff.phone, bookingId, photoSent));
    return { handled: true };
  }

  return { handled: true };
}

module.exports = { staffAdd, staffList, staffRemove, assign, autoAssign, handleStaffMessage, toWhatsApp };
