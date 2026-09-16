/* ═══════════════════════════════════════════════════════════════
   CineVault — shared helpers and chrome behaviour.
   Loaded on every page, after layout.js has injected the nav.
   Every block is guarded, so a page missing an element is fine.
   ═══════════════════════════════════════════════════════════════ */
window.CV = (function () {
  'use strict';

  var API = window.CV_API;

  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;


  /* ── formatting ──────────────────────────────────────────── */

  /* Showtime.price is a DecimalField(decimal_places=0) so it arrives as
     a string like "45". Everything downstream wants a number. */
  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  function money(n) { return '$' + num(n).toFixed(2); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* local calendar date, not UTC — `new Date().toISOString()` would roll
     over at the wrong moment for anyone west of Greenwich */
  function iso(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /* 'YYYY-MM-DDTHH:MM:SSZ' → 'YYYY-MM-DD' in the viewer's timezone */
  function dateKey(isoDateTime) {
    var d = new Date(isoDateTime);
    return isNaN(d) ? '' : iso(d);
  }

  /* '...T18:30:00Z' → '18:30' in the viewer's timezone */
  function clock(isoDateTime) {
    var d = new Date(isoDateTime);
    if (isNaN(d)) return '--:--';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYNAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function asDate(v) {
    if (!v) return null;
    /* a bare 'YYYY-MM-DD' is parsed as UTC midnight by spec, which
       displays as the previous day in western timezones — pin it to
       local midnight instead */
    var d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00') : new Date(v);
    return isNaN(d) ? null : d;
  }

  function shortDate(v) {
    var d = asDate(v);
    return d ? MONTHS[d.getMonth()] + ' ' + String(d.getDate()).padStart(2, '0') : '—';
  }

  function longDate(v) {
    var d = asDate(v);
    return d ? DAYNAMES[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() : '—';
  }

  /* 166 → '2h 46m' */
  function runtime(minutes) {
    var m = parseInt(minutes, 10);
    if (!m) return '—';
    return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  }

  /* [{id, name}, …] → 'Sci-Fi · Adventure' */
  function genreText(genres) {
    if (!genres || !genres.length) return 'Uncategorised';
    return genres.map(function (g) { return typeof g === 'string' ? g : g.name; }).join(' · ');
  }

  function param(name, fallback) {
    var v = new URLSearchParams(location.search).get(name);
    return v === null || v === '' ? fallback : v;
  }


  /* ── posters ─────────────────────────────────────────────── */

  /* Movie.poster is optional and, in this project, MEDIA files are not
     served in DEBUG (root/urls.py has no static() line), so most films
     have no image to show. Rather than a grey box, each film gets a
     colour scheme derived from its own title — stable across reloads
     and distinct between neighbouring cards. */
  function hues(movie) {
    var seed = String(movie.id) + '|' + String(movie.title || '');
    var h = 2166136261;
    for (var i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    var hue = h % 360;
    return [
      'hsl(' + hue + ' 42% 34%)',   // --p1 body
      'hsl(' + hue + ' 45% 6%)',    // --p2 shadow
      'hsl(' + hue + ' 55% 62%)'    // --p3 highlight
    ];
  }

  function poster(movie, tall) {
    var p = hues(movie);
    var img = API.mediaUrl(movie.poster);

    var inner = img
      ? '<img src="' + esc(img) + '" alt="" loading="lazy" class="poster__img">'
      : '<span class="poster__t">' + esc(movie.title).replace(/[:–-]\s*/g, '<br>') + '</span>';

    /* Movie.rating is nullable — no badge rather than a fake score */
    var badge = movie.rating != null
      ? '<span class="badge badge--rate"><svg><use href="#i-star"/></svg>' + num(movie.rating).toFixed(1) + '</span>'
      : '';

    var cert = movie.age_rating
      ? '<span class="badge badge--fmt">' + esc(movie.age_rating) + '</span>' : '';

    return '<div class="poster' + (tall ? ' poster--tall' : '') +
             '" style="--p1:' + p[0] + ';--p2:' + p[1] + ';--p3:' + p[2] + '">' +
             inner + badge + cert +
           '</div>';
  }


  /* ── the booking draft (seats → checkout → confirmation) ──── */
  var BKEY = 'cv.booking';

  function saveBooking(b) {
    try { sessionStorage.setItem(BKEY, JSON.stringify(b)); } catch (e) {}
  }
  function loadBooking() {
    try { return JSON.parse(sessionStorage.getItem(BKEY) || 'null'); } catch (e) { return null; }
  }
  function clearBooking() {
    try { sessionStorage.removeItem(BKEY); } catch (e) {}
  }


  /* ── the order rail, shared by the seats and checkout pages ── */
  /* There is no booking fee and no promo engine: Reservation.total_price
     is showtime.price × seats, so anything added here would put the
     screen out of step with what the backend actually charges. */
  function paintRail(b) {
    var set = function (id, txt) { var el = $(id); if (el) el.textContent = txt; };

    set('#rVenue', b.hall || '—');
    set('#rDate', longDate(b.date));
    set('#rTime', b.time);

    var seatsEl = $('#rSeats');
    if (seatsEl) {
      seatsEl.innerHTML = b.seats.length
        ? b.seats.map(function (s) { return '<span class="tagseat">' + esc(s.label) + '</span>'; }).join('')
        : '<span class="rail__none">None selected</span>';
    }

    var total = b.seats.length * num(b.price);

    set('#rTicketsLab', b.seats.length ? 'Tickets × ' + b.seats.length : 'Tickets');
    set('#rSub', money(total));
    set('#rTotal', money(total));

    var subEl = $('#railSub');
    if (subEl) subEl.textContent = b.title || '';

    return total;
  }


  /* ── scroll reveal ───────────────────────────────────────── */
  var io = null;

  /* Call again after injecting markup — the page scripts render their
     cards long after this file runs, and .reveal starts at opacity:0. */
  function reveal(root) {
    var items = $$('.reveal:not(.is-in)', root || document);

    if (!io) {
      items.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    items.forEach(function (el, i) {
      el.style.transitionDelay = (i % 4) * 70 + 'ms';
      io.observe(el);
    });
  }

  if ('IntersectionObserver' in window && !reduced) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-in');
        io.unobserve(en.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  }


  /* ── status messages ─────────────────────────────────────── */
  /* Errors reach the user in the page, never in a console they will
     not open. `err` may be an ApiError or any thrown value. */
  function showError(el, err) {
    if (!el) return;
    el.textContent = err && err.message ? err.message : String(err);
    el.hidden = false;
    el.classList.remove('is-ok');
  }
  function showOk(el, text) {
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.add('is-ok');
  }
  function hideMsg(el) { if (el) el.hidden = true; }

  /* A full-panel spinner/message for regions that load from the API. */
  function loading(el, text) {
    if (el) el.innerHTML = '<p class="loading">' + esc(text || 'Loading…') + '</p>';
  }
  function failed(el, err, retryLabel) {
    if (!el) return;
    el.innerHTML =
      '<div class="empty is-on"><svg><use href="#i-film"/></svg>' +
      '<p>' + esc(err && err.message ? err.message : 'Something went wrong.') +
      (retryLabel ? ' <button class="linkish" type="button" data-retry>' + esc(retryLabel) + '</button>' : '') +
      '</p></div>';
  }


  var CV = {
    $: $, $$: $$, esc: esc, num: num, money: money, iso: iso, param: param, reduced: reduced,
    dateKey: dateKey, clock: clock, shortDate: shortDate, longDate: longDate,
    runtime: runtime, genreText: genreText,
    poster: poster, hues: hues,
    reveal: reveal,
    saveBooking: saveBooking, loadBooking: loadBooking, clearBooking: clearBooking,
    paintRail: paintRail,
    showError: showError, showOk: showOk, hideMsg: hideMsg,
    loading: loading, failed: failed
  };


  /* ══ chrome behaviour ═══════════════════════════════════════ */
  /* layout.js has already injected the nav by the time this runs. */

  /* nav: solidify on scroll + back-to-top */
  var nav = $('#nav');
  var toTop = $('#toTop');

  if (nav || toTop) {
    var onScroll = function () {
      var y = window.scrollY;
      if (nav) nav.classList.toggle('is-stuck', y > 20);
      if (toTop) toTop.classList.toggle('is-on', y > 600);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* mobile drawer */
  var drawer = $('#drawer');

  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  if (drawer) {
    var burger = $('#burger');
    var dClose = $('#drawerClose');

    if (burger) burger.addEventListener('click', function () {
      drawer.classList.add('is-open');
      drawer.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    });
    if (dClose) dClose.addEventListener('click', closeDrawer);

    drawer.addEventListener('click', function (e) {
      if (e.target === drawer) closeDrawer();
    });
    $$('#drawer a').forEach(function (a) { a.addEventListener('click', closeDrawer); });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
  });

  /* nav search → the listing page */
  var q = $('#q');
  if (q) {
    q.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      /* the listing filters live, so stay put there */
      if ($('#grid')) return;
      location.href = 'movies.html?q=' + encodeURIComponent(q.value.trim());
    });
  }

  return CV;
})();


/* ═══════════════════════════════════════════════════════════════
   Spotlight borders — feeds --mx/--my to the ::before ring on cards
   so the edge lights under the cursor. Delegated from document, so
   it covers cards injected later. Skipped for coarse pointers and
   reduced motion: there is no hover on touch.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  if (!window.matchMedia) return;
  if (!matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;

  var SEL = '.mcard,.scard,.venue-card';
  var frame = null, pending = null;

  document.addEventListener('pointermove', function (e) {
    var card = e.target.closest && e.target.closest(SEL);
    if (!card) return;
    pending = { card: card, x: e.clientX, y: e.clientY };
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = null;
      var p = pending, r = p.card.getBoundingClientRect();
      p.card.style.setProperty('--mx', (p.x - r.left) + 'px');
      p.card.style.setProperty('--my', (p.y - r.top) + 'px');
    });
  }, { passive: true });
})();
