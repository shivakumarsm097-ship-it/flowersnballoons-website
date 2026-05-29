/* Flowers 'N' Balloons — main.js */
'use strict';

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

/* === FORM VALIDATION & SUBMIT === */
(function () {
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
          form.reset();
          submitBtn.disabled = false;
          submitBtn.textContent = origLabel;
          if (successMsg) {
            successMsg.classList.add('show');
            successMsg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
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
