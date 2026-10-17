/* Flowers 'N' Balloons — 3D theme enhancements
   Hero floating decorations + mouse parallax + count-up stats.
   Card tilt + scroll reveal already live in main.min.js. */
'use strict';



/* ---- Count-up for stat numbers when they scroll into view ---- */
(function () {
  const nums = document.querySelectorAll('.stat-num, .stats-grid strong');
  if (!nums.length || !('IntersectionObserver' in window)) return;

  const animate = (el) => {
    const raw = el.textContent.trim();
    const m = raw.match(/([\d,]+)/);
    if (!m) return;
    const target = parseInt(m[1].replace(/,/g, ''), 10);
    if (!target) return;
    const prefix = raw.slice(0, m.index);
    const suffix = raw.slice(m.index + m[1].length);
    const dur = 1400; const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min((now - t0) / dur, 1);
      const val = Math.floor((1 - Math.pow(1 - p, 3)) * target);
      el.textContent = prefix + val.toLocaleString('en-IN') + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const obs = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { animate(en.target); obs.unobserve(en.target); }
    });
  }, { threshold: 0.4 });
  nums.forEach((n) => obs.observe(n));
})();
