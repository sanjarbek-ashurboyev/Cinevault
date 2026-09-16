/* ═══ CineVault — home page ════════════════════════════════════ */
(function () {
  'use strict';

  var CV = window.CV, CAT = window.CV_CAT, CARDS = window.CV_CARDS;
  var $ = CV.$, $$ = CV.$$, esc = CV.esc;

  var grid = $('#movieGrid');
  var soonGrid = $('#soonGrid');

  CV.loading(grid, 'Loading films…');

  CAT.load().then(render, function (err) {
    CV.failed(grid, err, 'Retry');
    CV.failed(soonGrid, err);
    var hero = $('#heroInner');
    if (hero) hero.classList.add('is-failed');
  });


  function render(cat) {
    var movies = cat.movies;

    var showing = movies.filter(function (m) { return m._status === 'showing'; });
    var soon = movies.filter(function (m) { return m._status === 'soon'; });

    /* soonest release first, undated films last */
    soon.sort(function (a, b) {
      if (!a.release_date) return 1;
      if (!b.release_date) return -1;
      return a.release_date < b.release_date ? -1 : 1;
    });

    paintHero(showing.length ? showing : movies);
    paintStats(cat);
    paintBookBar(cat);
    paintShowing(showing);
    paintSoon(soon);
  }


  /* ── hero ────────────────────────────────────────────────── */
  /* A rotating banner over the films with the soonest screenings, since
     those are the ones a visitor can act on. It advances on its own and
     pauses while someone is actually reading it. */

  var HERO_DWELL = 7000;   /* ms a film holds the banner */
  var HERO_FADE  = 380;    /* must match .hero__art's transition */
  var HERO_COUNT = 5;      /* films in the rotation */

  function paintHero(pool) {
    var wrap = $('#hero');
    if (!wrap || !pool.length) {
      if (wrap) wrap.hidden = true;
      return;
    }

    var ranked = pool.slice().sort(function (a, b) {
      var an = a._upcoming[0], bn = b._upcoming[0];
      if (an && bn) return new Date(an.start_time) - new Date(bn.start_time);
      if (an) return -1;
      if (bn) return 1;
      return (b.rating || 0) - (a.rating || 0);
    });

    var films  = ranked.slice(0, HERO_COUNT);
    var art    = $('#heroArt');
    var idx    = 0;
    var timer  = null;
    var paused = false;

    /* Movie.backdrop is landscape art meant for exactly this. The poster
       is the fallback and a poor one — cropping a 2:3 portrait to a wide
       banner leaves a close-up of whatever happens to be mid-frame — but
       it beats a bare gradient for a film whose backdrop is missing. */
    function artUrl(m) {
      return window.CV_API.mediaUrl(m.backdrop) || window.CV_API.mediaUrl(m.poster);
    }

    function swapArt(m, instant) {
      var p = CV.hues(m);
      var url = artUrl(m);

      /* Start the fetch now, so the new art is usually decoded by the
         time the outgoing one has finished fading. */
      if (url) { var pre = new Image(); pre.src = url; }

      function apply() {
        art.style.setProperty('--p1', p[0]);
        art.style.setProperty('--p2', p[1]);
        art.style.setProperty('--p3', p[2]);
        art.style.backgroundImage = url ? 'url(' + url + ')' : '';
        art.classList.toggle('has-img', !!url);
        art.classList.remove('is-swapping');
      }

      if (instant || CV.reduced) { apply(); return; }
      art.classList.add('is-swapping');
      setTimeout(apply, HERO_FADE);
    }

    function paintText(m) {
      $('#heroPills').innerHTML =
        '<span class="pill pill--accent">' + (m._status === 'showing' ? 'Now showing' : 'Coming soon') + '</span>' +
        (m.age_rating ? '<span class="pill">' + esc(m.age_rating) + '</span>' : '') +
        (m._cinemas ? '<span class="pill">' + m._cinemas + (m._cinemas === 1 ? ' hall' : ' halls') + '</span>' : '');

      $('#heroTitle').innerHTML = esc(m.title).replace(/[:–-]\s*/, '<br><em>') +
                                  (/[:–-]\s*/.test(m.title) ? '</em>' : '');

      $('#heroMeta').innerHTML =
        (m.rating != null ? '<span class="rate"><svg><use href="#i-star"/></svg>' + CV.num(m.rating).toFixed(1) + '</span>' : '') +
        (m.release_date ? '<span>' + esc(String(m.release_date).slice(0, 4)) + '</span><i></i>' : '') +
        '<span>' + esc(CV.runtime(m.duration_minutes)) + '</span><i></i>' +
        '<span>' + esc(CV.genreText(m.genres)) + '</span>' +
        (m.age_rating ? '<i></i><span class="cert">' + esc(m.age_rating) + '</span>' : '');

      $('#heroDesc').textContent = m.description || '';

      $('#heroBook').href = 'movie.html?id=' + m.id;

      /* Trailer is a real URL on the model — open it, or hide the
         button entirely rather than offer a dead control. */
      var trailer = $('#heroTrailer');
      if (m.trailer_url) {
        trailer.hidden = false;
        trailer.href = m.trailer_url;
      } else {
        trailer.hidden = true;
      }

      $('#heroFrom').innerHTML = m._price != null
        ? 'From <b>' + CV.money(m._price) + '</b> · <span>' + m._upcoming.length +
          (m._upcoming.length === 1 ? ' screening' : ' screenings') + ' scheduled</span>'
        : '<span>Not yet on sale</span>';
    }

    function arm() {
      clearTimeout(timer);
      if (paused || CV.reduced || films.length < 2) return;
      timer = setTimeout(function () { go(idx + 1); }, HERO_DWELL);
    }

    function go(next, instant) {
      idx = (next + films.length) % films.length;
      paintText(films[idx]);
      swapArt(films[idx], instant);
      arm();
    }

    function pause()  { paused = true; clearTimeout(timer); }
    function resume() { if (!paused) return; paused = false; arm(); }

    /* Hold while someone is plainly reading the text column. Hovering the
       banner at large does not count — the pointer sits there in passing. */
    var inner = $('#heroInner');
    if (inner) {
      inner.addEventListener('pointerenter', pause);
      inner.addEventListener('pointerleave', resume);
      inner.addEventListener('focusin', pause);
      inner.addEventListener('focusout', resume);
    }

    /* A backgrounded tab throttles timers, so returning to one would
       otherwise fire a burst of queued advances at once. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { clearTimeout(timer); } else if (!paused) { arm(); }
    });

    go(0, true);
    CV.reveal(wrap);
  }


  /* ── stats ───────────────────────────────────────────────── */
  /* Counted from what the API actually returned, so these numbers
     move with the database instead of describing an imaginary chain. */
  function paintStats(cat) {
    var el = $('#stats');
    if (!el) return;

    var seats = cat.halls.reduce(function (t, h) {
      return t + (h.total_rows || 0) * (h.total_seats_per_row || 0);
    }, 0);

    var screenings = cat.movies.reduce(function (t, m) { return t + m._upcoming.length; }, 0);

    var rated = cat.movies.filter(function (m) { return m.rating != null; });
    var avg = rated.length
      ? rated.reduce(function (t, m) { return t + CV.num(m.rating); }, 0) / rated.length
      : null;

    var cells = [
      { n: cat.movies.length, label: 'Films' },
      { n: cat.halls.length, label: cat.halls.length === 1 ? 'Hall' : 'Halls' },
      { n: screenings, label: 'Screenings ahead' },
      { n: seats, label: 'Seats' }
    ];

    if (avg != null) cells[3] = { n: avg.toFixed(1), label: 'Average rating' };

    el.innerHTML = cells.map(function (c) {
      return '<div class="stat"><b>' + esc(c.n) + '</b><span>' + esc(c.label) + '</span></div>';
    }).join('');
  }


  /* ── quick booking bar ───────────────────────────────────── */
  function paintBookBar(cat) {
    var form = $('#bookbar');
    if (!form) return;

    var mSel = $('#f-movie');
    var hSel = $('#f-hall');
    var dInp = $('#f-date');

    mSel.innerHTML = '<option value="">Any movie</option>' +
      cat.movies.map(function (m) {
        return '<option value="' + m.id + '">' + esc(m.title) + '</option>';
      }).join('');

    hSel.innerHTML = '<option value="">All halls</option>' +
      cat.halls.map(function (h) {
        return '<option value="' + h.id + '">' + esc(h.name) + '</option>';
      }).join('');

    dInp.value = CV.iso(new Date());

    $('#bookbarGo').addEventListener('click', function () {
      var p = new URLSearchParams();
      if (dInp.value) p.set('date', dInp.value);
      if (hSel.value) p.set('hall', hSel.value);

      /* one film chosen → straight to its showtimes */
      if (mSel.value) {
        location.href = 'movie.html?id=' + mSel.value + (dInp.value ? '&date=' + dInp.value : '');
      } else {
        location.href = 'movies.html' + (p.toString() ? '?' + p.toString() : '');
      }
    });
  }


  /* ── now showing ─────────────────────────────────────────── */
  function paintShowing(showing) {
    if (!grid) return;

    var datesEl = $('#dates');
    var empty = $('#gridEmpty');

    function draw(isoDate) {
      /* a film only earns a card on a date it actually screens */
      var list = showing.filter(function (m) { return CAT.onDate(m, isoDate).length > 0; });

      grid.innerHTML = list.map(function (m) { return CARDS.movieCard(m, isoDate); }).join('');

      if (empty) {
        empty.textContent = showing.length
          ? 'No screenings on that date. Try another day.'
          : 'Nothing is scheduled yet. Add a showtime in the Django admin to see it here.';
        empty.classList.toggle('is-on', list.length === 0);
      }
      CV.reveal(grid);
    }

    CARDS.buildDates(datesEl, draw);
  }


  /* ── coming soon ─────────────────────────────────────────── */
  function paintSoon(soon) {
    var section = $('#coming-soon');
    if (!soonGrid) return;

    if (!soon.length) {
      if (section) section.hidden = true;
      return;
    }

    soonGrid.innerHTML = soon.map(CARDS.soonCard).join('');
    CV.reveal(soonGrid);
  }

})();
