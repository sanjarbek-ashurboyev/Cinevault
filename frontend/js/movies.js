/* ═══════════════════════════════════════════════════════════════
   CineVault — /movies listing.

   The whole catalogue is fetched once by catalogue.js and filtered in
   the browser. The API does offer ?search= and ?genres= filters (see
   movies/filters.py) but a round trip per keystroke would be slower
   and jumpier than filtering a list this size in place, and it would
   also lose the showtime join the tabs depend on.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CV = window.CV, CAT = window.CV_CAT, CARDS = window.CV_CARDS;
  var $ = CV.$, $$ = CV.$$, esc = CV.esc;

  var grid = $('#grid');
  if (!grid) return;

  var tabs = $('#tabs');
  var chips = $('#genreFilter');
  var sortEl = $('#sort');
  var countEl = $('#count');
  var emptyEl = $('#empty');
  var emptyMsg = $('#emptyMsg');
  var search = $('#q');
  var datesEl = $('#dates');

  var state = {
    tab: CV.param('tab', 'showing') === 'soon' ? 'soon' : 'showing',
    genre: CV.param('genre', 'all'),
    sort: CV.param('sort', 'soonest'),
    hall: CV.param('hall', ''),
    date: CV.param('date', CV.iso(new Date())),
    q: CV.param('q', '').trim()
  };

  var cat = null;

  CV.loading(grid, 'Loading films…');

  CAT.load().then(function (data) {
    cat = data;
    paintChips(data);
    paintTabs();
    if (search && state.q) search.value = state.q;
    if (sortEl) sortEl.value = state.sort;

    CARDS.buildDates(datesEl, function (isoDate) {
      state.date = isoDate;
      render();
    });

    wire();
  }, function (err) {
    CV.failed(grid, err, 'Retry');
    grid.addEventListener('click', function (e) {
      if (e.target.closest('[data-retry]')) location.reload();
    });
  });


  /* ── controls ────────────────────────────────────────────── */

  /* Genres are a real model with its own endpoint, so the filter row
     is built from whatever the database holds rather than a fixed list. */
  function paintChips(data) {
    if (!chips) return;

    var used = {};
    data.movies.forEach(function (m) {
      (m.genres || []).forEach(function (g) { used[g.id] = g.name; });
    });

    var ids = Object.keys(used);
    if (!ids.length) { chips.hidden = true; return; }

    chips.innerHTML =
      '<button class="chip' + (state.genre === 'all' ? ' is-on' : '') + '" type="button" data-g="all">All genres</button>' +
      ids.map(function (id) {
        return '<button class="chip' + (state.genre === id ? ' is-on' : '') +
               '" type="button" data-g="' + id + '">' + esc(used[id]) + '</button>';
      }).join('');
  }

  function paintTabs() {
    $$('.seg', tabs).forEach(function (b) {
      var on = b.dataset.tab === state.tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
    /* the date strip only means anything for films you can book */
    if (datesEl) datesEl.hidden = state.tab === 'soon';
  }

  function wire() {
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('.seg');
      if (!b || b.dataset.tab === state.tab) return;
      state.tab = b.dataset.tab;
      paintTabs();
      render();
    });

    if (chips) chips.addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      state.genre = b.dataset.g;
      $$('.chip', chips).forEach(function (x) { x.classList.toggle('is-on', x === b); });
      render();
    });

    sortEl.addEventListener('change', function () {
      state.sort = sortEl.value;
      render();
    });

    if (search) search.addEventListener('input', function () {
      state.q = search.value.trim();
      render();
    });
  }


  /* ── render ──────────────────────────────────────────────── */
  var SORTS = {
    soonest: function (a, b) {
      var an = a._upcoming[0], bn = b._upcoming[0];
      if (an && bn) return new Date(an.start_time) - new Date(bn.start_time);
      return an ? -1 : bn ? 1 : a.title.localeCompare(b.title);
    },
    rating: function (a, b) { return (b.rating || 0) - (a.rating || 0); },
    az: function (a, b) { return a.title.localeCompare(b.title); },
    price: function (a, b) {
      /* films with nothing on sale sink rather than sort as free */
      var ap = a._price == null ? Infinity : a._price;
      var bp = b._price == null ? Infinity : b._price;
      return ap - bp;
    },
    release: function (a, b) {
      if (!a.release_date) return 1;
      if (!b.release_date) return -1;
      return a.release_date < b.release_date ? -1 : 1;
    }
  };

  function render() {
    var q = state.q.toLowerCase();

    var list = cat.movies.filter(function (m) {
      if (m._status !== state.tab) return false;

      if (state.genre !== 'all') {
        var hit = (m.genres || []).some(function (g) { return String(g.id) === state.genre; });
        if (!hit) return false;
      }

      if (q) {
        var hay = (m.title + ' ' + CV.genreText(m.genres) + ' ' + (m.description || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }

      if (state.tab === 'showing') {
        var day = CAT.onDate(m, state.date);
        if (!day.length) return false;
        if (state.hall && !day.some(function (s) { return String(s.hall) === state.hall; })) return false;
      }
      return true;
    });

    list.sort(SORTS[state.tab === 'soon' && state.sort === 'soonest' ? 'release' : state.sort] || SORTS.az);

    grid.className = 'grid ' + (state.tab === 'soon' ? 'grid--soon' : 'grid--movies');
    grid.innerHTML = list.map(function (m) {
      return state.tab === 'soon' ? CARDS.soonCard(m) : CARDS.movieCard(m, state.date);
    }).join('');

    countEl.innerHTML = '<b>' + list.length + '</b> ' +
      (list.length === 1 ? 'film' : 'films') +
      (state.tab === 'soon' ? ' with nothing scheduled' : ' on ' + esc(CV.longDate(state.date))) +
      (state.q ? ' matching “' + esc(state.q) + '”' : '');

    emptyEl.classList.toggle('is-on', list.length === 0);
    if (emptyMsg) {
      emptyMsg.textContent = state.q
        ? 'Nothing matches “' + state.q + '” in this tab. Try the other tab, or clear the search.'
        : state.tab === 'showing'
          ? 'No screenings on that date. Try another day, or check Coming Soon.'
          : 'Every film currently has a screening scheduled.';
    }

    CV.reveal(grid);
    syncUrl();
  }

  /* keep the address bar shareable without stacking history entries */
  function syncUrl() {
    var p = new URLSearchParams();
    if (state.tab !== 'showing') p.set('tab', state.tab);
    if (state.genre !== 'all') p.set('genre', state.genre);
    if (state.sort !== 'soonest') p.set('sort', state.sort);
    if (state.hall) p.set('hall', state.hall);
    if (state.q) p.set('q', state.q);

    var qs = p.toString();
    history.replaceState(null, '', qs ? '?' + qs : location.pathname);
  }

})();
