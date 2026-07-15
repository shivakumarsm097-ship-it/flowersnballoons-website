/* SQLite storage — bookings + conversation state. Self-contained, no cloud account. */
'use strict';

const path = require('path');
const { DatabaseSync } = require('node:sqlite');   // built into Node 22.5+ / 24+ / 26

const db = new DatabaseSync(path.join(__dirname, '..', 'data.sqlite'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    phone       TEXT PRIMARY KEY,          -- whatsapp:+91...
    name        TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    phone       TEXT PRIMARY KEY,          -- one live conversation per number
    step        TEXT,                      -- current flow step id
    draft       TEXT,                      -- JSON scratchpad for in-progress booking
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    phone         TEXT,
    name          TEXT,
    service       TEXT,                    -- birthday | wedding | babyshower | corporate
    event_date    TEXT,                    -- YYYY-MM-DD
    venue         TEXT,
    area          TEXT,
    budget        TEXT,
    notes         TEXT,
    status        TEXT DEFAULT 'new',      -- new | confirmed | executing | done | cancelled
    reminder_sent INTEGER DEFAULT 0,
    checkin_sent  INTEGER DEFAULT 0,
    feedback_sent INTEGER DEFAULT 0,
    rating        INTEGER,                 -- 1..5 from feedback
    feedback_text TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS approvals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT,
    name        TEXT,
    service     TEXT,
    requested   INTEGER,                   -- price the customer asked for (₹)
    floor       INTEGER,                    -- our floor for that service (₹)
    status      TEXT DEFAULT 'pending',     -- pending | approved | rejected
    decided     INTEGER,                    -- final price you approved (₹)
    converted   INTEGER DEFAULT 0,          -- 1 once it became a booking
    sheet_row   INTEGER,                    -- Google Sheet row for this approval
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT,
    name        TEXT,
    service     TEXT,
    source      TEXT,                      -- lp-wedding | homepage | google-ads ...
    status      TEXT DEFAULT 'contacted',  -- contacted | engaged | converted
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS staff (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT UNIQUE,               -- whatsapp:+91...
    name        TEXT,
    active      INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now'))
  );
`);

/* ---- migrations: add columns to existing DBs (ignore if already present) ---- */
for (const col of [
  "amount INTEGER",                 // quoted amount / advance in ₹
  "invoice_file TEXT",              // generated PDF filename
  "payment_link TEXT",             // razorpay short_url
  "payment_status TEXT DEFAULT 'unpaid'",
  "sheet_row INTEGER",             // Google Sheet row number for this booking
  "assigned_staff_id INTEGER",     // staff.id handling this booking
  "dispatch_status TEXT DEFAULT 'unassigned'", // unassigned|notified|accepted|declined|completed
  "payment_link_at TEXT",          // when the payment link was sent (for 24h reminder)
  "payment_reminder_sent INTEGER DEFAULT 0",
]) {
  try { db.exec(`ALTER TABLE bookings ADD COLUMN ${col}`); }
  catch (e) { /* duplicate column name — already migrated */ }
}

for (const col of [
  "goodwill_note TEXT", // pending apology gesture from a low rating, redeemed on next booking
]) {
  try { db.exec(`ALTER TABLE customers ADD COLUMN ${col}`); }
  catch (e) { /* duplicate column name — already migrated */ }
}

module.exports = {
  /* ---- session (conversation state machine) ---- */
  getSession(phone) {
    const row = db.prepare('SELECT * FROM sessions WHERE phone = ?').get(phone);
    if (!row) return null;
    return { ...row, draft: row.draft ? JSON.parse(row.draft) : {} };
  },
  setSession(phone, step, draft) {
    db.prepare(`
      INSERT INTO sessions (phone, step, draft, updated_at)
      VALUES (@phone, @step, @draft, datetime('now'))
      ON CONFLICT(phone) DO UPDATE SET
        step = @step, draft = @draft, updated_at = datetime('now')
    `).run({ phone, step, draft: JSON.stringify(draft || {}) });
  },
  clearSession(phone) {
    db.prepare('DELETE FROM sessions WHERE phone = ?').run(phone);
  },

  /* ---- customers ---- */
  upsertCustomer(phone, name) {
    db.prepare(`
      INSERT INTO customers (phone, name) VALUES (?, ?)
      ON CONFLICT(phone) DO UPDATE SET name = COALESCE(excluded.name, name)
    `).run(phone, name || null);
  },
  getCustomer(phone) {
    return db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  },
  setGoodwill(phone, note) {
    db.prepare('UPDATE customers SET goodwill_note = ? WHERE phone = ?').run(note, phone);
  },
  clearGoodwill(phone) {
    db.prepare('UPDATE customers SET goodwill_note = NULL WHERE phone = ?').run(phone);
  },

  /* ---- bookings ---- */
  createBooking(b) {
    const info = db.prepare(`
      INSERT INTO bookings (phone, name, service, event_date, venue, area, budget, notes, amount)
      VALUES (@phone, @name, @service, @event_date, @venue, @area, @budget, @notes, @amount)
    `).run({
      phone: b.phone, name: b.name, service: b.service,
      event_date: b.event_date, venue: b.venue || null, area: b.area || null,
      budget: b.budget || null, notes: b.notes || null, amount: b.amount || null,
    });
    return info.lastInsertRowid;
  },
  getBooking(id) {
    return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  },
  latestActiveBooking(phone) {
    return db.prepare(`
      SELECT * FROM bookings
      WHERE phone = ? AND status NOT IN ('done','cancelled')
      ORDER BY id DESC LIMIT 1
    `).get(phone);
  },
  setStatus(id, status) {
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, id);
  },
  saveFeedback(id, rating, text) {
    db.prepare('UPDATE bookings SET rating = ?, feedback_text = ? WHERE id = ?')
      .run(rating, text || null, id);
  },
  setInvoiceFile(id, file) {
    db.prepare('UPDATE bookings SET invoice_file = ? WHERE id = ?').run(file, id);
  },
  setPayment(id, link, amount) {
    db.prepare(`
      UPDATE bookings
      SET payment_link = ?, amount = ?, payment_status = ?, payment_link_at = datetime('now'), payment_reminder_sent = 0
      WHERE id = ?
    `).run(link, amount, 'link_sent', id);
  },
  setPaymentStatus(id, status) {
    db.prepare('UPDATE bookings SET payment_status = ? WHERE id = ?').run(status, id);
  },
  duePaymentReminders(hours = 24) {
    return db.prepare(`
      SELECT * FROM bookings
      WHERE payment_status = 'link_sent' AND payment_reminder_sent = 0
        AND payment_link_at IS NOT NULL AND payment_link_at <= datetime('now', ?)
    `).all(`-${hours} hours`);
  },
  markPaymentReminderSent(id) {
    db.prepare('UPDATE bookings SET payment_reminder_sent = 1 WHERE id = ?').run(id);
  },
  setSheetRow(id, row) {
    db.prepare('UPDATE bookings SET sheet_row = ? WHERE id = ?').run(row, id);
  },

  /* ---- leads ---- */
  createLead(l) {
    const info = db.prepare(`
      INSERT INTO leads (phone, name, service, source)
      VALUES (@phone, @name, @service, @source)
    `).run({ phone: l.phone, name: l.name || null, service: l.service || null, source: l.source || null });
    return info.lastInsertRowid;
  },
  recentLead(phone, hours = 12) {
    return db.prepare(`
      SELECT * FROM leads
      WHERE phone = ? AND created_at >= datetime('now', ?)
      ORDER BY id DESC LIMIT 1
    `).get(phone, `-${hours} hours`);
  },
  markLead(id, status) {
    db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, id);
  },

  /* ---- staff / vendor dispatch ---- */
  addStaff(phone, name) {
    const info = db.prepare(`
      INSERT INTO staff (phone, name) VALUES (?, ?)
      ON CONFLICT(phone) DO UPDATE SET name = excluded.name, active = 1
    `).run(phone, name || null);
    return info.lastInsertRowid || db.prepare('SELECT id FROM staff WHERE phone = ?').get(phone).id;
  },
  listStaff(activeOnly = true) {
    return activeOnly
      ? db.prepare('SELECT * FROM staff WHERE active = 1 ORDER BY id').all()
      : db.prepare('SELECT * FROM staff ORDER BY id').all();
  },
  getStaff(id) {
    return db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
  },
  getStaffByPhone(phone) {
    return db.prepare('SELECT * FROM staff WHERE phone = ? AND active = 1').get(phone);
  },
  removeStaff(id) {
    db.prepare('UPDATE staff SET active = 0 WHERE id = ?').run(id);
  },
  assignBooking(bookingId, staffId) {
    db.prepare(`UPDATE bookings SET assigned_staff_id = ?, dispatch_status = 'notified' WHERE id = ?`)
      .run(staffId, bookingId);
  },
  setDispatchStatus(bookingId, status) {
    db.prepare('UPDATE bookings SET dispatch_status = ? WHERE id = ?').run(status, bookingId);
  },
  bookingForStaffAssignment(bookingId, staffId) {
    return db.prepare('SELECT * FROM bookings WHERE id = ? AND assigned_staff_id = ?').get(bookingId, staffId);
  },
  activeAssignmentsForStaff(staffId) {
    return db.prepare(`
      SELECT * FROM bookings WHERE assigned_staff_id = ? AND dispatch_status IN ('notified','accepted') ORDER BY event_date
    `).all(staffId);
  },

  /* ---- owner approvals (below-floor deals) ---- */
  createApproval(a) {
    const info = db.prepare(`
      INSERT INTO approvals (phone, name, service, requested, floor)
      VALUES (@phone, @name, @service, @requested, @floor)
    `).run({ phone: a.phone, name: a.name || null, service: a.service || null,
      requested: a.requested, floor: a.floor });
    return info.lastInsertRowid;
  },
  getApproval(id) {
    return db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
  },
  setApprovalStatus(id, status, decided) {
    db.prepare('UPDATE approvals SET status = ?, decided = COALESCE(?, decided) WHERE id = ?')
      .run(status, decided ?? null, id);
  },
  setApprovalSheetRow(id, row) {
    db.prepare('UPDATE approvals SET sheet_row = ? WHERE id = ?').run(row, id);
  },
  markApprovalConverted(id) {
    db.prepare('UPDATE approvals SET converted = 1 WHERE id = ?').run(id);
  },

  /* ---- capacity / scheduling ---- */
  countBookingsOnDate(date) {
    return db.prepare(`
      SELECT COUNT(*) AS n FROM bookings WHERE event_date = ? AND status != 'cancelled'
    `).get(date).n;
  },
  eventsOnDate(date) {
    return db.prepare(`
      SELECT * FROM bookings WHERE event_date = ? AND status != 'cancelled' ORDER BY id
    `).all(date);
  },

  /* ---- owner daily digest ---- */
  recentLeadsPending(hours) {
    return db.prepare(`
      SELECT * FROM leads WHERE created_at >= datetime('now', ?) AND status != 'converted' ORDER BY id DESC
    `).all(`-${hours} hours`);
  },
  pendingApprovals() {
    return db.prepare(`SELECT * FROM approvals WHERE status = 'pending' ORDER BY id`).all();
  },
  monthSummary() {
    return db.prepare(`
      SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
      FROM bookings
      WHERE status IN ('confirmed','executing','done')
        AND strftime('%Y-%m', event_date) = strftime('%Y-%m', 'now')
    `).get();
  },

  /* ---- scheduler queries ---- */
  dueForReminder(dateStr) {          // event tomorrow, confirmed, not yet reminded
    return db.prepare(`
      SELECT * FROM bookings
      WHERE event_date = ? AND status = 'confirmed' AND reminder_sent = 0
    `).all(dateStr);
  },
  dueForCheckin(dateStr) {           // event today, not yet checked in
    return db.prepare(`
      SELECT * FROM bookings
      WHERE event_date = ? AND status IN ('confirmed','executing') AND checkin_sent = 0
    `).all(dateStr);
  },
  dueForFeedback(dateStr) {          // event was yesterday, no feedback ask yet
    return db.prepare(`
      SELECT * FROM bookings
      WHERE event_date = ? AND status IN ('confirmed','executing','done') AND feedback_sent = 0
    `).all(dateStr);
  },
  markFlag(id, col) {
    const allowed = ['reminder_sent', 'checkin_sent', 'feedback_sent'];
    if (!allowed.includes(col)) throw new Error('bad flag');
    db.prepare(`UPDATE bookings SET ${col} = 1 WHERE id = ?`).run(id);
  },

  _db: db,
};
