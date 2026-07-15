/* PDF booking invoice generator (pdfkit — pure JS).
   Writes to ../invoices/<file>.pdf and returns the filename. The server serves
   ../invoices statically so Twilio can attach it via mediaUrl.
   Shows the agreed/negotiated amount when one is on the booking. */
'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const DIR = path.join(__dirname, '..', 'invoices');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const BRAND = "Flowers 'N' Balloons";
const PINK = '#e91e8c';
const PURPLE = '#7b2d8b';
const GREY = '#666666';

const SERVICE = {
  birthday: 'Birthday Decoration', wedding: 'Wedding Decoration',
  babyshower: 'Baby Shower Decor', corporate: 'Corporate Event',
};

/* returns Promise<filename> */
function generate(booking) {
  return new Promise((resolve, reject) => {
    const file = `invoice-${booking.id}.pdf`;
    const full = path.join(DIR, file);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(full);
    doc.pipe(stream);

    // Header band
    doc.rect(0, 0, doc.page.width, 92).fill(PINK);
    doc.fillColor('#ffffff').fontSize(26).text(BRAND, 50, 28);
    doc.fontSize(11).fillColor('#ffe3f2').text('Bangalore Event Decoration Experts  ·  +91 8867121207', 50, 62);

    // Title
    doc.fillColor(PURPLE).fontSize(20).text('INVOICE', 50, 120);
    doc.fillColor(GREY).fontSize(10)
      .text(`Invoice #${booking.id}`, 0, 122, { align: 'right', width: doc.page.width - 50 })
      .text(new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        0, 136, { align: 'right', width: doc.page.width - 50 });

    // Customer
    let y = 170;
    doc.fillColor('#111').fontSize(12).text('Billed to', 50, y);
    doc.fillColor(GREY).fontSize(11)
      .text(booking.name || '-', 50, y + 18)
      .text((booking.phone || '').replace('whatsapp:', ''), 50, y + 34);

    // Event details table
    y = 250;
    doc.fillColor(PURPLE).fontSize(13).text('Event Details', 50, y);
    y += 24;
    const rows = [
      ['Service', SERVICE[booking.service] || booking.service || '-'],
      ['Event date', booking.event_date || '-'],
      ['Area', booking.area || '-'],
      ['Venue', booking.venue || '-'],
      ['Budget tier', booking.budget || '-'],
    ];
    if (booking.notes && booking.notes.toLowerCase() !== 'no') rows.push(['Special requests', booking.notes]);

    doc.fontSize(11);
    rows.forEach((r, i) => {
      const ry = y + i * 24;
      if (i % 2 === 0) doc.rect(50, ry - 4, doc.page.width - 100, 24).fill('#fbf0f6');
      doc.fillColor('#333').text(r[0], 60, ry, { width: 150 });
      doc.fillColor('#111').text(String(r[1]), 220, ry, { width: 320 });
    });
    y += rows.length * 24 + 24;

    // Amount block
    doc.rect(50, y, doc.page.width - 100, 50).fill(PURPLE);
    doc.fillColor('#fff').fontSize(12).text(booking.amount ? 'Agreed amount' : 'Amount', 62, y + 9);
    if (booking.amount) {
      doc.fontSize(20).text(`Rs. ${Number(booking.amount).toLocaleString('en-IN')}`, 62, y + 24);
      const payTxt = booking.payment_status === 'paid' ? 'PAID' :
        (booking.payment_link ? 'Payment link sent' : 'Payable on confirmation');
      doc.fontSize(11).text(payTxt, 0, y + 18, { align: 'right', width: doc.page.width - 70 });
    } else {
      doc.fontSize(13).text('Custom quote shared on call', 62, y + 26);
    }
    y += 74;

    // Footer note
    doc.fillColor(GREY).fontSize(10).text(
      'Thank you for booking with us! Our team will call within 30 minutes to finalise details. ' +
      'Prices are inclusive of setup and cleanup. This invoice confirms your booking.',
      50, y + 8, { width: doc.page.width - 100 });

    doc.moveTo(50, 780).lineTo(doc.page.width - 50, 780).strokeColor(PINK).stroke();
    doc.fillColor(PINK).fontSize(11).text("Flowers 'N' Balloons  ·  Making your celebrations unforgettable 🎈", 50, 788, {
      width: doc.page.width - 100, align: 'center',
    });

    doc.end();
    stream.on('finish', () => resolve(file));
    stream.on('error', reject);
  });
}

module.exports = { generate, DIR };
