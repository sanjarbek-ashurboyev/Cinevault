/* ═══════════════════════════════════════════════════════════════
   CineVault — confirmation / a single ticket.

   Two ways in:
     confirmation.html            — straight out of checkout, rendered
                                    from the booking draft in this tab
     confirmation.html?id=<id>    — opened from My Bookings, rendered
                                    from GET /reservations/<id>/

   Either way the ticket's status is re-read from the API once it is on
   screen. That matters because the reservation flips to CONFIRMED in
   the Stripe webhook (payments/views.py), out of band from this page —
   the draft saved at checkout says only what Stripe told the browser,
   which is usually a second or two ahead of the backend.

   The reservation id IS the booking reference: there is no separate
   reference field on the model, and inventing one would mean showing
   the visitor a number nobody could look up.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CV = window.CV, API = window.CV_API, CAT = window.CV_CAT;
  var $ = CV.$;

  var ticket = $('#ticket');
  if (!ticket) return;

  var deepLinkId = CV.param('id', null);
  var draft = CV.loadBooking();

  /* CV.loading() replaces the section's markup wholesale, so the real
     ticket shell is stashed here — before anything can paint over it —
     and put back when the fetch lands. */
  var shell = $('.done').innerHTML;
  function restore() { $('.done').innerHTML = shell; }

  if (deepLinkId) {
    fromApi(parseInt(deepLinkId, 10));
  } else if (draft && draft.reservationId) {
    paint(fromDraft(draft));
    refresh(draft.reservationId);
  } else {
    nothing('No booking found', 'Nothing has been booked in this browser session.');
  }


  /* ── the two sources ─────────────────────────────────────── */

  function fromDraft(b) {
    return {
      id: b.reservationId,
      title: b.title,
      hall: b.hall,
      date: b.date,
      time: b.time,
      seats: (b.seats || []).map(function (s) { return s.label; }),
      total: b.total != null ? b.total : (b.seats || []).length * CV.num(b.price),
      status: b.status || 'pending',
      paymentStatus: b.paymentStatus,
      paymentIntentId: b.paymentIntentId
    };
  }

  /* A reservation on its own carries a bare showtime id, so the film,
     hall and start time are joined in from the catalogue — the same
     join the bookings list does. */
  function fromApi(id) {
    CV.loading($('.done'), 'Loading your ticket…');

    Promise.all([
      API.reservation(id),
      CAT ? CAT.load().catch(function () { return null; }) : Promise.resolve(null)
    ]).then(function (res) {
      var r = res[0], cat = res[1];
      var join = find(cat, r.showtime);
      var s = join && join.showtime;

      restore();

      paint({
        id: r.id,
        title: join ? join.movie.title : 'Screening #' + r.showtime,
        hall: s ? s.hallName : '',
        date: s ? s.start_time : null,
        time: s ? CV.clock(s.start_time) : '',
        /* Seat.label is the backend's to decide — see halls/serializers.py. */
        seats: (r.seats || [])
          .map(function (rs) { return rs.seat; })
          .filter(Boolean)
          .sort(function (a, b) { return a.row - b.row || a.number - b.number; })
          .map(function (seat) { return seat.label; }),
        total: CV.num(r.total_price),
        status: r.status
      });
    }, function (err) {
      restore();
      /* IsOwnerOrAdmin answers 403 for a booking that is not yours and
         404 for one that does not exist. Both are dead ends for the
         visitor, so they get the same plain sentence. */
      nothing(
        err.status === 403 || err.status === 404 ? 'Ticket not available' : 'Could not load ticket',
        err.status === 403 ? 'That booking belongs to a different account.'
          : err.status === 404 ? 'No booking with that reference exists.'
          : err.message
      );
    });
  }

  function find(cat, showtimeId) {
    if (!cat) return null;
    for (var i = 0; i < cat.movies.length; i++) {
      var list = cat.movies[i]._showtimes || [];
      for (var j = 0; j < list.length; j++) {
        if (list[j].id === showtimeId) return { movie: cat.movies[i], showtime: list[j] };
      }
    }
    return null;
  }

  /* ── render ──────────────────────────────────────────────── */
  function paint(v) {
    var confirmed = v.status === 'confirmed';
    var cancelled = v.status === 'cancelled';
    /* Straight from checkout the row is still PENDING for a moment —
       Stripe's 'succeeded' is the honest thing to show until the
       webhook lands. */
    var settling = !confirmed && !cancelled && v.paymentStatus === 'succeeded';

    document.title = 'Booking #' + v.id + ' — CineVault';

    $('#doneTitle').textContent =
      cancelled ? 'This booking was cancelled'
      : confirmed ? 'You’re booked'
      : settling ? 'Payment received'
      : 'Booking held';

    $('#doneSub').textContent =
      cancelled ? 'Booking #' + v.id + ' is no longer valid. Nothing has been charged for it.'
      : confirmed ? 'Your payment went through. Quote booking #' + v.id + ' at the door.'
      : settling ? 'Your payment is still settling with the bank. Booking #' + v.id +
                   ' will be confirmed as soon as it clears.'
      : 'Booking #' + v.id + ' is holding your seats but has not been paid for yet.';

    if (cancelled) $('.done__tick').hidden = true;

    $('#tFilm').textContent = v.title;
    $('#tSub').textContent = v.hall || '';
    $('#tDate').textContent = CV.longDate(v.date);
    $('#tTime').textContent = v.time || '—';
    $('#tSeats').textContent = v.seats.length ? v.seats.join(', ') : '—';
    $('#tTotal').textContent = CV.money(v.total);
    $('#tRef').textContent = '#' + v.id;

    $('#tNote').textContent =
      cancelled ? 'Cancelled bookings release their seats back to the screening straight away.'
      : confirmed ? 'Your seats are confirmed. Show this reference at the door.'
      : settling ? 'Do not pay again. The booking confirms itself once the bank releases the payment.'
      : 'Seats are held for ten minutes from booking. Pay before then to keep them.';

    wireActions(v);
  }

  function nothing(title, sub) {
    var t = $('#ticket');
    if (t) t.hidden = true;
    var acts = $('.done__acts'); if (acts) acts.hidden = true;
    var tick = $('.done__tick'); if (tick) tick.hidden = true;
    $('#doneTitle').textContent = title;
    $('#doneSub').textContent = sub;
    var none = $('#noBooking'); if (none) none.classList.add('is-on');
  }


  /* ── the backend's word on the status ────────────────────── */
  /* The draft was written before the webhook ran, so the ticket on
     screen can say "settling" when the server already says confirmed.
     A failure here is not worth surfacing — what is painted is still
     what the browser witnessed. */
  function refresh(id) {
    API.reservation(id).then(function (r) {
      var v = fromDraft(draft);
      v.status = r.status;
      v.total = CV.num(r.total_price);
      paint(v);
    }, function () {});
  }


  /* ── print / save ────────────────────────────────────────── */
  function wireActions(v) {
    var printBtn = $('#printBtn');
    if (printBtn) printBtn.onclick = function () { window.print(); };

    var saveBtn = $('#saveBtn');
    if (saveBtn) saveBtn.onclick = function () {
      var lines = [
        'CineVault booking #' + v.id,
        '',
        v.title,
        v.hall,
        CV.longDate(v.date) + (v.time ? ' at ' + v.time : ''),
        'Seats: ' + v.seats.join(', '),
        'Total: ' + CV.money(v.total),
        'Status: ' + v.status,
        v.paymentIntentId ? 'Payment: ' + v.paymentIntentId : ''
      ].filter(Boolean).join('\n');

      var blobUrl = URL.createObjectURL(new Blob([lines], { type: 'text/plain' }));
      var a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'cinevault-' + v.id + '.txt';
      a.click();
      URL.revokeObjectURL(blobUrl);
    };

    /* The draft has done its job once the purchase is finished.
       Clearing it stops a reload re-presenting a done deal as live, and
       stops the seats page restoring a selection already paid for. */
    var again = $('#againBtn');
    if (again) again.onclick = function () { CV.clearBooking(); };
  }

})();
