/* Flowers 'N' Balloons — site behaviour. No dependencies. */
(function () {
  'use strict';

  /* sticky header shadow */
  var header = document.querySelector('.header');
  if (header) {
    var stick = function () { header.classList.toggle('stuck', window.scrollY > 8); };
    stick();
    addEventListener('scroll', stick, { passive: true });
  }

  /* mobile nav */
  var burger = document.querySelector('.burger');
  var mnav = document.querySelector('.mnav');
  if (burger && mnav) {
    burger.addEventListener('click', function () {
      var open = mnav.classList.toggle('on');
      burger.classList.toggle('on', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    mnav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        mnav.classList.remove('on');
        burger.classList.remove('on');
        burger.setAttribute('aria-expanded', 'false');
      });
    });
    addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mnav.classList.contains('on')) burger.click();
    });
  }

  /* reveal on scroll — degrades to visible if unsupported */
  var revs = document.querySelectorAll('.rev');
  if (!('IntersectionObserver' in window)) {
    revs.forEach(function (el) { el.classList.add('in'); });
  } else {
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -40px 0px', threshold: 0.06 });
    revs.forEach(function (el) { obs.observe(el); });
  }

  /* enquiry form */
  document.querySelectorAll('.js-form').forEach(function (form) {
    var okMsg = form.querySelector('.ok-msg');

    function validate() {
      var ok = true;
      form.querySelectorAll('[data-req]').forEach(function (f) {
        // the error span carries data-for, the field does not — so this can
        // never accidentally resolve to the input itself
        var err = form.querySelector('.err[data-for="' + f.name + '"]');
        var v = (f.value || '').trim();
        var msg = '';
        if (!v) msg = 'This field is required.';
        else if (f.dataset.pat && !new RegExp(f.dataset.pat).test(v)) msg = f.dataset.patMsg || 'Invalid format.';
        if (err) { err.textContent = msg; err.classList.toggle('on', !!msg); }
        f.classList.toggle('bad', !!msg);
        if (msg) ok = false;
      });
      return ok;
    }

    form.querySelectorAll('[data-req]').forEach(function (f) {
      f.addEventListener('input', function () {
        if (!f.classList.contains('bad')) return;
        var err = form.querySelector('.err[data-for="' + f.name + '"]');
        if (f.value.trim()) { f.classList.remove('bad'); if (err) err.classList.remove('on'); }
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!validate()) {
        var bad = form.querySelector('.bad');
        if (bad) bad.focus();
        return;
      }

      var d = new FormData(form);
      var lines = [
        'New enquiry',
        'Name: ' + d.get('name'),
        'Mobile: ' + d.get('phone'),
        'Occasion: ' + d.get('occasion'),
        d.get('event_date') ? 'Date: ' + d.get('event_date') : '',
        d.get('area') ? 'Area: ' + d.get('area') : '',
        d.get('message') ? 'Notes: ' + d.get('message') : ''
      ].filter(Boolean).join('\n');

      // Goes to WhatsApp so nothing is lost while no backend is connected.
      window.open('https://wa.me/918867121207?text=' + encodeURIComponent(lines), '_blank', 'noopener');

      if (okMsg) {
        okMsg.textContent = 'Thanks! WhatsApp should have opened with your details — hit send and we’ll reply shortly.';
        okMsg.hidden = false;
      }
      form.reset();
    });
  });
})();
