/* ═══════════════════════════════════════════════════════════════
   CineVault — /tickets, the account's booking history.

   Backed by GET /reservations/, which the backend already scopes to
   the caller (get_queryset filters by request.user), so this page
   never asks for a user id and cannot be talked into showing someone
   else's bookings by editing the URL.

   The reservation itself is thin — showtime arrives as a bare id and
   seats as {row, number} — so the film, hall and start time are joined
   in from the catalogue the same way every other page does it.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CV = window.CV, API = window.CV_API, CAT = window.CV_CAT;
  var $ = CV.$, $$ = CV.$$, esc = CV.esc;

  var list = $('#bookings');
  if (!list) return;

  var countEl = $('#count');
  var emptyEl = $('#empty');

  /* The endpoint is IsAuthenticated, so an anonymous visitor would get
     a 401 and an error panel. Sending them to sign in first — and back
     here afterwards — is the same bounce the checkout page does. */
  if (!API.isLoggedIn()) {
    location.href = 'signin.html?next=' + encodeURIComponent('tickets.html');
    return;
  }

  /* The ten-minute hold matches the countdown=600 that
     reservations/serializers.py gives cancel_reservation_if_unpaid. */
  var HOLD_MS = 600 * 1000;

  var state = { filter: CV.param('filter', 'all') };
  var rows = [];

  CV.loading(list, 'Loading your bookings…');

  Promise.all([
    API.myReservations(),
    /* The catalogue is decoration: without it a booking still shows its
       seats, total and reference, just not the film's name. */
    CAT.load().catch(function () { return null; })
  ]).then(function (res) {
    rows = decorate(res[0], res[1]);
    wire();
    render();
  }, function (err) {
    CV.failed(list, err);
    if (countEl) countEl.textContent = '';
  });


  /* ── join reservations to the catalogue ──────────────────── */
  function decorate(reservations, cat) {
    var byShowtime = {};

    if (cat) {
      cat.movies.forEach(function (m) {
        (m._showtimes || []).forEach(function (s) {
          byShowtime[s.id] = { showtime: s, movie: m };
        });
      });
    }

    var now = Date.now();

    return reservations.map(function (r) {
      var join = byShowtime[r.showtime] || null;
      var s = join && join.showtime;

      var startsAt = s ? new Date(s.start_time).getTime() : NaN;
      var heldUntil = new Date(r.created_at).getTime() + HOLD_MS;

      return {
        id: r.id,
        status: r.status,
        total: CV.num(r.total_price),
        createdAt: r.created_at,

        movie: join && join.movie,
        showtimeId: r.showtime,
        showtime: s,
        title: join ? join.movie.title : 'Screening #' + r.showtime,
        hall: s ? s.hallName : '',
        startsAt: startsAt,

        /* Seat.label comes straight from the API — the house's A1/B3
           naming is the backend's to decide, not something to rebuild
           here and then keep in step by hand. */
        seats: (r.seats || [])
          .map(function (rs) { return rs.seat; })
          .filter(Boolean)
          .sort(function (a, b) { return a.row - b.row || a.number - b.number; })
          .map(function (seat) { return seat.label; }),

        isPast: !isNaN(startsAt) && startsAt < now,
        holdExpired: r.status === 'pending' && heldUntil < now
      };
    }).sort(function (a, b) {
      /* The API returns newest-created first, which buries the film you
         are about to see under whatever you booked most recently. This
         page is opened to answer "what am I going to next", so anything
         still to come leads, soonest first, and everything finished
         follows it most-recent-first. */
      if (a.isPast !== b.isPast) return a.isPast ? 1 : -1;
      if (isNaN(a.startsAt) && isNaN(b.startsAt)) return b.id - a.id;
      if (isNaN(a.startsAt)) return 1;
      if (isNaN(b.startsAt)) return -1;
      return a.isPast ? b.startsAt - a.startsAt : a.startsAt - b.startsAt;
    });
  }


  /* ── filtering ───────────────────────────────────────────── */
  function match(r) {
    if (state.filter === 'upcoming') return !r.isPast && r.status !== 'cancelled';
    if (state.filter === 'unpaid')   return r.status === 'pending';
    if (state.filter === 'past')     return r.isPast || r.status === 'cancelled';
    return true;
  }


  /* ── render ──────────────────────────────────────────────── */
  function render() {
    var shown = rows.filter(match);

    if (countEl) {
      countEl.textContent = rows.length
        ? shown.length + ' of ' + rows.length + ' booking' + (rows.length === 1 ? '' : 's')
        : '';
    }

    if (emptyEl) {
      emptyEl.classList.toggle('is-on', !shown.length);
      /* "You have never booked anything" and "this filter matches
         nothing" are different facts, and telling someone with four
         bookings to go pick a film reads as though the page lost them. */
      var msg = emptyEl.querySelector('p');
      if (msg && !shown.length) {
        msg.innerHTML = rows.length
          ? 'No bookings under that filter.'
          : 'Nothing here yet. <a href="movies.html" style="color:var(--accent)">Pick a film</a> ' +
            'and your bookings will show up on this page.';
      }
    }

    if (!shown.length) {
      list.innerHTML = '';
      return;
    }

    list.innerHTML = shown.map(card).join('');
    CV.reveal(list);
  }

  function card(r) {
    var when = !isNaN(r.startsAt)
      ? CV.longDate(r.showtime.start_time) + ' · ' + CV.clock(r.showtime.start_time)
      : 'Screening time unavailable';

    var art = r.movie
      ? '<div class="bcard__art" style="--p1:' + CV.hues(r.movie)[0] +
        ';--p2:' + CV.hues(r.movie)[1] + ';--p3:' + CV.hues(r.movie)[2] + '">' +
        posterInner(r.movie) + '</div>'
      : '<div class="bcard__art"><svg><use href="#i-film"/></svg></div>';

    return '' +
      '<article class="bcard reveal" data-id="' + r.id + '">' +
        art +
        '<div class="bcard__body">' +
          '<div class="bcard__head">' +
            '<h3>' + esc(r.title) + '</h3>' +
            badge(r) +
          '</div>' +
          '<p class="bcard__when">' +
            '<svg><use href="#i-cal"/></svg>' + esc(when) +
            (r.hall ? ' <span class="bcard__dot">·</span> ' + esc(r.hall) : '') +
          '</p>' +
          '<div class="bcard__seats">' +
            (r.seats.length
              ? r.seats.map(function (s) { return '<span class="tagseat">' + esc(s) + '</span>'; }).join('')
              : '<span class="rail__none">No seats on this booking</span>') +
          '</div>' +
        '</div>' +
        '<div class="bcard__side">' +
          '<small>Booking</small>' +
          '<b class="bcard__ref">#' + r.id + '</b>' +
          '<span class="bcard__total">' + CV.money(r.total) + '</span>' +
          actions(r) +
        '</div>' +
      '</article>';
  }

  function posterInner(m) {
    var img = API.mediaUrl(m.poster);
    return img
      ? '<img src="' + esc(img) + '" alt="" loading="lazy">'
      : '<span>' + esc(m.title) + '</span>';
  }

  /* Reservation.status is the backend's word on the booking; the hold
     and the screening date add the nuance it does not carry. */
  function badge(r) {
    if (r.status === 'cancelled') return '<span class="bstat bstat--off">Cancelled</span>';
    if (r.status === 'confirmed') {
      return r.isPast
        ? '<span class="bstat bstat--done">Watched</span>'
        : '<span class="bstat bstat--ok">Confirmed</span>';
    }
    return r.holdExpired
      ? '<span class="bstat bstat--off">Hold expired</span>'
      : '<span class="bstat bstat--wait">Awaiting payment</span>';
  }

  function actions(r) {
    if (r.status === 'confirmed') {
      return '<a class="btn btn--ghost btn--sm" href="confirmation.html?id=' + r.id + '">' +
             '<svg><use href="#i-ticket"/></svg>View ticket</a>';
    }
    if (r.status === 'pending' && !r.holdExpired) {
      return '<button class="btn btn--accent btn--sm" type="button" data-pay="' + r.id + '">' +
             '<svg><use href="#i-lock"/></svg>Pay now</button>';
    }
    if (r.movie) {
      return '<a class="btn btn--ghost btn--sm" href="movie.html?id=' + r.movie.id + '">' +
             '<svg><use href="#i-film"/></svg>Book again</a>';
    }
    return '';
  }


  /* ── resume an unpaid booking ────────────────────────────── */
  /* checkout.html reads the booking draft out of sessionStorage, which
     is empty if the reservation was started in another tab or on
     another day. Rebuilding the draft from what the API returned lets
     the existing checkout page finish a booking it never saw created —
     no new endpoint needed, since create-intent only wants the id. */
  function resume(r) {
    CV.saveBooking({
      reservationId: r.id,
      showtimeId: r.showtimeId,
      title: r.title,
      hall: r.hall,
      date: r.showtime ? r.showtime.start_time : null,
      time: r.showtime ? CV.clock(r.showtime.start_time) : '',
      price: r.showtime ? CV.num(r.showtime.price) : 0,
      seats: r.seats.map(function (label) { return { label: label }; }),
      total: r.total,
      status: r.status,
      createdAt: r.createdAt
    });
    location.href = 'checkout.html';
  }


  /* ── wiring ──────────────────────────────────────────────── */
  function wire() {
    $$('#filters .seg').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.filter === state.filter);
      b.addEventListener('click', function () {
        state.filter = b.dataset.filter;
        $$('#filters .seg').forEach(function (o) { o.classList.toggle('is-on', o === b); });
        render();
      });
    });

    list.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-pay]');
      if (!btn) return;
      var r = rows.filter(function (x) { return x.id === parseInt(btn.dataset.pay, 10); })[0];
      if (r) resume(r);
    });
  }

})();
