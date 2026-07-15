/* Flowers 'N' Balloons — 3D theme enhancements
   Hero floating decorations + mouse parallax + count-up stats.
   Card tilt + scroll reveal already live in main.min.js. */
'use strict';

/* ---- Hero floating 3D decorations ---- */
(function () {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const items = [
    { e: '🎈', s: '2.6rem', t: '14%', l: '6%',  d: '0s',   dr: '6s'   },
    { e: '🌷', s: '2rem',   t: '68%', l: '4%',  d: '1.2s', dr: '7.5s' },
    { e: '🎀', s: '2rem',   t: '20%', r: '7%',  d: '0.6s', dr: '5.5s' },
    { e: '💐', s: '1.9rem', t: '72%', r: '6%',  d: '1.8s', dr: '8s'   },
    { e: '🌿', s: '1.7rem', t: '40%', l: '3%',  d: '2.4s', dr: '6.5s' },
    { e: '🌸', s: '1.7rem', t: '9%',  r: '17%', d: '3s',   dr: '7s'   },
  ];

  items.forEach((it) => {
    const outer = document.createElement('span');
    outer.className = 'hero-float';
    outer.style.cssText = `top:${it.t};${it.l ? 'left:' + it.l : 'right:' + it.r};font-size:${it.s};`;
    const inner = document.createElement('span');
    inner.className = 'hero-float-inner';
    inner.textContent = it.e;
    inner.style.cssText = `animation-delay:${it.d};animation-duration:${it.dr};`;
    outer.appendChild(inner);
    hero.appendChild(outer);
  });

  // mouse parallax — each float drifts at a different depth
  hero.addEventListener('mousemove', (e) => {
    const r = hero.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width - 0.5;
    const my = (e.clientY - r.top) / r.height - 0.5;
    hero.querySelectorAll('.hero-float').forEach((el, i) => {
      const depth = (i % 3 + 1) * 16;
      el.style.transform = `translate(${mx * depth}px, ${my * depth}px)`;
    });
  }, { passive: true });
  hero.addEventListener('mouseleave', () => {
    hero.querySelectorAll('.hero-float').forEach((el) => { el.style.transform = ''; });
  });
})();

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
