/* Google Sheets mirror of bookings — so non-technical staff see everything live.
   Optional: inert if GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_SHEET_ID not set.

   Setup:
     1. Google Cloud console → create a Service Account → download JSON key.
     2. Put the JSON file path in GOOGLE_SERVICE_ACCOUNT_JSON (or paste raw JSON).
     3. Create a Google Sheet, share it (Editor) with the service account email.
     4. Put the sheet ID (from its URL) in GOOGLE_SHEET_ID.
*/
'use strict';

const fs = require('fs');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CRED = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const enabled = !!(SHEET_ID && CRED);
const TAB = process.env.GOOGLE_SHEET_TAB || 'Bookings';

const HEADERS = ['ID', 'Created', 'Name', 'Phone', 'Service', 'Event Date',
  'Area', 'Venue', 'Budget', 'Notes', 'Status', 'Amount', 'Payment', 'Rating'];

let sheetsApi = null;
let headerEnsured = false;

async function api() {
  if (sheetsApi) return sheetsApi;
  const { google } = require('googleapis');
  const creds = CRED.trim().startsWith('{') ? JSON.parse(CRED) : JSON.parse(fs.readFileSync(CRED, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsApi = google.sheets({ version: 'v4', auth: await auth.getClient() });
  return sheetsApi;
}

async function ensureHeader() {
  if (headerEnsured) return;
  const s = await api();
  const got = await s.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!A1:N1` });
  if (!got.data.values || !got.data.values.length) {
    await s.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `${TAB}!A1`,
      valueInputOption: 'RAW', requestBody: { values: [HEADERS] },
    });
  }
  headerEnsured = true;
}

function row(b) {
  return [b.id, b.created_at || '', b.name || '', (b.phone || '').replace('whatsapp:', ''),
    b.service || '', b.event_date || '', b.area || '', b.venue || '', b.budget || '',
    b.notes || '', b.status || '', b.amount || '', b.payment_status || '', b.rating || ''];
}

/* append new booking → returns 1-based sheet row number (or null) */
async function appendBooking(b) {
  if (!enabled) return null;
  try {
    await ensureHeader();
    const s = await api();
    const res = await s.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `${TAB}!A:N`,
      valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row(b)] },
    });
    // updatedRange like "Bookings!A5:N5" → grab 5
    const m = /![A-Z]+(\d+):/.exec(res.data.updates.updatedRange || '');
    return m ? parseInt(m[1], 10) : null;
  } catch (e) { console.error('sheets append failed:', e.message); return null; }
}

/* rewrite an existing booking row in place */
async function updateBooking(b) {
  if (!enabled || !b.sheet_row) return;
  try {
    const s = await api();
    await s.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `${TAB}!A${b.sheet_row}:N${b.sheet_row}`,
      valueInputOption: 'USER_ENTERED', requestBody: { values: [row(b)] },
    });
  } catch (e) { console.error('sheets update failed:', e.message); }
}

/* ── Approvals tab: track below-floor asks + conversion ───────────────── */
const APPROVAL_TAB = process.env.GOOGLE_APPROVAL_TAB || 'Approvals';
const APPROVAL_HEADERS = ['ID', 'Created', 'Name', 'Phone', 'Service',
  'Requested', 'Floor', 'Status', 'Decided', 'Converted'];
let approvalHeaderEnsured = false;

async function ensureApprovalHeader() {
  if (approvalHeaderEnsured) return;
  const s = await api();
  // create the tab if it doesn't exist yet
  const meta = await s.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const exists = (meta.data.sheets || []).some((sh) => sh.properties.title === APPROVAL_TAB);
  if (!exists) {
    await s.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: APPROVAL_TAB } } }] },
    });
  }
  const got = await s.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${APPROVAL_TAB}!A1:J1` });
  if (!got.data.values || !got.data.values.length) {
    await s.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `${APPROVAL_TAB}!A1`,
      valueInputOption: 'RAW', requestBody: { values: [APPROVAL_HEADERS] },
    });
  }
  approvalHeaderEnsured = true;
}

function approvalRow(a) {
  return [a.id, a.created_at || '', a.name || '', (a.phone || '').replace('whatsapp:', ''),
    a.service || '', a.requested || '', a.floor || '', a.status || '',
    a.decided || '', a.converted ? 'Yes' : 'No'];
}

async function appendApproval(a) {
  if (!enabled) return null;
  try {
    await ensureApprovalHeader();
    const s = await api();
    const res = await s.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `${APPROVAL_TAB}!A:J`,
      valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [approvalRow(a)] },
    });
    const m = /![A-Z]+(\d+):/.exec(res.data.updates.updatedRange || '');
    return m ? parseInt(m[1], 10) : null;
  } catch (e) { console.error('sheets approval append failed:', e.message); return null; }
}

async function updateApproval(a) {
  if (!enabled || !a.sheet_row) return;
  try {
    const s = await api();
    await s.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `${APPROVAL_TAB}!A${a.sheet_row}:J${a.sheet_row}`,
      valueInputOption: 'USER_ENTERED', requestBody: { values: [approvalRow(a)] },
    });
  } catch (e) { console.error('sheets approval update failed:', e.message); }
}

module.exports = { enabled, appendBooking, updateBooking, appendApproval, updateApproval };
