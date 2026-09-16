/* ═══════════════════════════════════════════════════════════════
   CineVault — card markup shared by the home grid and the listing.
   Kept in one file so the two never drift apart.
   ═══════════════════════════════════════════════════════════════ */
window.CV_CARDS = (function () {
  'use strict';

  var CV = window.CV;
  var esc = CV.esc;

  /* A showtime chip links straight to seat selection. The showtime id
     is the only thing the seats page needs — film, hall, time and price
     all hang off it server-side, so nothing has to be passed along in
     the query string and nothing can go stale. */
  function timeChip(s) {
    return '<a class="time" href="seats.html?showtime=' + s.id + '">' + esc(CV.clock(s.start_time)) + '</a>';
  }

  function timeChips(movie, isoDate, limit) {
    var list = window.CV_CAT.onDate(movie, isoDate);

    if (!list.length) {
      return '<p class="times__none">No screenings on this date.</p>';
    }

    var shown = limit ? list.slice(0, limit) : list;
    var html = shown.map(timeChip).join('');

    if (list.length > shown.length) {
      html += '<a class="time time--more" href="movie.html?id=' + movie.id + '">+' +
              (list.length - shown.length) + '</a>';
    }
    return html;
  }

  function posterWithBook(m) {
    return CV.poster(m, false).replace(/<\/div>$/,
      '<div class="poster__over"><a class="btn btn--accent btn--sm" href="movie.html?id=' + m.id +
      '"><svg><use href="#i-ticket"/></svg>Book</a></div></div>');
  }

  function meta(m) {
    return esc(CV.genreText(m.genres)) + ' <i></i> ' + esc(CV.runtime(m.duration_minutes)) +
           (m.age_rating ? ' <i></i> ' + esc(m.age_rating) : '');
  }

  /* a film with screenings you can buy into */
  function movieCard(m, isoDate) {
    var at = m._cinemas
      ? 'at <b>' + m._cinemas + (m._cinemas === 1 ? ' hall</b>' : ' halls</b>') +
        (m._price != null ? ' · from ' + CV.money(m._price) : '')
      : 'No halls scheduled yet';

    return '<article class="mcard reveal" data-film="' + esc(m.title) + '">' +
      posterWithBook(m) +
      '<div class="mcard__b">' +
        '<h3><a href="movie.html?id=' + m.id + '">' + esc(m.title) + '</a></h3>' +
        '<p class="mcard__m">' + meta(m) + '</p>' +
        '<p class="mcard__lab"><svg><use href="#i-clock"/></svg>Showtimes</p>' +
        '<div class="times">' + timeChips(m, isoDate, 4) + '</div>' +
        '<p class="mcard__at">' + at + '</p>' +
      '</div>' +
    '</article>';
  }

  /* a film with nothing scheduled — no fake pre-booking, because the
     API has no endpoint that could take one */
  function soonCard(m) {
    var when = m.release_date
      ? '<span class="scard__when">Released ' + esc(CV.shortDate(m.release_date)) + '</span>'
      : '<span class="scard__when">Release date to be announced</span>';

    return '<article class="scard reveal">' +
      CV.poster(m, true) +
      '<div class="scard__b">' +
        '<h3><a href="movie.html?id=' + m.id + '">' + esc(m.title) + '</a></h3>' +
        '<p class="mcard__m">' + meta(m) + '</p>' +
        when +
        '<div class="scard__act">' +
          '<a class="btn btn--ghost btn--sm btn--full" href="movie.html?id=' + m.id + '">' +
          '<svg><use href="#i-film"/></svg>View details</a>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  /* the seven-day strip used on the home page and the detail page */
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function buildDates(el, onPick, span) {
    if (!el) return;
    span = span || 7;

    var today = new Date();
    var html = '';

    for (var i = 0; i < span; i++) {
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

      CV.$$('.date', el).forEach(function (x) {
        x.classList.remove('is-on');
        x.setAttribute('aria-selected', 'false');
      });
      b.classList.add('is-on');
      b.setAttribute('aria-selected', 'true');
      onPick(b.dataset.iso);
    });

    onPick(CV.iso(today));
  }

  return {
    movieCard: movieCard,
    soonCard: soonCard,
    timeChips: timeChips,
    timeChip: timeChip,
    buildDates: buildDates,
    meta: meta
  };
})();
