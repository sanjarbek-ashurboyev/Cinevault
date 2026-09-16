/* ═══════════════════════════════════════════════════════════════
   CineVault — seat selection.

   Driven entirely by ?showtime=<id>. Everything else — film, hall,
   start time, price and which seats are gone — is read from the API,
   so a stale or hand-edited link cannot put the page out of step with
   what the backend will actually sell.

   Continuing creates the reservation (POST /reservations/), which is
   what puts a 10-minute hold on the seats. Payment happens next, on
   the checkout page, against that reservation.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CV = window.CV, API = window.CV_API;
  var $ = CV.$, $$ = CV.$$, esc = CV.esc;

  var rowsEl = $('#rows');
  if (!rowsEl) return;

  /* A frontend convention, not a backend rule — the API will accept
     any number of seats. It exists to make a slip of the mouse cheap. */
  var MAX = 8;

  var showtimeId = CV.param('showtime', '');
  var err = $('#seatError');
  var go = $('#go');
  var note = $('#planNote');
  var defaultNote = note.textContent;

  var showtime = null, movie = null, seatMap = null;
  var price = 0;
  var chosen = [];          // [{ id, label, row, number }]

  if (!showtimeId) {
    CV.failed($('#planWrap'), { message: 'No screening was specified.' });
    return;
  }

  CV.loading(rowsEl, 'Loading the seat plan…');
  go.disabled = true;

  loadAll();


  function loadAll() {
    return API.showtime(showtimeId).then(function (s) {
      showtime = s;
      price = CV.num(s.price);

      return Promise.all([
        API.movie(s.movie),
        API.seatMap(showtimeId)
      ]);
    }).then(function (res) {
      movie = res[0];
      seatMap = res[1];
      paintHeader();
      paintPlan();
      restore();
      sync();
    }, function (e2) {
      CV.failed(rowsEl, e2.status === 404 ? { message: 'That screening no longer exists.' } : e2);
    });
  }


  /* ── header and breadcrumb ───────────────────────────────── */
  function paintHeader() {
    document.title = 'Seats — ' + movie.title + ' — CineVault';

    $('#planEyebrow').textContent =
      seatMap.hall + ' · ' + CV.longDate(showtime.start_time) + ' · ' + CV.clock(showtime.start_time);
    $('#planTitle').textContent = movie.title;

    var crumb = $('#crumbFilm');
    crumb.textContent = movie.title;
    crumb.href = 'movie.html?id=' + movie.id;

    /* One price per screening — Showtime.price is the whole story, so
       the old standard/premium/recliner legend has nothing to describe. */
    $('#seatPrice').textContent = CV.money(price);
  }


  /* ── the plan ────────────────────────────────────────────── */
  function paintPlan() {
    var byRow = {};
    var order = [];

    seatMap.seats.forEach(function (s) {
      if (!byRow[s.row]) { byRow[s.row] = []; order.push(s.row); }
      byRow[s.row].push(s);
    });

    order.sort(function (a, b) { return a - b; });

    if (!order.length) {
      rowsEl.innerHTML = '<p class="times__none">This hall has no seats yet.</p>';
      return;
    }

    /* an aisle down the middle, but only in a hall wide enough to have
       one — a five-seat row split in two just looks broken */
    var widest = Math.max.apply(null, order.map(function (r) { return byRow[r].length; }));
    var aisleAfter = widest >= 8 ? Math.ceil(widest / 2) : 0;

    rowsEl.innerHTML = order.map(function (r) {
      var seats = byRow[r].slice().sort(function (a, b) { return a.number - b.number; });
      var letter = rowLabel(seats[0]);

      var cells = seats.map(function (s, i) {
        var gap = aisleAfter && i === aisleAfter ? '<span class="gap"></span>' : '';
        var gone = s.status === 'booked';
        var label = s.label;

        return gap +
          '<button class="seat' + (gone ? ' is-taken' : '') + '" type="button"' +
          ' data-id="' + s.id + '" data-label="' + esc(label) + '"' +
          ' data-row="' + s.row + '" data-number="' + s.number + '"' +
          (gone ? ' disabled aria-disabled="true"' : ' aria-pressed="false"') +
          ' aria-label="Row ' + letter + ' seat ' + s.number + ', ' + CV.money(price) +
          (gone ? ', unavailable' : '') + '">' + s.number + '</button>';
      }).join('');

      return '<div class="row"><span class="row__id">' + letter + '</span>' +
             cells +
             '<span class="row__id">' + letter + '</span></div>';
    }).join('');
  }

  /* The gutter letter is whatever the API put in front of the seat
     number — 'A1' → 'A', and '27-1' → '27' in a hall too deep for
     letters. Derived from Seat.label rather than recomputed from the row
     number, so the gutter and the seats can never disagree about what
     this row is called. */
  function rowLabel(seat) {
    if (!seat) return '';
    var text = String(seat.label || '');
    var digits = String(seat.number);
    if (!text) return digits;
    return text.slice(0, text.length - digits.length).replace(/[-\s]$/, '') || digits;
  }


  /* ── selection ───────────────────────────────────────────── */
  rowsEl.addEventListener('click', function (e) {
    var el = e.target.closest('.seat');
    if (!el || el.disabled) return;

    CV.hideMsg(err);

    var id = parseInt(el.dataset.id, 10);
    var at = chosen.findIndex(function (s) { return s.id === id; });

    if (at > -1) {
      chosen.splice(at, 1);
      el.classList.remove('is-sel');
      el.setAttribute('aria-pressed', 'false');
    } else {
      if (chosen.length >= MAX) {
        note.textContent = 'You can book at most ' + MAX + ' seats at a time.';
        return;
      }
      chosen.push({
        id: id,
        label: el.dataset.label,
        row: parseInt(el.dataset.row, 10),
        number: parseInt(el.dataset.number, 10)
      });
      el.classList.add('is-sel');
      el.setAttribute('aria-pressed', 'true');
    }

    chosen.sort(function (a, b) { return a.row - b.row || a.number - b.number; });
    sync();
  });


  function draft() {
    return {
      showtimeId: showtime.id,
      movieId: movie.id,
      title: movie.title,
      hall: seatMap.hall,
      date: CV.dateKey(showtime.start_time),
      time: CV.clock(showtime.start_time),
      price: price,
      seats: chosen.slice()
    };
  }

  function sync() {
    CV.paintRail(draft());
    go.disabled = chosen.length === 0;
    note.textContent = chosen.length >= MAX
      ? 'That is the maximum of ' + MAX + ' seats per booking.'
      : defaultNote;
  }

  /* coming back from checkout should not lose the selection */
  function restore() {
    var prev = CV.loadBooking();
    if (!prev || prev.showtimeId !== showtime.id) return;

    (prev.seats || []).forEach(function (s) {
      var el = rowsEl.querySelector('.seat[data-id="' + s.id + '"]:not(.is-taken)');
      if (!el) return;
      el.classList.add('is-sel');
      el.setAttribute('aria-pressed', 'true');
      chosen.push(s);
    });
    chosen.sort(function (a, b) { return a.row - b.row || a.number - b.number; });
  }


  /* ── reserve, then hand over to checkout ─────────────────── */
  go.addEventListener('click', function () {
    if (!chosen.length) return;
    CV.hideMsg(err);

    var here = 'seats.html?showtime=' + showtime.id;

    if (!API.isLoggedIn()) {
      location.href = 'signin.html?next=' + encodeURIComponent(here);
      return;
    }

    go.disabled = true;
    go.innerHTML = '<svg><use href="#i-ticket"/></svg>Holding your seats…';

    API.createReservation(showtime.id, chosen.map(function (s) { return s.id; }))
      .then(function (reservation) {
        var b = draft();
        b.reservationId = reservation.id;
        b.total = CV.num(reservation.total_price);
        b.status = reservation.status;
        b.createdAt = reservation.created_at;
        CV.saveBooking(b);
        location.href = 'checkout.html';
      }, function (e2) {
        resetGo();

        /* IsVerified answers with its own message; send them where they
           can actually fix it rather than repeating the refusal. */
        if (e2.status === 403 && /verif/i.test(e2.message || '')) {
          location.href = 'verify.html?next=' + encodeURIComponent(here);
          return;
        }
        if (e2.status === 401) {
          location.href = 'signin.html?next=' + encodeURIComponent(here);
          return;
        }

        CV.showError(err, e2);

        /* Someone else took a seat between the plan loading and the
           click. Re-read the map so the screen tells the truth. */
        if (/booked|reserv/i.test(e2.message || '')) refreshMap();
      });
  });

  function resetGo() {
    go.disabled = chosen.length === 0;
    go.innerHTML = '<svg><use href="#i-ticket"/></svg>Continue to payment';
  }

  function refreshMap() {
    API.seatMap(showtimeId).then(function (map) {
      seatMap = map;
      var keep = chosen.slice();
      chosen = [];
      paintPlan();

      keep.forEach(function (s) {
        var el = rowsEl.querySelector('.seat[data-id="' + s.id + '"]:not(.is-taken)');
        if (!el) return;
        el.classList.add('is-sel');
        el.setAttribute('aria-pressed', 'true');
        chosen.push(s);
      });
      sync();
    }, function () {});
  }

})();
