/* ═══════════════════════════════════════════════════════════════
   CineVault — /cinemas.

   A Hall in this project is one auditorium (name, rows, seats per
   row) — there is no venue/branch model, so the page lists halls and
   describes each one from what is actually knowable: its capacity and
   what is scheduled in it. Address, distance and screen count are gone
   because nothing in the API could fill them in.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CV = window.CV, CAT = window.CV_CAT;
  var $ = CV.$, $$ = CV.$$, esc = CV.esc;

  var list = $('#venues');
  if (!list) return;

  var sortEl = $('#sort');
  var countEl = $('#count');
  var emptyEl = $('#empty');
  var search = $('#venueSearch');

  var state = { sort: CV.param('sort', 'az'), q: '' };
  var halls = [];

  CV.loading(list, 'Loading halls…');

  CAT.load().then(function (cat) {
    halls = decorate(cat);
    if (sortEl) sortEl.value = state.sort;
    wire();
    render();
  }, function (err) {
    /* The most likely failure here is a 403: GET /halls/ is only
       public because halls/views.py grants AllowAny for GET. Say so
       plainly rather than showing an empty page. */
    CV.failed(list, err.status === 403
      ? { message: 'Hall listing is closed to visitors. GET /api/v1/halls/ needs AllowAny permission.' }
      : err);
  });


  /* Fold each hall together with the screenings booked into it. */
  function decorate(cat) {
    var byHall = {};

    cat.movies.forEach(function (m) {
      m._upcoming.forEach(function (s) {
        var row = byHall[s.hall] = byHall[s.hall] || { screenings: 0, films: {}, prices: [] };
        row.screenings++;
        row.films[m.id] = m.title;
        row.prices.push(CV.num(s.price));
      });
    });

    return cat.halls.map(function (h) {
      var row = byHall[h.id] || { screenings: 0, films: {}, prices: [] };
      var titles = Object.keys(row.films).map(function (k) { return row.films[k]; });

      return {
        id: h.id,
        name: h.name,
        rows: h.total_rows || 0,
        perRow: h.total_seats_per_row || 0,
        capacity: (h.total_rows || 0) * (h.total_seats_per_row || 0),
        screenings: row.screenings,
        films: titles,
        price: row.prices.length ? Math.min.apply(null, row.prices) : null
      };
    });
  }


  function wire() {
    if (sortEl) sortEl.addEventListener('change', function () {
      state.sort = sortEl.value;
      render();
    });
    if (search) search.addEventListener('input', function () {
      state.q = search.value.trim().toLowerCase();
      render();
    });
  }

  var SORTS = {
    az: function (a, b) { return a.name.localeCompare(b.name); },
    capacity: function (a, b) { return b.capacity - a.capacity; },
    screenings: function (a, b) { return b.screenings - a.screenings; },
    price: function (a, b) {
      var ap = a.price == null ? Infinity : a.price;
      var bp = b.price == null ? Infinity : b.price;
      return ap - bp;
    }
  };

  function card(v) {
    /* the hall's own name seeds its colour, the same trick the posters
       use, so each card is distinguishable at a glance */
    var p = CV.hues({ id: v.id, title: v.name });

    var playing = v.films.length
      ? '<div class="venue-card__tags">' +
          v.films.slice(0, 4).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') +
          (v.films.length > 4 ? '<span class="tag">+' + (v.films.length - 4) + '</span>' : '') +
        '</div>'
      : '<p class="venue-card__none">Nothing scheduled here yet.</p>';

    return '<article class="venue-card reveal" style="--p1:' + p[0] + ';--p2:' + p[1] + ';--p3:' + p[2] + '">' +
      '<div class="venue-card__art"><svg><use href="#i-screen"/></svg></div>' +
      '<div>' +
        '<h3>' + esc(v.name) + '</h3>' +
        '<div class="venue__meta">' +
          '<span>' + v.rows + ' rows × ' + v.perRow + '</span><i></i>' +
          '<span>' + v.capacity + ' seats</span><i></i>' +
          '<span>' + v.screenings + (v.screenings === 1 ? ' screening' : ' screenings') + '</span>' +
        '</div>' +
        playing +
      '</div>' +
      '<div class="venue-card__go">' +
        (v.price != null ? '<small>from ' + CV.money(v.price) + '</small>' : '<small>—</small>') +
        '<a class="btn btn--accent btn--sm" href="movies.html?hall=' + v.id + '">' +
          '<svg><use href="#i-ticket"/></svg>Showtimes</a>' +
      '</div>' +
    '</article>';
  }

  function render() {
    var rows = halls.filter(function (v) {
      return !state.q || v.name.toLowerCase().indexOf(state.q) > -1;
    });

    rows.sort(SORTS[state.sort] || SORTS.az);

    list.innerHTML = rows.map(card).join('');

    countEl.innerHTML = '<b>' + rows.length + '</b> ' + (rows.length === 1 ? 'hall' : 'halls');

    emptyEl.classList.toggle('is-on', rows.length === 0);
    CV.reveal(list);

    var p = new URLSearchParams();
    if (state.sort !== 'az') p.set('sort', state.sort);
    var qs = p.toString();
    history.replaceState(null, '', qs ? '?' + qs : location.pathname);
  }

})();
