/* Flowers 'N' Balloons — WhatsApp alert for every website enquiry.
 *
 * When a quote form passes validation, js/main.js fires a "fnb:lead" event.
 * This file turns the form into a WhatsApp message and sends it to the owner
 * through CallMeBot (https://www.callmebot.com/blog/free-api-whatsapp-messages/),
 * at the same moment the e-mail is sent — so a lead still reaches WhatsApp even
 * if the e-mail service fails.
 *
 * ── SETUP (one time) ─────────────────────────────────────────────────────────
 * 1. Follow CallMeBot's WhatsApp instructions on their site to get your API key
 *    (you send their bot one WhatsApp message from the phone below).
 * 2. Put the key between the quotes in CALLMEBOT_APIKEY below and save.
 *    Until a key is set, nothing is sent (forms keep working as before).
 * Note: this file is public, so anyone could read the key and send messages to
 * YOUR WhatsApp only. If that ever happens, get a new key from CallMeBot.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  var WHATSAPP_PHONE = '+918867121207';  // the WhatsApp number that receives lead alerts
  var CALLMEBOT_APIKEY = '';             // ← paste your CallMeBot API key here

  if (!CALLMEBOT_APIKEY) return;

  var FIELDS = [
    ['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'],
    ['event_type', 'Event'], ['event_date', 'Date'], ['budget', 'Budget'],
    ['venue_type', 'Venue'], ['guests', 'Guests'], ['theme', 'Theme'],
    ['message', 'Message']
  ];

  function digits(s) { return String(s || '').replace(/\D/g, ''); }

  function buildText(form) {
    var fd = new FormData(form);
    var lines = ['🎈 New website enquiry'];
    FIELDS.forEach(function (f) {
      var v = String(fd.get(f[0]) || '').trim();
      if (v) lines.push(f[1] + ': ' + v);
    });
    var p = digits(fd.get('phone'));
    if (p.length === 10) p = '91' + p;
    if (p) lines.push('Reply on WhatsApp: https://wa.me/' + p);
    lines.push('Page: ' + (location.pathname || '/'));
    return lines.join('\n').slice(0, 1500);
  }

  document.addEventListener('fnb:lead', function (e) {
    try {
      var form = e.detail && e.detail.form;
      if (!form) return;
      var url = 'https://api.callmebot.com/whatsapp.php' +
        '?phone=' + encodeURIComponent(WHATSAPP_PHONE) +
        '&text=' + encodeURIComponent(buildText(form)) +
        '&apikey=' + encodeURIComponent(CALLMEBOT_APIKEY);
      // no-cors: CallMeBot doesn't send CORS headers; keepalive: survive the redirect to the thank-you page
      fetch(url, { mode: 'no-cors', keepalive: true }).catch(function () {});
    } catch (err) { /* alerting must never break the form */ }
  });
})();
