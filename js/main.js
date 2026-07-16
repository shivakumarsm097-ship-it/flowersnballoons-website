/* Flowers 'N' Balloons — main.js */
'use strict';

/* ═══════════════════════════════════════════════════════════════
   GOOGLE ANALYTICS 4 + GOOGLE ADS TRACKING
   ─────────────────────────────────────────────────────────────
   SETUP STEPS (do this before running ads):
   1. Create a Google Analytics 4 property → get your Measurement ID (G-XXXXXXXXXX)
   2. Create a Google Ads account → get your Conversion ID (AW-XXXXXXXXXX)
   3. Replace both placeholders below with your real IDs
   4. In Google Ads, create a "Website" conversion action and copy the
      Conversion Label — paste it in thank-you.html where indicated
═══════════════════════════════════════════════════════════════ */
(function () {
  var GA4_ID  = 'G-XXXXXXXXXX';   // ← Replace with your GA4 Measurement ID
  var GADS_ID = 'AW-XXXXXXXXXX';  // ← Replace with your Google Ads Conversion ID

  // Don't load on localhost (dev environment)
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return;

  // Inject gtag.js script
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA4_ID);   // GA4 pageview
  gtag('config', GADS_ID);  // Google Ads remarketing

  // Track phone call clicks
  document.querySelectorAll('a[href^="tel:"]').forEach(function (a) {
    a.addEventListener('click', function () {
      gtag('event', 'phone_call_click', { event_category: 'lead', event_label: window.location.pathname });
    });
  });

  // Track WhatsApp clicks
  document.querySelectorAll('a[href*="wa.me"]').forEach(function (a) {
    a.addEventListener('click', function () {
      gtag('event', 'whatsapp_click', { event_category: 'lead', event_label: window.location.pathname });
    });
  });
})();

/* === HEADER SCROLL SHADOW === */
(function () {
  const header = document.querySelector('.header');
  if (!header) return;
  const toggle = () => header.classList.toggle('scrolled', window.scrollY > 10);
  toggle();
  window.addEventListener('scroll', toggle, { passive: true });
})();

/* === MOBILE NAV === */
(function () {
  const btn = document.querySelector('.hamburger');
  const nav = document.querySelector('.mobile-nav');
  if (!btn || !nav) return;

  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open);
    document.body.style.overflow = open ? 'hidden' : '';
  });

  nav.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => {
      nav.classList.remove('open');
      btn.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    })
  );

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && nav.classList.contains('open')) {
      nav.classList.remove('open');
      btn.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      btn.focus();
    }
  });
})();

/* === ACTIVE NAV LINK === */
(function () {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a, .mobile-nav a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === path || (path === '' && href === 'index.html') || (path === 'index.html' && href === 'index.html')) {
      a.classList.add('active');
    }
  });
})();

/* === SERVICES TOGGLE === */
(function () {
  const btn = document.querySelector('.js-toggle-services');
  const list = document.querySelector('.services-all-list');
  if (!btn || !list) return;

  btn.addEventListener('click', () => {
    const hidden = list.classList.toggle('hidden');
    btn.textContent = hidden ? '▼ Show All 22 Services' : '▲ Hide Services List';
  });
})();

/* === REVEAL ON SCROLL === */
(function () {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
    return;
  }
  const obs = new IntersectionObserver(
    entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
    }),
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
})();

/* === 3D CARD TILT === */
(function () {
  const MAX_TILT = 14;
  const sel = '.usp-card, .service-card, .testi-card, .stat-card, .val-card, .step';

  function onMove(e) {
    const card = e.currentTarget;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width  - 0.5;
    const y = (e.clientY - r.top)  / r.height - 0.5;
    const ry =  x * MAX_TILT;
    const rx = -y * MAX_TILT;
    card.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(14px)`;
    card.style.boxShadow = `${-ry * 2}px ${rx * 2}px 40px rgba(233,30,140,.2), 0 8px 32px rgba(0,0,0,.1)`;
    const icon = card.querySelector('.usp-icon,.service-card-icon,.stars,.val-icon,.step-num');
    if (icon) icon.style.transform = 'translateZ(30px)';
  }

  function onLeave(e) {
    const card = e.currentTarget;
    card.style.transform = '';
    card.style.boxShadow = '';
    const icon = card.querySelector('.usp-icon,.service-card-icon,.stars,.val-icon,.step-num');
    if (icon) icon.style.transform = '';
  }

  document.querySelectorAll(sel).forEach(card => {
    card.addEventListener('mousemove', onMove);
    card.addEventListener('mouseleave', onLeave);
  });
})();

/* === HERO 3D FLOATING ELEMENTS === */
(function () {
  const hero = document.querySelector('.hero');
  if (!hero) return;

  const items = [
    { e: '🎈', s: '2.4rem', t: '12%', l: '7%',   d: '0s',    dr: '6s'   },
    { e: '🌸', s: '2rem',   t: '65%', l: '5%',   d: '1.2s',  dr: '7.5s' },
    { e: '🎊', s: '2.2rem', t: '20%', r: '7%',   d: '0.6s',  dr: '5.5s' },
    { e: '💐', s: '1.8rem', t: '72%', r: '6%',   d: '1.8s',  dr: '8s'   },
    { e: '🎉', s: '2rem',   t: '40%', l: '3%',   d: '2.4s',  dr: '6.5s' },
    { e: '🌺', s: '1.6rem', t: '8%',  r: '16%',  d: '3s',    dr: '7s'   },
  ];

  items.forEach((item, i) => {
    const outer = document.createElement('span');
    outer.className = 'hero-float';
    outer.style.cssText = `top:${item.t};${item.l?'left:'+item.l:'right:'+item.r};font-size:${item.s};`;

    const inner = document.createElement('span');
    inner.className = 'hero-float-inner';
    inner.textContent = item.e;
    inner.style.cssText = `animation-delay:${item.d};animation-duration:${item.dr};`;

    outer.appendChild(inner);
    hero.appendChild(outer);
  });

  // Mouse parallax: each float moves at a different depth
  hero.addEventListener('mousemove', e => {
    const r = hero.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width  - 0.5;
    const my = (e.clientY - r.top)  / r.height - 0.5;
    hero.querySelectorAll('.hero-float').forEach((el, i) => {
      const depth = (i % 3 + 1) * 14;
      el.style.transform = `translate(${mx * depth}px, ${my * depth}px)`;
    });
  });

  hero.addEventListener('mouseleave', () => {
    hero.querySelectorAll('.hero-float').forEach(el => { el.style.transform = ''; });
  });
})();

/* === FORM VALIDATION & SUBMIT === */
(function () {
  /* Backend lead capture — every submission also lands in the agent
     backend's database (flowersnballoons-agents on Railway), which runs
     lead follow-up automatically. Web3Forms below stays as the email
     fallback so no lead is ever lost even if the backend is down.
     Set to '<railway-domain>/webhooks/web-form' after deploy. */
  var BACKEND_FORM_URL = '';

  function postToBackend(form) {
    if (!BACKEND_FORM_URL) return;
    var f = new FormData(form);
    try {
      fetch(BACKEND_FORM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: f.get('name') || '',
          phone: f.get('phone') || f.get('mobile') || '',
          email: f.get('email') || '',
          service: f.get('service') || '',
          message: f.get('message') || '',
          source: location.pathname.split('/').pop() || 'homepage',
        }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }

  document.querySelectorAll('.js-quote-form').forEach(form => {
    const successMsg = form.querySelector('.form-success-msg');

    form.addEventListener('submit', e => {
      e.preventDefault();
      let valid = true;

      form.querySelectorAll('[data-required]').forEach(field => {
        const err = form.querySelector('[data-err="' + field.name + '"]');
        const val = field.value.trim();
        let msg = '';

        if (!val) {
          msg = 'This field is required.';
        } else if (field.dataset.pattern) {
          if (!new RegExp(field.dataset.pattern).test(val)) {
            msg = field.dataset.patternMsg || 'Invalid format.';
          }
        }

        if (err) { err.textContent = msg; err.classList.toggle('show', !!msg); }
        field.classList.toggle('is-error', !!msg);
        if (msg) valid = false;
      });

      if (!valid) return;

      const submitBtn = form.querySelector('[type="submit"]');
      const origLabel = submitBtn.dataset.label || submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';

      const data = new FormData(form);
      fetch('https://api.web3forms.com/submit', { method: 'POST', body: data })
        .then(res => res.json())
        .then(json => {
          // Fire GA4 lead event before redirect
          if (typeof gtag === 'function') {
            gtag('event', 'form_submit', { event_category: 'lead', event_label: window.location.pathname });
          }
          // Also store the lead in the agent backend (fire-and-forget)
          postToBackend(form);
          // Redirect to thank-you page (Google Ads conversion fires there)
          window.location.href = 'thank-you.html';
        })
        .catch(() => {
          submitBtn.disabled = false;
          submitBtn.textContent = origLabel;
          alert('Something went wrong. Please call us at +91 8867121207.');
        });
    });

    /* Clear error on input */
    form.querySelectorAll('[data-required]').forEach(field => {
      field.addEventListener('input', () => {
        field.classList.remove('is-error');
        const err = form.querySelector('[data-err="' + field.name + '"]');
        if (err) { err.textContent = ''; err.classList.remove('show'); }
      });
    });
  });
})();
