/* ═══════════════════════════════════════════════════════════════
   CineVault — /movie detail.

   Fetches just this film and just its showtimes, using the API's own
   ?movie= filter (showtimes/filters.py) rather than pulling the whole
   catalogue — the detail page is the one place a targeted query is
   clearly cheaper.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CV = window.CV, API = window.CV_API, CARDS = window.CV_CARDS;
  var $ = CV.$, $$ = CV.$$, esc = CV.esc;

  var wrap = $('#detail');
  if (!wrap) return;

  var id = CV.param('id', '');
  var wantDate = CV.param('date', '');

  if (!id) return notFound('No film was specified.');

  Promise.all([
    API.movie(id),
    API.showtimes({ movie: id }),
    API.halls().catch(function () { return []; })
  ]).then(function (res) {
    render(res[0], res[1], res[2]);
  }, function (err) {
    notFound(err.status === 404 ? 'We could not find that film.' : err.message);
  });


  function notFound(msg) {
    var crumb = $('#crumbNow');
    if (crumb) crumb.textContent = 'Not found';
    var empty = $('#detailEmpty');
    if (empty) {
      $('#detailEmptyMsg').textContent = msg;
      empty.classList.add('is-on');
    }
  }


  function render(m, showtimes, halls) {
    var hallById = {};
    halls.forEach(function (h) { hallById[h.id] = h; });

    var now = Date.now();
    var upcoming = showtimes
      .filter(function (s) { return new Date(s.start_time).getTime() >= now; })
      .sort(function (a, b) { return new Date(a.start_time) - new Date(b.start_time); });

    upcoming.forEach(function (s) {
      s.hallName = (hallById[s.hall] && hallById[s.hall].name) || ('Hall ' + s.hall);
    });

    document.title = m.title + ' — CineVault';
    $('#crumbNow').textContent = m.title;
    wrap.hidden = false;

    $('#detailPoster').innerHTML = CV.poster(m, true);

    $('#detailPills').innerHTML =
      '<span class="pill pill--accent">' + (upcoming.length ? 'Now showing' : 'Not scheduled') + '</span>' +
      (m.age_rating ? '<span class="pill">' + esc(m.age_rating) + '</span>' : '');

    $('#detailTitle').textContent = m.title;

    $('#detailMeta').innerHTML =
      (m.rating != null ? '<span class="rate"><svg><use href="#i-star"/></svg>' + CV.num(m.rating).toFixed(1) + '</span>' : '') +
      '<span>' + esc(CV.runtime(m.duration_minutes)) + '</span><i></i>' +
      '<span>' + esc(CV.genreText(m.genres)) + '</span>' +
      (m.age_rating ? '<i></i><span class="cert">' + esc(m.age_rating) + '</span>' : '');

    $('#detailSyn').textContent = m.description || 'No synopsis has been added for this film yet.';

    var trailer = $('#detailTrailer');
    if (m.trailer_url) {
      trailer.hidden = false;
      trailer.href = m.trailer_url;
    } else {
      trailer.hidden = true;
    }

    var prices = upcoming.map(function (s) { return CV.num(s.price); });

    $('#detailFacts').innerHTML = [
      fact('Runtime', esc(CV.runtime(m.duration_minutes))),
      fact('Certificate', esc(m.age_rating || '—')),
      fact('Genre', esc(CV.genreText(m.genres))),
      fact('Rating', m.rating != null ? CV.num(m.rating).toFixed(1) + ' / 10' : 'Not yet rated'),
      fact('Release', m.release_date ? esc(CV.longDate(m.release_date)) : 'To be announced'),
      fact('Tickets from', prices.length ? CV.money(Math.min.apply(null, prices)) : 'Not on sale')
    ].join('');

    paintShowtimes(m, upcoming);
    CV.reveal(wrap);
  }

  function fact(dt, dd) {
    return '<div class="fact"><dt>' + dt + '</dt><dd>' + dd + '</dd></div>';
  }


  /* ── showtimes, grouped by hall ──────────────────────────── */
  function paintShowtimes(m, upcoming) {
    var venuesEl = $('#detailVenues');
    var datesEl = $('#detailDates');

    if (!upcoming.length) {
      datesEl.hidden = true;
      venuesEl.innerHTML =
        '<div class="empty is-on"><svg><use href="#i-cal"/></svg><p>' +
        (m.release_date
          ? 'No screenings are scheduled yet. Released ' + esc(CV.shortDate(m.release_date)) + '.'
          : 'No screenings are scheduled for this film yet.') +
        '</p></div>';
      return;
    }

    function draw(isoDate) {
      var day = upcoming.filter(function (s) { return CV.dateKey(s.start_time) === isoDate; });

      if (!day.length) {
        venuesEl.innerHTML =
          '<div class="empty is-on"><svg><use href="#i-cal"/></svg>' +
          '<p>Nothing on ' + esc(CV.longDate(isoDate)) + '. The next screening is ' +
          esc(CV.longDate(upcoming[0].start_time)) + ' at ' + esc(CV.clock(upcoming[0].start_time)) +
          '.</p></div>';
        return;
      }

      /* one block per hall, in the order the halls first appear */
      var order = [];
      var byHall = {};
      day.forEach(function (s) {
        if (!byHall[s.hall]) { byHall[s.hall] = []; order.push(s.hall); }
        byHall[s.hall].push(s);
      });

      venuesEl.innerHTML = order.map(function (hallId) {
        var list = byHall[hallId];
        var cheapest = Math.min.apply(null, list.map(function (s) { return CV.num(s.price); }));

        return '<div class="venue reveal">' +
          '<div class="venue__top">' +
            '<div>' +
              '<h3>' + esc(list[0].hallName) + '</h3>' +
              '<div class="venue__meta">' +
                '<span>' + list.length + (list.length === 1 ? ' screening' : ' screenings') + '</span><i></i>' +
                '<span>from ' + CV.money(cheapest) + '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="times">' + list.map(CARDS.timeChip).join('') + '</div>' +
        '</div>';
      }).join('');

      CV.reveal(venuesEl);
    }

    CARDS.buildDates(datesEl, draw);

    /* honour ?date= from the home page booking bar, if it is on strip */
    if (wantDate) {
      var btn = $$('.date', datesEl).filter(function (b) { return b.dataset.iso === wantDate; })[0];
      if (btn) btn.click();
    }
  }

})();
