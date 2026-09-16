/* ═══════════════════════════════════════════════════════════════
   CineVault — inner pages: movies listing, movie detail, cinemas,
   sign-in, checkout and confirmation.
   Every section is guarded by the element it renders into, so the
   file is safe to load on any page.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var $ = CV.$, $$ = CV.$$, esc = CV.esc, money = CV.money, url = CV.url;

  /* how many days of showtimes the date strips offer */
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var SPAN = 7;


  /* ══ shared card markup ═════════════════════════════════════ */

  /* CV.poster() has no hover overlay of its own — add one that links out */
  function posterWithBook(f) {
    return CV.poster(f, false).replace(/<\/div>$/,
      '<div class="poster__over"><a class="btn btn--accent btn--sm" href="' + url('movie') + '?id=' + f.id +
      '"><svg><use href="#i-ticket"/></svg>Book</a></div></div>');
  }

  function timeChips(f) {
    var shown = f.times.slice(0, 4);

    var html = shown.map(function (x) {
      return '<button class="time' + (x.full ? ' is-full' : '') + '"' +
             (x.full ? ' disabled' : '') + '>' + esc(x.t) + '</button>';
    }).join('');

    if (f.times.length > shown.length) {
      html += '<a class="time time--more" href="' + url('movie') + '?id=' + f.id + '">+' +
              (f.times.length - shown.length) + '</a>';
    }
    return html;
  }

  function movieCard(f) {
    return '<article class="mcard reveal" data-film="' + esc(f.title) + '" data-fmt="' + f.formats.join(' ') + '">' +
      posterWithBook(f) +
      '<div class="mcard__b">' +
        '<h3><a href="' + url('movie') + '?id=' + f.id + '">' + esc(f.title) + '</a></h3>' +
        '<p class="mcard__m">' + esc(f.genres) + ' <i></i> ' + esc(f.runtime) + ' <i></i> ' + esc(f.cert) + '</p>' +
        '<p class="mcard__lab"><svg><use href="#i-clock"/></svg>Today’s showtimes</p>' +
        '<div class="times">' + timeChips(f) + '</div>' +
        '<p class="mcard__at">at <b>' + f.cinemas + ' cinemas</b> · from ' + money(f.price) + '</p>' +
      '</div>' +
    '</article>';
  }

  function soonCard(f) {
    var act = f.prebook
      ? '<a class="btn btn--accent btn--sm btn--full" href="' + url('movie') + '?id=' + f.id +
        '"><svg><use href="#i-ticket"/></svg>Pre-book</a>' +
        '<button class="icon-btn icon-btn--out" type="button" aria-label="Notify me"><svg><use href="#i-bell"/></svg></button>'
      : '<button class="btn btn--ghost btn--sm btn--full" type="button"><svg><use href="#i-bell"/></svg>Notify me</button>';

    return '<article class="scard reveal">' +
      CV.poster(f, true) +
      '<div class="scard__b">' +
        '<h3><a href="' + url('movie') + '?id=' + f.id + '">' + esc(f.title) + '</a></h3>' +
        '<p class="mcard__m">' + esc(f.genres) + ' <i></i> ' + esc(f.runtime) + '</p>' +
        '<div class="scard__act">' + act + '</div>' +
      '</div>' +
    '</article>';
  }


  /* ══ a 7-day date strip, shared by the listing and detail ═══ */
  function buildDates(el, onPick) {
    var today = new Date();
    var html = '';

    for (var i = 0; i < SPAN; i++) {
      var d = new Date(today);
      d.setDate(today.getDate() + i);

      html += '<button class="date' + (i === 0 ? ' is-on' : '') + '" type="button" role="tab"' +
              ' aria-selected="' + (i === 0) + '" data-iso="' + CV.iso(d) + '">' +
              '<small>' + (i === 0 ? 'Today' : DAYS[d.getDay()]) + '</small>' +
              '<b>' + d.getDate() + '</b></button>';
    }
    el.innerHTML = html;

    el.addEventListener('click', function (e) {
      var b = e.target.closest('.date');
      if (!b) return;

      $$('.date', el).forEach(function (x) {
        x.classList.remove('is-on');
        x.setAttribute('aria-selected', 'false');
      });
      b.classList.add('is-on');
      b.setAttribute('aria-selected', 'true');
      onPick(b.dataset.iso);
    });

    onPick(CV.iso(today));
  }


  /* ══════════════════════════════════════════════════════════════
     /movies/ — listing
     ══════════════════════════════════════════════════════════════ */
  (function moviesPage() {
    var grid = $('#grid');
    if (!grid) return;

    var tabs   = $('#tabs');
    var chips  = $('#fmtFilter');
    var sortEl = $('#sort');
    var countEl = $('#count');
    var emptyEl = $('#empty');
    var emptyMsg = $('#emptyMsg');
    var search = $('#q');

    var state = {
      tab:  CV.param('tab', 'showing') === 'soon' ? 'soon' : 'showing',
      fmt:  CV.param('fmt', 'all'),
      sort: CV.param('sort', 'popular'),
      /* the home page's booking bar sends ?film=, the nav search sends ?q= */
      q:    CV.param('q', CV.param('film', '')).trim()
    };

    /* reflect the incoming query in the controls */
    if (search && state.q) search.value = state.q;
    if (sortEl) sortEl.value = state.sort;

    $$('.seg', tabs).forEach(function (b) {
      var on = b.dataset.tab === state.tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
    $$('.chip', chips).forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.f === state.fmt);
    });

    var SORTS = {
      popular: function (a, b) { return b.cinemas - a.cinemas || a.title.localeCompare(b.title); },
      rating:  function (a, b) { return (b.rating || 0) - (a.rating || 0); },
      az:      function (a, b) { return a.title.localeCompare(b.title); },
      price:   function (a, b) { return a.price - b.price; }
    };

    function render() {
      var q = state.q.toLowerCase();

      var list = CV.FILMS.filter(function (f) {
        if (f.status !== state.tab) return false;
        if (state.fmt !== 'all' && f.formats.indexOf(state.fmt) < 0) return false;
        if (q && (f.title + ' ' + f.genres).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });

      /* coming soon reads better by release date than by popularity */
      list.sort(state.tab === 'soon' && state.sort === 'popular'
        ? function (a, b) { return a.release < b.release ? -1 : 1; }
        : SORTS[state.sort] || SORTS.popular);

      grid.className = 'grid ' + (state.tab === 'soon' ? 'grid--soon' : 'grid--movies');
      grid.innerHTML = list.map(state.tab === 'soon' ? soonCard : movieCard).join('');

      countEl.innerHTML = '<b>' + list.length + '</b> ' +
        (list.length === 1 ? 'film' : 'films') +
        (state.tab === 'soon' ? ' opening soon' : ' showing today') +
        (state.q ? ' matching “' + esc(state.q) + '”' : '');

      emptyEl.classList.toggle('is-on', list.length === 0);
      if (emptyMsg && state.q) {
        emptyMsg.textContent = 'Nothing matches “' + state.q + '” in this tab. ' +
                               'Try the other tab, or clear the search.';
      }

      CV.reveal(grid);
      syncUrl();
    }

    /* keep the address bar shareable without adding history entries */
    function syncUrl() {
      var p = new URLSearchParams();
      if (state.tab !== 'showing') p.set('tab', state.tab);
      if (state.fmt !== 'all')     p.set('fmt', state.fmt);
      if (state.sort !== 'popular') p.set('sort', state.sort);
      if (state.q)                 p.set('q', state.q);

      var qs = p.toString();
      history.replaceState(null, '', qs ? '?' + qs : location.pathname);
    }

    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('.seg');
      if (!b || b.dataset.tab === state.tab) return;

      state.tab = b.dataset.tab;
      $$('.seg', tabs).forEach(function (x) {
        var on = x === b;
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-selected', String(on));
      });
      render();
    });

    chips.addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;

      state.fmt = b.dataset.f;
      $$('.chip', chips).forEach(function (x) { x.classList.toggle('is-on', x === b); });
      render();
    });

    sortEl.addEventListener('change', function () {
      state.sort = sortEl.value;
      render();
    });

    if (search) {
      search.addEventListener('input', function () {
        state.q = search.value.trim();
        render();
      });
    }

    render();
  })();


  /* ══════════════════════════════════════════════════════════════
     /movie/ — detail
     ══════════════════════════════════════════════════════════════ */
  (function moviePage() {
    var wrap = $('#detail');
    if (!wrap) return;

    var f = CV.film(CV.param('id', '')) || CV.filmByTitle(CV.param('film', ''));

    if (!f) {
      $('#crumbNow').textContent = 'Not found';
      $('#detailEmpty').classList.add('is-on');
      return;
    }

    document.title = f.title + ' — CineVault';
    $('#crumbNow').textContent = f.title;
    wrap.hidden = false;

    $('#detailPoster').innerHTML = CV.poster(f, true);

    $('#detailPills').innerHTML =
      '<span class="pill pill--accent">' + (f.status === 'soon' ? 'Coming ' + CV.shortDate(f.release) : 'Now showing') + '</span>' +
      f.formats.map(function (k) { return '<span class="pill">' + CV.fmtName(k) + '</span>'; }).join('');

    $('#detailTitle').textContent = f.title;

    $('#detailMeta').innerHTML =
      (f.rating ? '<span class="rate"><svg><use href="#i-star"/></svg>' + f.rating.toFixed(1) + '</span>' : '') +
      '<span>' + esc(f.runtime) + '</span><i></i>' +
      '<span>' + esc(f.genres) + '</span><i></i>' +
      '<span class="cert">' + esc(f.cert) + '</span>';

    $('#detailSyn').textContent = f.synopsis;

    function fact(dt, dd) {
      return '<div class="fact"><dt>' + dt + '</dt><dd>' + dd + '</dd></div>';
    }

    $('#detailFacts').innerHTML =
      fact('Runtime', esc(f.runtime)) +
      fact('Certificate', esc(f.cert)) +
      fact('Genre', esc(f.genres)) +
      fact('Rating', f.rating ? f.rating.toFixed(1) + ' / 10' : 'Not yet rated') +
      fact('Formats', f.formats.map(CV.fmtName).join(', ')) +
      fact(f.status === 'soon' ? 'Release' : 'Tickets from',
           f.status === 'soon' ? CV.longDate(f.release) : money(f.price));


    /* ── showtimes, grouped by cinema ─────────────────────── */
    var venuesEl = $('#detailVenues');
    var datesEl = $('#detailDates');

    /* the venues that can actually run this film, tagged with the
       format they were matched on so the badge tells the truth */
    var venues = [];

    CV.VENUES.forEach(function (v) {
      var match = f.formats.filter(function (k) {
        return v.formats.some(function (name) {
          return name.toLowerCase().indexOf(CV.fmtName(k).toLowerCase()) === 0;
        });
      })[0];

      if (match) venues.push({ v: v, fmt: match });
    });

    if (!venues.length) {
      venues = CV.VENUES.slice(0, 3).map(function (v) {
        return { v: v, fmt: f.formats[0] };
      });
    }

    function toMin(t) { var p = t.split(':'); return +p[0] * 60 + +p[1]; }
    function toHHMM(m) {
      m = ((m % 1440) + 1440) % 1440;
      return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    }

    /* stagger each venue off the film's base times so no two match */
    function timesFor(i) {
      return f.times.map(function (t, j) {
        return { t: toHHMM(toMin(t.t) + i * 20), full: t.full ? j % 2 === 0 : (i + j) % 7 === 3 };
      });
    }

    if (f.status === 'soon' || !f.times.length) {
      datesEl.hidden = true;
      venuesEl.innerHTML =
        '<div class="empty is-on"><svg><use href="#i-cal"/></svg>' +
        '<p>Tickets go on sale closer to release on <b>' + CV.longDate(f.release) + '</b>.' +
        (f.prebook ? ' Pre-booking is open at selected cinemas.' : '') + '</p></div>';
      CV.reveal(wrap);
      return;
    }

    venuesEl.innerHTML = venues.map(function (row, i) {
      var v = row.v;
      var chips = timesFor(i).map(function (x) {
        return '<button class="time' + (x.full ? ' is-full' : '') + '"' +
               (x.full ? ' disabled' : '') + '>' + x.t + '</button>';
      }).join('');

      return '<div class="venue reveal" data-film="' + esc(f.title) + '" data-venue="' + esc(v.name) + '">' +
        '<div class="venue__top">' +
          '<div>' +
            '<h3>' + esc(v.name) + '</h3>' +
            '<div class="venue__meta">' +
              '<span>' + esc(v.area) + '</span><i></i>' +
              '<span>' + esc(v.distance) + '</span><i></i>' +
              '<span>' + v.screens + ' screens</span><i></i>' +
              '<span>from ' + money(v.price) + '</span>' +
            '</div>' +
          '</div>' +
          '<span class="venue__fmt">' + CV.fmtName(row.fmt) + '</span>' +
        '</div>' +
        '<div class="times">' + chips + '</div>' +
      '</div>';
    }).join('');

    /* carry the chosen date onto every showtime chip (main.js reads it) */
    buildDates(datesEl, function (isoStr) {
      $$('.time', venuesEl).forEach(function (t) { t.dataset.date = isoStr; });
    });

    CV.reveal(wrap);
  })();


  /* ══════════════════════════════════════════════════════════════
     /cinemas/ — venue list
     ══════════════════════════════════════════════════════════════ */
  (function cinemasPage() {
    var list = $('#venues');
    if (!list) return;

    var chips = $('#fmtFilter');
    var sortEl = $('#sort');
    var countEl = $('#count');
    var emptyEl = $('#empty');

    var state = { fmt: CV.param('fmt', 'all'), sort: CV.param('sort', 'distance') };

    $$('.chip', chips).forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.f === state.fmt);
    });
    sortEl.value = state.sort;

    var num = function (s) { return parseFloat(s) || 0; };

    var SORTS = {
      distance: function (a, b) { return num(a.distance) - num(b.distance); },
      screens:  function (a, b) { return b.screens - a.screens; },
      price:    function (a, b) { return a.price - b.price; },
      az:       function (a, b) { return a.name.localeCompare(b.name); }
    };

    function card(v) {
      var p = v.poster;
      return '<article class="venue-card reveal" style="--p1:' + p[0] + ';--p2:' + p[1] + ';--p3:' + p[2] + '">' +
        '<div class="venue-card__art"><svg><use href="#i-screen"/></svg></div>' +
        '<div>' +
          '<h3>' + esc(v.name) + '</h3>' +
          '<div class="venue__meta">' +
            '<span>' + esc(v.area) + '</span><i></i>' +
            '<span>' + esc(v.distance) + ' away</span><i></i>' +
            '<span>' + v.screens + ' screens</span>' +
          '</div>' +
          '<div class="venue-card__tags">' +
            v.formats.map(function (x) { return '<span class="tag">' + esc(x) + '</span>'; }).join('') +
          '</div>' +
        '</div>' +
        '<div class="venue-card__go">' +
          '<small>from ' + money(v.price) + '</small>' +
          '<a class="btn btn--accent btn--sm" href="' + url('movies') + '?cinema=' + encodeURIComponent(v.name) + '">' +
            '<svg><use href="#i-ticket"/></svg>Showtimes</a>' +
        '</div>' +
      '</article>';
    }

    function render() {
      var want = state.fmt === 'all' ? null : CV.fmtName(state.fmt).toLowerCase();

      var rows = CV.VENUES.filter(function (v) {
        if (!want) return true;
        return v.formats.some(function (name) { return name.toLowerCase().indexOf(want) === 0; });
      });

      rows.sort(SORTS[state.sort] || SORTS.distance);

      list.innerHTML = rows.map(card).join('');
      countEl.innerHTML = '<b>' + rows.length + '</b> ' + (rows.length === 1 ? 'venue' : 'venues') +
                          (want ? ' with ' + CV.fmtName(state.fmt) : ' near you');
      emptyEl.classList.toggle('is-on', rows.length === 0);

      CV.reveal(list);

      var p = new URLSearchParams();
      if (state.fmt !== 'all') p.set('fmt', state.fmt);
      if (state.sort !== 'distance') p.set('sort', state.sort);
      var qs = p.toString();
      history.replaceState(null, '', qs ? '?' + qs : location.pathname);
    }

    chips.addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      state.fmt = b.dataset.f;
      $$('.chip', chips).forEach(function (x) { x.classList.toggle('is-on', x === b); });
      render();
    });

    sortEl.addEventListener('change', function () { state.sort = sortEl.value; render(); });

    render();
  })();


  /* ══════════════════════════════════════════════════════════════
     /signin/ — sign in / register toggle
     ══════════════════════════════════════════════════════════════ */
  (function signinPage() {
    var tabs = $('#authTabs');
    if (!tabs) return;

    var form = $('#authForm');
    var nameField = $('#nameField');
    var nameInput = $('#a-name');
    var pass = $('#a-pass');
    var err = $('#authError');

    var COPY = {
      in: {
        title: 'Welcome back',
        sub:   'Sign in to see your bookings, saved cinemas and member pricing.',
        go:    'Sign in',
        alt:   'New to CineVault? <a href="#" data-go="up">Create an account</a>',
        hint:  '<a href="#" style="color:var(--accent)">Forgot your password?</a>'
      },
      up: {
        title: 'Create account',
        sub:   'One account for every CineVault cinema — bookings, offers and faster checkout.',
        go:    'Create account',
        alt:   'Already have an account? <a href="#" data-go="in">Sign in</a>',
        hint:  'At least 8 characters, with a number.'
      }
    };

    function setMode(mode) {
      var c = COPY[mode];

      $$('.seg', tabs).forEach(function (b) {
        var on = b.dataset.mode === mode;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
      });

      $('#authTitle').textContent = c.title;
      $('#authSub').textContent = c.sub;
      $('#authGoLabel').textContent = c.go;
      $('#authAlt').innerHTML = c.alt;
      $('#passHint').innerHTML = c.hint;

      nameField.hidden = mode !== 'up';
      nameInput.required = mode === 'up';
      pass.setAttribute('autocomplete', mode === 'up' ? 'new-password' : 'current-password');

      err.hidden = true;
      document.title = c.title + ' — CineVault';
    }

    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('.seg');
      if (b) setMode(b.dataset.mode);
    });

    /* the "create an account" / "sign in" link under the form */
    $('#authAlt').addEventListener('click', function (e) {
      var a = e.target.closest('[data-go]');
      if (!a) return;
      e.preventDefault();
      setMode(a.dataset.go);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      if (!form.checkValidity()) {
        err.textContent = 'Please fill in every field with a valid value.';
        err.hidden = false;
        return;
      }
      err.hidden = true;

      /* demo only — there is no back end to talk to */
      var btn = $('#authGo');
      btn.disabled = true;
      $('#authGoLabel').textContent = 'One moment…';

      setTimeout(function () { location.href = url('home'); }, 700);
    });

    setMode(CV.param('mode', 'in') === 'up' ? 'up' : 'in');
  })();


  /* ══ promo codes (checkout only) ════════════════════════════ */
  var PROMOS = {
    VAULTTUE: { label: '25% off tickets',   apply: function (sub) { return sub * 0.25; } },
    CAMPUS4:  { label: '$4 student credit', apply: function (sub) { return Math.min(4, sub); } },
    FAMILY4:  {
      label: 'cheapest seat free',
      apply: function (sub, seats) {
        if (seats.length < 4) return 0;
        return Math.min.apply(null, seats.map(function (s) { return s.price; }));
      }
    }
  };


  /* ══════════════════════════════════════════════════════════════
     /checkout/
     ══════════════════════════════════════════════════════════════ */
  (function checkoutPage() {
    var form = $('#payForm');
    if (!form) return;

    var b = CV.loadBooking();
    var booking = $('.booking');

    if (!b || !b.seats || !b.seats.length) {
      booking.innerHTML =
        '<div class="empty is-on" style="grid-column:1/-1">' +
        '<svg><use href="#i-seat"/></svg>' +
        '<p>You haven’t picked any seats yet. ' +
        '<a href="' + url('movies') + '" style="color:var(--accent)">Choose a screening</a> to start a booking.</p></div>';
      return;
    }

    document.title = 'Checkout — ' + b.title + ' — CineVault';

    var backSeats = $('#backSeats');
    if (backSeats) {
      backSeats.href = url('seats') +
                       '?film=' + encodeURIComponent(b.film) +
                       '&time=' + encodeURIComponent(b.time) +
                       '&venue=' + encodeURIComponent(b.venue) +
                       '&date=' + encodeURIComponent(b.date);
    }

    var promo = null;
    var totals = CV.paintRail(b, 0);


    /* ── payment method picker ──────────────────────────── */
    var pays = $('#pays');
    var cardFields = $('#cardFields');
    var walletHint = $('#walletHint');
    var method = 'card';

    pays.addEventListener('click', function (e) {
      var b2 = e.target.closest('.pay');
      if (!b2) return;

      method = b2.dataset.pay;
      $$('.pay', pays).forEach(function (x) {
        var on = x === b2;
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-checked', String(on));
      });

      cardFields.hidden = method !== 'card';
      walletHint.hidden = method === 'card';
    });


    /* ── light formatting on the card fields ────────────── */
    var num = $('#c-num');
    num.addEventListener('input', function () {
      var digits = num.value.replace(/\D/g, '').slice(0, 16);
      num.value = (digits.match(/.{1,4}/g) || []).join(' ');
    });

    var exp = $('#c-exp');
    exp.addEventListener('input', function () {
      var d = exp.value.replace(/\D/g, '').slice(0, 4);
      exp.value = d.length > 2 ? d.slice(0, 2) + ' / ' + d.slice(2) : d;
    });

    $('#c-cvc').addEventListener('input', function () {
      this.value = this.value.replace(/\D/g, '').slice(0, 4);
    });


    /* ── promo code ─────────────────────────────────────── */
    var code = $('#c-code');
    var codeHint = $('#codeHint');
    var defaultHint = codeHint.innerHTML;

    code.addEventListener('input', function () {
      var key = code.value.trim().toUpperCase();
      var p = PROMOS[key];

      promo = null;

      if (!key) {
        codeHint.innerHTML = defaultHint;
        codeHint.style.color = '';
      } else if (!p) {
        codeHint.textContent = 'That code isn’t recognised.';
        codeHint.style.color = 'var(--error)';
      } else {
        var off = p.apply(b.seats.reduce(function (t, s) { return t + s.price; }, 0), b.seats);

        if (off <= 0) {
          codeHint.textContent = key + ' needs at least 4 seats.';
          codeHint.style.color = 'var(--error)';
        } else {
          promo = { code: key, label: p.label, off: off };
          codeHint.textContent = key + ' applied — ' + p.label + ' (−' + money(off) + ').';
          codeHint.style.color = 'var(--success)';
        }
      }

      totals = CV.paintRail(b, promo ? promo.off : 0);
    });


    /* ── place the order ────────────────────────────────── */
    function ref() {
      var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
      for (var i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
      return 'CV-' + s;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var needed = ['#c-first', '#c-last', '#c-email'];
      if (method === 'card') needed = needed.concat(['#c-num', '#c-exp', '#c-cvc']);

      var bad = needed.filter(function (sel) { return !$(sel).value.trim(); });

      if (bad.length || !form.checkValidity()) {
        var first = $(bad[0] || '#c-first');
        first.focus();
        first.style.borderColor = 'var(--error)';
        setTimeout(function () { first.style.borderColor = ''; }, 1600);
        return;
      }

      b.ref = ref();
      b.name = $('#c-first').value.trim() + ' ' + $('#c-last').value.trim();
      b.email = $('#c-email').value.trim();
      b.method = method;
      b.promo = promo;
      b.subtotal = totals.sub;
      b.fee = totals.fee;
      b.discount = totals.discount;
      b.total = totals.total;
      b.placed = new Date().toISOString();

      CV.saveBooking(b);

      var btn = $('#pay');
      btn.disabled = true;
      btn.innerHTML = '<svg><use href="#i-lock"/></svg>Processing…';

      setTimeout(function () { location.href = url('confirmation'); }, 800);
    });
  })();


  /* ══════════════════════════════════════════════════════════════
     /confirmation/
     ══════════════════════════════════════════════════════════════ */
  (function confirmationPage() {
    var ticket = $('#ticket');
    if (!ticket) return;

    var b = CV.loadBooking();

    if (!b || !b.ref) {
      ticket.hidden = true;
      $('.done__acts').hidden = true;
      $('#doneTitle').textContent = 'No booking found';
      $('#doneSub').textContent = 'Nothing has been booked in this browser session.';
      $('.done__tick').hidden = true;
      $('#noBooking').classList.add('is-on');
      return;
    }

    document.title = 'Booking ' + b.ref + ' — CineVault';

    $('#doneSub').textContent = b.email
      ? 'We’ve sent your tickets to ' + b.email + '. Show the QR code at the door — no printing needed.'
      : 'Show the QR code at the door — no printing needed.';

    $('#tFilm').textContent = b.title || b.film;
    $('#tSub').textContent = b.venue;
    $('#tDate').textContent = CV.longDate(b.date);
    $('#tTime').textContent = b.time;
    $('#tSeats').textContent = b.seats.map(function (s) { return s.id; }).join(', ');
    $('#tTotal').textContent = money(b.total);
    $('#tRef').textContent = b.ref;

    $('#qr').innerHTML = qr(b.ref + '|' + b.date + '|' + b.time);

    $('#printBtn').addEventListener('click', function () { window.print(); });

    $('#saveBtn').addEventListener('click', function () {
      var lines = [
        'CineVault booking ' + b.ref,
        '',
        (b.title || b.film),
        b.venue,
        CV.longDate(b.date) + ' at ' + b.time,
        'Seats: ' + b.seats.map(function (s) { return s.id + ' (' + s.tier + ')'; }).join(', '),
        'Total paid: ' + money(b.total)
      ].join('\n');

      var blobUrl = URL.createObjectURL(new Blob([lines], { type: 'text/plain' }));
      var a = document.createElement('a');
      a.href = blobUrl;
      a.download = b.ref + '.txt';
      a.click();
      URL.revokeObjectURL(blobUrl);
    });
  })();


  /* A stand-in for a real QR encoder: the modules are derived from the
     booking reference, so the pattern is stable per booking. Scanners
     will not read it — swap in a real encoder when there's a back end. */
  function qr(text) {
    var N = 25, h = 2166136261;

    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    function rnd() {
      h ^= h << 13; h >>>= 0;
      h ^= h >>> 17;
      h ^= h << 5;  h >>>= 0;
      return h / 4294967296;
    }

    /* the three alignment squares a QR code always carries */
    var eyes = [[0, 0], [N - 7, 0], [0, N - 7]];
    function inEye(x, y) {
      return eyes.some(function (e) {
        var dx = x - e[0], dy = y - e[1];
        if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return false;
        return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx > 1 && dx < 5 && dy > 1 && dy < 5);
      });
    }
    function nearEye(x, y) {
      return eyes.some(function (e) {
        return x >= e[0] - 1 && x <= e[0] + 7 && y >= e[1] - 1 && y <= e[1] + 7;
      });
    }

    var out = '';
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var on = nearEye(x, y) ? inEye(x, y) : rnd() > 0.52;
        if (on) out += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
      }
    }
    return '<svg viewBox="0 0 ' + N + ' ' + N + '" shape-rendering="crispEdges" fill="#0b0b12" ' +
           'role="img" aria-label="Booking QR code">' + out + '</svg>';
  }

})();
