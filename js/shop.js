/* Shop cart — localStorage only, no server state.
   Deliberately NOT a payment step: "checkout" hands off to the date-availability
   check first, because a decoration slot can be sold out even when a "product"
   is in stock. Taking money before that check is the one failure this whole
   system exists to prevent. */
(function () {
  'use strict';

  var KEY = 'fnb_cart_v1';

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { return []; }
  }
  function write(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {}
    render();
  }
  var inr = function (n) { return '₹' + Number(n).toLocaleString('en-IN'); };

  function toast(msg) {
    var t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    requestAnimationFrame(function () { t.classList.add('show'); });
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function render() {
    var items = read();
    var total = items.reduce(function (s, i) { return s + i.price * (i.qty || 1); }, 0);

    document.querySelectorAll('.cart-count').forEach(function (el) {
      el.textContent = items.reduce(function (s, i) { return s + (i.qty || 1); }, 0);
    });

    var wrap = document.querySelector('.cart-items');
    if (wrap) {
      wrap.innerHTML = items.length
        ? items.map(function (i, idx) {
            return '<div class="cart-item">' +
              '<div class="cart-item-info"><b>' + i.name + '</b>' +
              '<span>' + i.sku + (i.qty > 1 ? ' · x' + i.qty : '') + '</span>' +
              '<button class="cart-item-rm" data-i="' + idx + '">Remove</button></div>' +
              '<div class="cart-item-price">' + inr(i.price * (i.qty || 1)) + '</div></div>';
          }).join('')
        : '<p class="cart-empty">Nothing added yet.<br>Browse the catalogue and add a setup.</p>';
    }
    var amt = document.querySelector('.cart-total-amt');
    if (amt) amt.textContent = inr(total);

    var co = document.querySelector('.js-checkout');
    if (co) {
      co.classList.toggle('is-disabled', !items.length);
      co.setAttribute('aria-disabled', items.length ? 'false' : 'true');
      co.style.opacity = items.length ? '' : '.5';
      co.style.pointerEvents = items.length ? '' : 'none';
    }
  }

  function openCart(open) {
    var d = document.getElementById('cart');
    if (!d) return;
    d.classList.toggle('open', open);
    d.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.style.overflow = open ? 'hidden' : '';
  }

  document.addEventListener('click', function (e) {
    var add = e.target.closest('.js-add');
    if (add) {
      e.preventDefault();
      var items = read();
      var sku = add.dataset.sku;
      var found = items.filter(function (i) { return i.sku === sku; })[0];
      if (found) { found.qty = (found.qty || 1) + 1; }
      else {
        items.push({ sku: sku, name: add.dataset.name, price: Number(add.dataset.price), url: add.dataset.url, qty: 1 });
      }
      write(items);
      toast('Added — ' + add.dataset.name);
      return;
    }

    if (e.target.closest('.js-cart-open')) { e.preventDefault(); openCart(true); return; }
    if (e.target.closest('.cart-close')) { openCart(false); return; }
    if (e.target.classList && e.target.classList.contains('cart-drawer')) { openCart(false); return; }

    var rm = e.target.closest('.cart-item-rm');
    if (rm) {
      var list = read();
      list.splice(Number(rm.dataset.i), 1);
      write(list);
      return;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') openCart(false);
  });

  /* checkout page: render summary + submit to the availability check */
  var coForm = document.querySelector('.js-checkout-form');
  if (coForm) {
    var sum = document.querySelector('.checkout-summary');
    var items = read();
    var total = items.reduce(function (s, i) { return s + i.price * (i.qty || 1); }, 0);

    if (!items.length) {
      sum.innerHTML = '<p class="cart-empty">Your cart is empty. <a href="index.html">Browse the catalogue</a>.</p>';
      coForm.style.display = 'none';
    } else {
      sum.innerHTML = items.map(function (i) {
        return '<div class="cart-item"><div class="cart-item-info"><b>' + i.name + '</b>' +
          '<span>' + i.sku + (i.qty > 1 ? ' · x' + i.qty : '') + '</span></div>' +
          '<div class="cart-item-price">' + inr(i.price * (i.qty || 1)) + '</div></div>';
      }).join('') +
      '<div class="cart-total" style="margin-top:14px"><span>Estimated total</span><b>' + inr(total) + '</b></div>' +
      '<p class="cart-note">Final quote confirmed in writing. Travel beyond 12&nbsp;km may be extra.</p>';
    }

    coForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true;
      coForm.querySelectorAll('[data-required]').forEach(function (f) {
        var err = coForm.querySelector('span.field-err[data-err="' + f.name + '"]');
        var v = f.value.trim();
        var msg = '';
        if (!v) msg = 'This field is required.';
        else if (f.dataset.pattern && !new RegExp(f.dataset.pattern).test(v)) msg = f.dataset.patternMsg || 'Invalid format.';
        if (err) { err.textContent = msg; err.classList.toggle('show', !!msg); }
        f.classList.toggle('is-error', !!msg);
        if (msg) ok = false;
      });
      if (!ok) return;

      var btn = coForm.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Checking…';

      var fd = new FormData(coForm);
      var lines = read().map(function (i) {
        return i.name + ' (' + i.sku + ')' + (i.qty > 1 ? ' x' + i.qty : '') + ' — ' + inr(i.price * (i.qty || 1));
      }).join('\n');
      var grand = read().reduce(function (s, i) { return s + i.price * (i.qty || 1); }, 0);

      // Backend does the real capacity check. Until it's deployed, hand off to
      // WhatsApp rather than silently implying the date is confirmed.
      var msg = 'Hi! I would like to book:\n' + lines + '\n\nTotal: ' + inr(grand) +
        '\nName: ' + fd.get('name') +
        '\nDate: ' + fd.get('event_date') +
        '\nArea: ' + (fd.get('area') || '—') +
        (fd.get('message') ? '\nNotes: ' + fd.get('message') : '');

      window.location.href = 'https://wa.me/918867121207?text=' + encodeURIComponent(msg);
    });
  }

  /* category filters: tier chips + theme search */
  (function () {
    var grid = document.querySelector('.js-grid');
    if (!grid) return;
    var chips = [].slice.call(document.querySelectorAll('.chip'));
    var search = document.querySelector('.js-search');
    var count = document.querySelector('.js-count');
    var none = document.querySelector('.no-hits');
    var cards = [].slice.call(grid.children);
    var tier = '';

    function apply() {
      var q = (search && search.value || '').trim().toLowerCase();
      var shown = 0;
      cards.forEach(function (c) {
        var ok = (!tier || c.dataset.tier === tier) && (!q || c.dataset.theme.indexOf(q) > -1);
        c.hidden = !ok;
        if (ok) shown++;
      });
      if (none) none.hidden = shown !== 0;
      if (count) {
        var prices = cards.filter(function (c) { return !c.hidden; }).map(function (c) { return +c.dataset.price; });
        count.textContent = shown
          ? shown + ' setup' + (shown === 1 ? '' : 's') + ' · from ' + inr(Math.min.apply(null, prices))
          : 'No setups match';
      }
    }

    chips.forEach(function (ch) {
      ch.addEventListener('click', function () {
        chips.forEach(function (x) { x.classList.remove('is-on'); });
        ch.classList.add('is-on');
        tier = ch.dataset.tier;
        apply();
      });
    });
    if (search) search.addEventListener('input', apply);
    var clear = document.querySelector('.js-clear');
    if (clear) clear.addEventListener('click', function () {
      tier = ''; if (search) search.value = '';
      chips.forEach(function (x) { x.classList.toggle('is-on', !x.dataset.tier); });
      apply();
    });
  })();

  /* category sort */
  var sort = document.querySelector('.js-sort');
  if (sort) {
    sort.addEventListener('change', function () {
      var grid = document.querySelector('.js-grid');
      var cards = [].slice.call(grid.children);
      var val = sort.value;
      cards.sort(function (a, b) {
        var pa = parseInt(a.querySelector('.prod-price b').textContent.replace(/\D/g, ''), 10);
        var pb = parseInt(b.querySelector('.prod-price b').textContent.replace(/\D/g, ''), 10);
        if (val === 'low') return pa - pb;
        if (val === 'high') return pb - pa;
        return a.querySelector('h3').textContent.localeCompare(b.querySelector('h3').textContent);
      });
      cards.forEach(function (c) { grid.appendChild(c); });
    });
  }

  render();
})();
