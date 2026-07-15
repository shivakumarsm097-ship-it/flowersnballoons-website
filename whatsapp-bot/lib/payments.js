/* Razorpay payment links. Optional — inert if keys not set.
   Creates a hosted payment link the customer taps to pay; Razorpay hosts the
   checkout (cards/UPI/wallets). We never handle card data. */
'use strict';

const enabled = !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
let client = null;

if (enabled) {
  const Razorpay = require('razorpay');
  client = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

/* amountRupees → { short_url, id } ; throws if disabled */
async function createLink(booking, amountRupees) {
  if (!enabled) throw new Error('Razorpay not configured');
  const phone = (booking.phone || '').replace('whatsapp:', '');
  const link = await client.paymentLink.create({
    amount: Math.round(amountRupees * 100),   // paise
    currency: 'INR',
    accept_partial: false,
    description: `Booking #${booking.id} — ${booking.service} (${booking.event_date})`,
    customer: { name: booking.name || 'Customer', contact: phone },
    notify: { sms: false, email: false },     // we deliver via WhatsApp ourselves
    reminder_enable: true,
    notes: { booking_id: String(booking.id) },
  });
  return { short_url: link.short_url, id: link.id };
}

/* verify Razorpay webhook signature (payment.captured etc.) */
function verifyWebhook(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const crypto = require('crypto');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return expected === signature;
}

module.exports = { enabled, createLink, verifyWebhook };
