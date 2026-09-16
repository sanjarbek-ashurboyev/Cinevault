/* ═══════════════════════════════════════════════════════════════
   CineVault — email verification.

   Reservations sit behind the IsVerified permission, so an account is
   useless for booking until the six-digit code has been accepted. This
   page is where registration lands, and where the nav's "Verify email"
   badge links to.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CV = window.CV, API = window.CV_API;
  var $ = CV.$;

  var form = $('#verifyForm');
  if (!form) return;

  var email = $('#v-email');
  var code = $('#v-code');
  var err = $('#verifyError');
  var go = $('#verifyGo');
  var goLabel = $('#verifyGoLabel');
  var resend = $('#resendBtn');

  var next = CV.param('next', '');

  email.value = CV.param('email', '');

  /* signed in already? the profile knows the address and whether this
     page is even needed */
  if (API.isLoggedIn()) {
    API.me().then(function (me) {
      if (!email.value) email.value = me.email;
      if (me.is_verified) {
        $('#verifyCard').hidden = true;
        $('#verifyDone').hidden = false;
        $('#verifyDoneMsg').textContent = 'Your email is already verified — you are ready to book.';
      }
    }, function () {});
  }

  if (!email.value) email.focus(); else code.focus();

  /* digits only, and submit-ready at six */
  code.addEventListener('input', function () {
    code.value = code.value.replace(/\D/g, '').slice(0, 6);
  });


  function busy(on, label) {
    go.disabled = on;
    goLabel.textContent = on ? label : 'Verify email';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    CV.hideMsg(err);

    if (code.value.length !== 6) {
      CV.showError(err, { message: 'Enter the six-digit code from the email.' });
      return;
    }

    busy(true, 'Checking…');

    API.verifyEmail(email.value.trim(), code.value).then(function () {
      $('#verifyCard').hidden = true;
      $('#verifyDone').hidden = false;

      var link = $('#verifyDoneLink');
      link.href = API.isLoggedIn()
        ? (next || 'index.html')
        : 'signin.html' + (next ? '?next=' + encodeURIComponent(next) : '');
      link.textContent = API.isLoggedIn() ? 'Continue' : 'Sign in';

      /* the nav badge is driven by is_verified, so refresh it */
      if (API.isLoggedIn() && window.CV_LAYOUT) {
        API.me().then(function (me) { window.CV_LAYOUT.paintAuth(me); }, function () {});
      }
    }, function (e2) {
      busy(false);

      CV.showError(err, e2);

      /* A code that the server has no record of is the common failure
         here, and a fresh one is the only way forward — put the resend
         button under the visitor's nose instead of making them hunt. */
      if (/expired|not found|invalid/i.test(e2.message || '')) {
        resend.classList.add('is-urgent');
      }
    });
  });


  resend.addEventListener('click', function () {
    CV.hideMsg(err);

    var address = email.value.trim();
    if (!address) {
      CV.showError(err, { message: 'Enter your email address first.' });
      return;
    }

    resend.disabled = true;
    resend.textContent = 'Sending…';

    API.resendVerification(address).then(function () {
      resend.classList.remove('is-urgent');
      CV.showOk(err, 'A new code is on its way to ' + address + '.');
      code.value = '';
      code.focus();
      cooldown(30);
    }, function (e2) {
      resend.disabled = false;
      resend.textContent = 'Resend code';
      CV.showError(err, e2);
    });
  });

  /* stops impatient double-sends piling mail into the Celery queue */
  function cooldown(seconds) {
    var left = seconds;
    resend.disabled = true;

    var tick = setInterval(function () {
      left--;
      resend.textContent = left > 0 ? 'Resend in ' + left + 's' : 'Resend code';
      if (left <= 0) {
        clearInterval(tick);
        resend.disabled = false;
      }
    }, 1000);

    resend.textContent = 'Resend in ' + left + 's';
  }

})();
