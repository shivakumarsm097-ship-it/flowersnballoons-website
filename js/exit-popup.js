(function () {
  'use strict';

  var PHONE = '918867121207';
  var WA_BASE = 'https://wa.me/' + PHONE + '?text=';
  var WA_Q = encodeURIComponent('Hi! I was on your website and have a quick question about decoration pricing.');

  var isMobile = /Mobi|Android/i.test(navigator.userAgent);
  var minTime  = isMobile ? 20 : 15;
  var elapsed  = 0;
  var shown    = false;
  var ticker   = setInterval(function () { if (++elapsed >= minTime) clearInterval(ticker); }, 1000);

  /* ---- guards ---- */
  function canShow() {
    if (localStorage.getItem('fnb_enquiry_sent'))  return false;
    if (sessionStorage.getItem('fnb_popup_shown')) return false;
    if (document.referrer.indexOf('wa.me') !== -1) return false;
    return true;
  }

  /* ---- build DOM ---- */
  function build() {
    var el = document.createElement('div');
    el.id = 'fnbEpOv';
    el.setAttribute('role', 'presentation');
    el.innerHTML =
      '<div id="fnbEpCard" role="dialog" aria-modal="true" aria-labelledby="fnbEpH">' +
        '<button id="fnbEpX" aria-label="Close">×</button>' +
        '<h2 id="fnbEpH">Before you go—<br><span id="fnbEpSub">got a quick question?</span></h2>' +
        '<p id="fnbEpBody">Most people leave because they’re unsure about budget.<br>We can give you a ballpark in 2 minutes on WhatsApp.</p>' +
        '<a id="fnbEpWa" href="' + WA_BASE + WA_Q + '" target="_blank" rel="noopener">💬 Ask us on WhatsApp</a>' +
        '<div id="fnbEpCallWrap">' +
          '<p id="fnbEpOr">or leave your number:</p>' +
          '<div id="fnbEpRow">' +
            '<input id="fnbEpPhone" type="tel" placeholder="+91 XXXXX XXXXX" autocomplete="tel">' +
            '<button id="fnbEpCallBtn">Call me →</button>' +
          '</div>' +
          '<p id="fnbEpDone" style="display:none;font-size:14px;color:#25d366;margin-top:8px;">Done! We’ll call you shortly 🌸</p>' +
        '</div>' +
        '<button id="fnbEpDismiss">No thanks, I’ll figure it out myself →</button>' +
      '</div>';
    return el;
  }

  /* ---- close with animation ---- */
  function close(el) {
    var card = el.querySelector('#fnbEpCard');
    card.style.animation = 'fnbEpOut .2s ease-in forwards';
    el.style.animation   = 'fnbEpFadeOut .2s ease-in forwards';
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }

  /* ---- show ---- */
  function show() {
    if (shown || !canShow()) return;
    shown = true;
    sessionStorage.setItem('fnb_popup_shown', '1');

    var ov = build();
    document.body.appendChild(ov);

    function dismiss() { close(ov); }

    ov.addEventListener('click', function (e) { if (e.target === ov) dismiss(); });
    ov.querySelector('#fnbEpX').addEventListener('click', dismiss);
    ov.querySelector('#fnbEpDismiss').addEventListener('click', dismiss);
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { dismiss(); document.removeEventListener('keydown', onKey); }
    });

    ov.querySelector('#fnbEpWa').addEventListener('click', function () {
      localStorage.setItem('fnb_enquiry_sent', '1');
    });

    ov.querySelector('#fnbEpCallBtn').addEventListener('click', function () {
      var ph = ov.querySelector('#fnbEpPhone').value.trim();
      if (!ph) { ov.querySelector('#fnbEpPhone').focus(); return; }
      var msg = encodeURIComponent('Hi! Please call me. My number is ' + ph + '. I want to enquire about decoration.');
      window.open(WA_BASE + msg, '_blank');
      localStorage.setItem('fnb_enquiry_sent', '1');
      ov.querySelector('#fnbEpRow').style.display = 'none';
      ov.querySelector('#fnbEpOr').style.display  = 'none';
      ov.querySelector('#fnbEpDone').style.display = 'block';
    });
  }

  /* ---- triggers ---- */
  function init() {
    if (!canShow()) return;

    if (!isMobile) {
      /* Desktop: mouseleave fires reliably when cursor exits the viewport
         toward the browser chrome — far more reliable than mousemove y<20
         which misses fast movements. Only fires when leaving through the top
         (clientY <= 0). */
      document.addEventListener('mouseleave', function onLeave(e) {
        if (e.clientY > 0) return;          // ignore left/right/bottom exits
        if (elapsed < minTime) return;      // page too fresh
        document.removeEventListener('mouseleave', onLeave);
        show();
      });
    } else {
      /* Mobile: Android back button via popstate.
         Push a fake history entry so back fires popstate instead of navigating.
         After showing popup, push again so the NEXT back press navigates
         normally rather than re-triggering. */
      history.pushState(null, '', location.href);
      window.addEventListener('popstate', function onPop() {
        window.removeEventListener('popstate', onPop);
        if (elapsed < minTime) return;
        history.pushState(null, '', location.href); // re-arm so back still works
        show();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
