/* All customer-facing copy in one place. Edit tone/prices here.
   Voice: Shiva (owner), first-person, premium concierge, English. Signed personally. */
'use strict';

const BRAND = "Flowers 'N' Balloons";
const OWNER_NAME = 'Shiva';
const PHONE = '+91 8867121207';
const SIGN = `— ${OWNER_NAME}`;

const SERVICES = {
  '1': { key: 'birthday',   label: 'Birthday Decoration',  from: '₹3,000'  },
  '2': { key: 'wedding',    label: 'Wedding Decoration',   from: '₹15,000' },
  '3': { key: 'babyshower', label: 'Baby Shower Decor',    from: '₹5,000'  },
  '4': { key: 'corporate',  label: 'Corporate Event',      from: '₹10,000' },
};

module.exports = {
  BRAND, PHONE, OWNER_NAME, SERVICES,

  welcome: () =>
    `Hello, and welcome to *${BRAND}* 🎈\n\n` +
    `I'm ${OWNER_NAME} — I run the studio here in Bangalore, and I'll personally make sure your celebration is looked after.\n\n` +
    `How may I help you today?\n\n` +
    `*1* — Birthday Decoration 🎂\n` +
    `*2* — Wedding Decoration 💍\n` +
    `*3* — Baby Shower Decor 🍼\n` +
    `*4* — Corporate Event 🎊\n` +
    `*5* — Track my booking 📋\n` +
    `*6* — Speak with me directly 📞\n` +
    `*7* — See prices & photos 🖼️\n\n` +
    `_Simply reply with a number._`,

  /* ---- catalog: packages & pricing (Shiva voice) ---- */
  priceList: (serviceLabel, packages) => {
    const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
    let out = `Here are my *${serviceLabel}* packages 🎀\n`;
    packages.forEach((p) => {
      out += `\n*${p.name}* — from ${inr(p.price)}${p.popular ? '  ⭐ _most popular_' : ''}\n`;
      out += p.includes.map((x) => `   • ${x}`).join('\n') + '\n';
    });
    out += `\n_Every setup is customised to your theme & venue. Prices are starting points — I'll tailor an exact quote for you._\n${SIGN}`;
    return out;
  },

  photoCaption: (serviceLabel) =>
    `A few of my recent *${serviceLabel}* setups 📸 — yours will be designed around your theme.`,

  catalogMenu: () =>
    `Which would you like to see prices & photos for?\n\n` +
    `*1* — Birthday 🎂\n*2* — Wedding 💍\n*3* — Baby Shower 🍼\n*4* — Corporate 🎊\n\n` +
    `_Reply with a number._`,

  noPhotos: (serviceLabel) =>
    `I'll share sample *${serviceLabel}* photos on WhatsApp shortly. For the full gallery visit our website or call ${PHONE} 📸`,

  /* ---- proactive lead opener (business-initiated) ---- */
  // service may be a known label or empty (generic enquiry)
  leadOpener: (name, serviceLabel) => {
    const hi = name ? `Hello ${name},` : `Hello,`;
    const svc = serviceLabel ? `your *${serviceLabel}* enquiry` : `your enquiry`;
    const ask = name
      ? `To get started, may I ask which *date* your celebration is on? (e.g. 25 Dec 2026)`
      : `To get started, may I have your *name*, please?`;
    return (
      `${hi} this is ${OWNER_NAME} from *${BRAND}* 🎈\n\n` +
      `Thank you for reaching out about ${svc} — I'd be delighted to plan it for you personally.\n\n` +
      `${ask}\n${SIGN}`
    );
  },
  // template variable map, when using an approved Twilio Content template
  // e.g. template body: "Hello {{1}}, this is Shiva from Flowers 'N' Balloons..."
  leadTemplateVars: (name, serviceLabel) => ({
    1: name || 'there',
    2: serviceLabel || 'your event',
  }),

  ownerLeadAlert: (l, id) =>
    `📥 *NEW LEAD* #${id}  (${l.source || 'web'})\n` +
    `👤 ${l.name || '—'}\n` +
    `📞 ${l.phone.replace('whatsapp:', '')}\n` +
    `🎉 ${l.serviceLabel || l.service || '—'}\n\n` +
    `I've messaged them automatically to start the conversation.`,

  askName: (svc) =>
    `Wonderful choice — *${svc.label}* (from ${svc.from}) ✨\n\n` +
    `I'll take care of this personally. May I have your *name*, please?`,

  askDate: () =>
    `A pleasure to meet you 🙌\n\nWhich *date* is the celebration? (e.g. 25 Dec 2026 or 25/12/2026)`,

  dateError: () =>
    `Apologies — I couldn't quite read that date. Could you send it as *25 Dec 2026* or *25/12/2026*?`,

  dateFullyBooked: (humanDate, alt) => {
    const altLines = alt.map((a) => `   • ${a.human}`).join('\n');
    return (
      `I'm so sorry — *${humanDate}* is already fully booked on my calendar 🙏 ` +
      `I only take on a limited number of events per day so every celebration gets my full attention.\n\n` +
      (alt.length
        ? `Here are my next open dates:\n${altLines}\n\nWould any of these work? Or share another date and I'll check it for you.`
        : `Could you share a different date and I'll check availability right away?`) +
      `\n${SIGN}`
    );
  },

  askArea: () =>
    `Lovely. Which *part of Bangalore* will this be in? (e.g. Koramangala, Whitefield, HSR Layout)`,

  askVenue: () =>
    `And the *venue*? (home / banquet hall / resort — or the venue's name)`,

  askBudget: () =>
    `To tailor the right proposal for you, what *budget* did you have in mind?\n\n` +
    `*1* — Basic\n*2* — Standard\n*3* — Premium\n*4* — I'd like your guidance\n\n` +
    `_Reply with a number, or type an amount._`,

  budgetLabel: (input) => {
    const map = { '1': 'Basic', '2': 'Standard', '3': 'Premium', '4': 'Guidance' };
    return map[input.trim()] || input.trim();
  },

  askNotes: () =>
    `Anything special you'd like me to arrange? (a theme, colours, timing…)\n\n_Or reply *no* and I'll suggest ideas myself._`,

  confirmSummary: (b) =>
    `Here's what I have for you — please confirm 📝\n\n` +
    `👤 Name: *${b.name}*\n` +
    `🎉 Service: *${b.serviceLabel}*\n` +
    `📅 Date: *${b.event_date_h}*\n` +
    `📍 Area: *${b.area}*\n` +
    `🏛 Venue: *${b.venue}*\n` +
    `💰 Budget: *${b.budget}*\n` +
    (b.agreedAmount ? `🤝 Agreed price: *₹${Number(b.agreedAmount).toLocaleString('en-IN')}*\n` : '') +
    (b.notes && b.notes !== 'no' ? `📌 Notes: *${b.notes}*\n` : '') +
    `\nReply *YES* to confirm, or *EDIT* if you'd like to change anything.`,

  booked: (id) =>
    `Thank you — you're in good hands ✅ (Ref #${id})\n\n` +
    `I'll call you *within 30 minutes* on this number to understand your vision and share a tailored quote.\n\n` +
    `If you'd like me sooner, reach me directly at ${PHONE} 📞\n\n` +
    `It'll be my privilege to make this special for you.\n${SIGN}`,

  ownerAlert: (b, id) =>
    `🔔 *NEW BOOKING* #${id}\n\n` +
    `${b.serviceLabel}\n` +
    `👤 ${b.name}\n` +
    `📞 ${b.phone.replace('whatsapp:', '')}\n` +
    `📅 ${b.event_date_h}\n` +
    `📍 ${b.area} — ${b.venue}\n` +
    `💰 ${b.budget}\n` +
    (b.agreedAmount ? `🤝 *Negotiated price: ₹${Number(b.agreedAmount).toLocaleString('en-IN')}*\n` : '') +
    (b.notes && b.notes !== 'no' ? `📌 ${b.notes}\n` : '') +
    `\n👉 Call the customer within 30 min.`,

  /* ---- owner daily digest (07:30 IST) ---- */
  ownerDigest: ({ today, tomorrow, leads, approvals, month }) => {
    const rs = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
    const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');
    const eventLine = (b) => `   • #${b.id} ${b.name || '—'} — ${cap(b.service)}, ${b.area || 'area TBC'}`;
    const leadLine = (l) => `   • ${l.name || 'Unknown'} (${(l.phone || '').replace('whatsapp:', '')})${l.service ? ' — ' + cap(l.service) : ''}`;
    const apprLine = (a) => `   • #${a.id} — wants ${rs(a.requested)}, your floor ${rs(a.floor)}`;

    const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

    let out = `☀️ *Good morning! Here's your day* — ${dateStr}\n\n`;

    out += `📅 *Today (${today.length})*\n`;
    out += today.length ? today.map(eventLine).join('\n') + '\n\n' : `   Nothing scheduled today.\n\n`;

    out += `🔜 *Tomorrow (${tomorrow.length})*\n`;
    out += tomorrow.length ? tomorrow.map(eventLine).join('\n') + '\n\n' : `   Nothing scheduled yet.\n\n`;

    if (leads.length) out += `💬 *New leads awaiting your reply (${leads.length})*\n` + leads.map(leadLine).join('\n') + '\n\n';
    if (approvals.length) out += `🔒 *Approvals pending your decision (${approvals.length})*\n` + approvals.map(apprLine).join('\n') + '\n\n';

    out += `📊 *This month:* ${month.n} booking${month.n === 1 ? '' : 's'} confirmed · ${rs(month.total)} pipeline`;
    return out;
  },

  /* ---- tracking ---- */
  trackNone: () =>
    `I don't see an active booking on this number yet. Reply *hi* and I'll set one up for you 🎈`,
  trackStatus: (b) => {
    const map = {
      new:       '🕐 Received — I\'ll be in touch very shortly.',
      confirmed: '✅ Confirmed — everything is arranged for your day.',
      executing: '🎨 In progress — my team is setting up your décor now.',
      done:      '🎉 Completed — I hope it was everything you wished for.',
    };
    return `Your booking *#${b.id}* — ${b.service}\n📅 ${b.event_date}\n\nStatus: ${map[b.status] || b.status}\n${SIGN}`;
  },

  human: () =>
    `Of course — I'd be glad to speak with you directly 📞\n\n` +
    `Call or WhatsApp me anytime at *${PHONE}* and I'll assist you personally.\n\n` +
    `Or reply *hi* to continue here.\n${SIGN}`,

  fallback: () =>
    `Forgive me — I didn't quite follow. Reply *hi* and I'll show you the menu 🎈`,

  /* ---- lifecycle (scheduler) ---- */
  reminder: (b) =>
    `Hello ${b.name}, ${OWNER_NAME} here 🎈\n\n` +
    `A gentle reminder that your *${b.service}* is *tomorrow* (${b.event_date}) at ${b.venue}. ` +
    `My team will arrive in good time to set everything up beautifully.\n\n` +
    `If anything's on your mind, reply here or call me at ${PHONE}. I'm looking forward to it.\n${SIGN}`,

  checkin: (b) =>
    `Good morning ${b.name} — today's the day! 🎉\n\n` +
    `My team is on the way to ${b.venue} for your *${b.service}* setup. ` +
    `If you'd like anything adjusted, just reply here and I'll see to it personally.\n\n` +
    `Wishing you a wonderful celebration.\n${SIGN}`,

  feedbackAsk: (b) =>
    `Hello ${b.name} 🌸\n\n` +
    `I hope your *${b.service}* was everything you'd imagined. Your honest opinion means a great deal to me.\n\n` +
    `How would you rate my service? Reply *1* to *5* ⭐\n\n_(5 = exceptional, 1 = disappointing)_\n${SIGN}`,

  feedbackThanksHigh: () =>
    `Thank you — that truly means the world to me 🙏\n\n` +
    `If you have a moment, a short Google review would help my small studio enormously 💖\n` +
    `👉 https://g.page/r/YOUR_GOOGLE_REVIEW_LINK\n\n` +
    `And do tag me in your photos — I'd love to see them 📸\n${SIGN}`,

  feedbackThanksLow: () =>
    `I'm genuinely sorry it fell short 🙏\n\n` +
    `Please tell me exactly what went wrong — I read every message myself and I'll make it right.\n\n` +
    `_Reply here, or call me directly at ${PHONE}._\n${SIGN}`,

  feedbackNoted: () =>
    `Thank you for telling me — I've noted every word and I'll personally follow up. 💐\n${SIGN}`,

  /* ---- payments ---- */
  payLink: (b, url, amount) =>
    `Here's the payment for your *${b.service}* booking (#${b.id}) 💳\n\n` +
    `Amount: *₹${Number(amount).toLocaleString('en-IN')}*\n\n` +
    `You can pay securely here (UPI / card / wallet):\n${url}\n\n` +
    `Once received, I'll block your date and it's fully yours. Thank you for trusting me with your celebration.\n${SIGN}`,

  paidCustomer: (b) =>
    `Payment received — thank you, ${b.name} 🎉\n\n` +
    `Your *${b.service}* on ${b.event_date} is now *fully confirmed*. Leave the rest to me — I'll be in touch before the day.\n${SIGN}`,

  paidOwner: (b, amount) =>
    `💰 *PAYMENT RECEIVED* #${b.id}\n${b.name} — ₹${Number(amount).toLocaleString('en-IN')}\n${b.service} · ${b.event_date}`,

  /* ---- below-floor approval loop ---- */
  customerChecking: () =>
    `Let me check with my team on that — give me just a moment and I'll get right back to you 🙏\n${SIGN}`,

  customerStillChecking: () =>
    `Still confirming with my team 🙏 I'll message you the moment I hear back — thank you for your patience.\n${SIGN}`,

  ownerApprovalAsk: (a) => {
    const rs = (n) => '₹' + Number(n).toLocaleString('en-IN');
    return (
      `🔒 *DEAL APPROVAL NEEDED* #${a.id}\n\n` +
      `${a.name || 'Customer'} (${a.phone.replace('whatsapp:', '')})\n` +
      `${a.serviceLabel || a.service || '—'}\n` +
      `Wants: *${rs(a.requested)}*\n` +
      `Your floor: ${rs(a.floor)}  (they're ${rs(a.floor - a.requested)} under)\n\n` +
      `Reply *approve ${a.id}* to accept at ${rs(a.requested)}\n` +
      `or *approve ${a.id} <amount>* for a counter-price\n` +
      `or *reject ${a.id}* to decline.`
    );
  },

  customerApproved: (name, amount, serviceLabel, needName) => {
    const hi = name ? `Great news, ${name}!` : `Great news!`;
    const ask = needName ? `May I have your *name* to lock it in?` : `What *date* is your celebration? (e.g. 25 Dec 2026)`;
    return (
      `${hi} 🎉 I spoke with my team and I can do *₹${Number(amount).toLocaleString('en-IN')}* ` +
      `for your *${serviceLabel}*. Let's get you booked!\n\n${ask}\n${SIGN}`
    );
  },

  customerRejected: (name, serviceLabel) =>
    `${name ? name + ', I' : 'I'}'m so sorry 🙏 I checked, but I genuinely can't go that low on the *${serviceLabel}* ` +
    `without cutting the quality I'd want for your day. I'd love to still make it work — I can suggest a ` +
    `smaller package that fits your budget beautifully, or you can reply *hi* to explore options. ` +
    `Either way, I'm here to help.\n${SIGN}`,

  /* ---- staff / vendor dispatch ---- */
  staffJobBrief: (b, staffName) => {
    const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');
    const hi = staffName ? `Hi ${staffName},` : `Hi,`;
    return (
      `${hi} you've got a new job! 🎈\n\n` +
      `📋 Booking #${b.id}\n` +
      `🎉 ${cap(b.service)}\n` +
      `👤 Customer: ${b.name}\n` +
      `📞 ${b.phone.replace('whatsapp:', '')}\n` +
      `📅 ${b.event_date}\n` +
      `📍 ${b.area || 'area TBC'} — ${b.venue || 'venue TBC'}\n` +
      (b.notes && b.notes !== 'no' ? `📌 ${b.notes}\n` : '') +
      `\nReply *accept ${b.id}* to confirm you've got this, or *decline ${b.id}* if you can't make it.`
    );
  },

  staffAcceptedAck: (id) =>
    `Great, thank you! Booking #${id} is yours. I'll ping you again closer to the date. 🎈`,

  staffDeclineAck: (id) =>
    `No problem — I've let the owner know so someone else can take booking #${id}. Thanks for letting me know.`,

  staffDoneWithPhoto: (id) =>
    `Got it — booking #${id} marked completed and your photo has been sent to the customer! 📸 Nice work.`,

  staffDoneNoPhoto: (id) =>
    `Got it — marking booking #${id} as completed. Got a photo of the finished setup? Send it now and I'll share it with the customer! 📸`,

  staffUnknownCommand: () =>
    `Reply *accept <id>*, *decline <id>*, or *done <id>* (with a photo if you have one) for your assigned bookings.`,

  ownerStaffAssigned: (staffName, id) =>
    `👷 Job brief sent to ${staffName} for booking #${id}. Waiting on their confirmation.`,

  ownerStaffAccepted: (staffName, id) =>
    `✅ ${staffName} accepted booking #${id}.`,

  ownerStaffDeclined: (staffName, id) =>
    `⚠️ ${staffName} *declined* booking #${id} — please reassign with *assign ${id} <staff-id>*.`,

  ownerStaffCompleted: (staffName, id, hasPhoto) =>
    `🎉 ${staffName} marked booking #${id} as completed${hasPhoto ? ' (photo forwarded to the customer)' : ''}.`,

  customerDecorationReady: (b) =>
    `Your *${b.service}* setup is ready! 🎈✨ I hope it's everything you imagined — have a wonderful celebration!\n${SIGN}`,

  ownerAutoAssigned: (staffName, id) =>
    `👷 Auto-assigned booking #${id} to ${staffName} (least-loaded staff). Reply *assign ${id} <staff-id>* to override.`,

  paymentReminder: (b) =>
    `Hello ${b.name}, ${OWNER_NAME} here 🎈\n\n` +
    `Just a gentle nudge — here's the payment link for your *${b.service}* booking (#${b.id}):\n${b.payment_link}\n\n` +
    `Once received I'll lock in your date. Let me know if you have any questions.\n${SIGN}`,

  goodwillApology: (name) =>
    `${name ? name + ', I' : 'I'} wanted to personally follow up 🙏 As an apology, I'd like to include a ` +
    `free add-on on your next booking with us — just mention this chat when you book and I'll take care of it.\n${SIGN}`,

  ownerStaffList: (staff) => {
    if (!staff.length) return `No staff added yet. Reply *staff add <phone> <name>* to add one.`;
    const lines = staff.map((s) => `   • #${s.id} ${s.name || '—'} (${s.phone.replace('whatsapp:', '')})`).join('\n');
    return `👷 *Your team*\n${lines}`;
  },
};
