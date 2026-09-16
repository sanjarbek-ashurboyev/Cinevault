/* ═══════════════════════════════════════════════════════════════
   CineVault — checkout.

   The reservation already exists by the time this page loads (the
   seats page created it), so there is nothing to re-post. What happens
   here is payment:

     POST /payments/create-intent/<reservation_id>/  → client_secret
     stripe.confirmPayment(...)                      → charge the card

   The reservation only flips to CONFIRMED when Stripe calls the
   backend's webhook, which is a separate conversation the browser is
   not part of. So this page reports what Stripe told it, and says
   plainly that the seats are confirmed server-side.

   The backend creates the intent with allow_redirects: "never", so
   confirmPayment runs with redirect: 'if_required' and never needs a
   return_url.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CV = window.CV, API = window.CV_API, CFG = window.CV_CONFIG;
  var $ = CV.$;

  var form = $('#payForm');
  if (!form) return;

  var booking = CV.loadBooking();
  var wrap = $('#bookingWrap');
  var err = $('#payError');
  var payBtn = $('#pay');

  var stripe = null, elements = null;
  var clientSecret = null;

  /* ── nothing to pay for ──────────────────────────────────── */
  if (!booking || !booking.reservationId || !booking.seats || !booking.seats.length) {
    wrap.innerHTML =
      '<div class="empty is-on" style="grid-column:1/-1">' +
      '<svg><use href="#i-seat"/></svg>' +
      '<p>You have not reserved any seats yet. ' +
      '<a href="movies.html" style="color:var(--accent)">Choose a screening</a> to start a booking.</p></div>';
    return;
  }

  if (!API.isLoggedIn()) {
    location.href = 'signin.html?next=' + encodeURIComponent('checkout.html');
    return;
  }

  document.title = 'Checkout — ' + booking.title + ' — CineVault';

  CV.paintRail(booking);

  /* The rail computes seats × price; the reservation carries the total
     the backend actually recorded. Show that one — it is what will be
     charged — and let the mismatch be visible if the two ever differ. */
  if (booking.total != null) {
    $('#rTotal').textContent = CV.money(booking.total);
  }

  $('#backSeats').href = 'seats.html?showtime=' + booking.showtimeId;


  /* ── the ten-minute hold ─────────────────────────────────── */
  /* reservations/serializers.py schedules cancel_reservation_if_unpaid
     with countdown=600, so the seats are gone ten minutes after the
     reservation row was created. */
  (function countdown() {
    var el = $('#holdTimer');
    if (!el || !booking.createdAt) return;

    var deadline = new Date(booking.createdAt).getTime() + 600 * 1000;
    if (isNaN(deadline)) return;

    function tick() {
      var left = Math.floor((deadline - Date.now()) / 1000);

      if (left <= 0) {
        el.textContent = 'This hold has expired.';
        el.classList.add('is-late');
        expire();
        return;
      }

      el.textContent = 'Seats held for ' +
        Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      el.classList.toggle('is-late', left < 60);
      setTimeout(tick, 1000);
    }
    tick();
  })();

  function expire() {
    payBtn.disabled = true;
    CV.showError(err, {
      message: 'The ten-minute hold on these seats has run out, so the reservation was cancelled. ' +
               'Pick your seats again to start a new one.'
    });
    $('#backSeats').textContent = 'Choose seats again';
  }


  /* ── who is paying ───────────────────────────────────────── */
  /* Prefilled from the signed-in profile. These are not stored by the
     backend — there is no endpoint for them — they travel to Stripe as
     billing details on the payment, which is where they are of use. */
  API.me().then(function (me) {
    if (!$('#c-first').value) $('#c-first').value = me.first_name || '';
    if (!$('#c-last').value) $('#c-last').value = me.last_name || '';
    if (!$('#c-email').value) $('#c-email').value = me.email || '';
  }, function () {});


  /* ── Stripe ──────────────────────────────────────────────── */
  var mountEl = $('#paymentElement');

  if (typeof Stripe !== 'function') {
    CV.showError(err, { message: 'Stripe.js did not load. Check your connection and reload the page.' });
    payBtn.disabled = true;
    return;
  }

  stripe = Stripe(CFG.STRIPE_PUBLISHABLE_KEY);

  mountEl.innerHTML = '<p class="loading">Preparing secure payment…</p>';
  payBtn.disabled = true;

  API.createPaymentIntent(booking.reservationId).then(function (data) {
    clientSecret = data.client_secret;

    elements = stripe.elements({
      clientSecret: clientSecret,
      appearance: appearance()
    });

    mountEl.innerHTML = '';
    elements.create('payment', { layout: 'tabs' }).mount(mountEl);

    payBtn.disabled = false;
  }, function (e2) {
    mountEl.innerHTML = '';

    /* CreatePaymentIntentView refuses anything that is not still
       PENDING — an expired hold is the usual reason. */
    if (e2.status === 400) {
      CV.showError(err, {
        message: 'This reservation can no longer be paid for — it was most likely cancelled when the ' +
                 'ten-minute hold expired. Choose your seats again to start over.'
      });
    } else if (e2.status === 404) {
      CV.showError(err, { message: 'That reservation was not found on your account.' });
    } else {
      CV.showError(err, e2);
    }
    payBtn.disabled = true;
  });

  /* match the Payment Element to the surrounding dark card */
  function appearance() {
    var css = getComputedStyle(document.documentElement);
    var pick = function (name, fallback) {
      return (css.getPropertyValue(name) || '').trim() || fallback;
    };
    return {
      theme: 'night',
      variables: {
        colorPrimary: pick('--accent', '#e8b44a'),
        colorBackground: pick('--card', '#16161f'),
        colorText: pick('--text', '#f2f2f5'),
        colorDanger: pick('--error', '#ff6b6b'),
        fontFamily: 'DM Sans, system-ui, sans-serif',
        borderRadius: '10px'
      }
    };
  }


  /* ── pay ─────────────────────────────────────────────────── */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    CV.hideMsg(err);

    if (!elements || !clientSecret) return;

    var needed = ['#c-first', '#c-last', '#c-email'];
    var bad = needed.filter(function (sel) { return !$(sel).value.trim(); });

    if (bad.length || !form.checkValidity()) {
      var firstBad = $(bad[0] || '#c-first');
      firstBad.focus();
      firstBad.classList.add('is-bad');
      setTimeout(function () { firstBad.classList.remove('is-bad'); }, 1600);
      return;
    }

    payBtn.disabled = true;
    payBtn.innerHTML = '<svg><use href="#i-lock"/></svg>Processing…';

    stripe.confirmPayment({
      elements: elements,
      redirect: 'if_required',
      confirmParams: {
        payment_method_data: {
          billing_details: {
            name: $('#c-first').value.trim() + ' ' + $('#c-last').value.trim(),
            email: $('#c-email').value.trim(),
            phone: $('#c-phone').value.trim() || undefined
          }
        }
      }
    }).then(function (result) {

      if (result.error) {
        payBtn.disabled = false;
        payBtn.innerHTML = '<svg><use href="#i-lock"/></svg>Pay &amp; confirm';
        CV.showError(err, { message: result.error.message || 'The payment could not be completed.' });
        return;
      }

      var intent = result.paymentIntent;

      if (intent && (intent.status === 'succeeded' || intent.status === 'processing')) {
        booking.paymentStatus = intent.status;
        booking.paymentIntentId = intent.id;
        booking.name = $('#c-first').value.trim() + ' ' + $('#c-last').value.trim();
        booking.email = $('#c-email').value.trim();
        booking.paidAt = new Date().toISOString();
        CV.saveBooking(booking);
        location.href = 'confirmation.html';
        return;
      }

      payBtn.disabled = false;
      payBtn.innerHTML = '<svg><use href="#i-lock"/></svg>Pay &amp; confirm';
      CV.showError(err, {
        message: 'Payment finished with an unexpected status (' +
                 ((intent && intent.status) || 'unknown') + '). Nothing has been confirmed.'
      });
    });
  });

})();
