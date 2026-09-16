/* ═══════════════════════════════════════════════════════════════
   CineVault — sign in, register and password reset.

   Three modes share one card: 'in', 'up' and 'reset'. The mode is in
   the query string (?mode=up) so the nav, the footer and the seats
   page can all link straight to the right one.

   ?next= carries the page that sent the visitor here — the seats page
   uses it so signing in returns you to the seat you were choosing
   instead of dumping you on the home page.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CV = window.CV, API = window.CV_API;
  var $ = CV.$, $$ = CV.$$;

  var tabs = $('#authTabs');
  if (!tabs) return;

  var form = $('#authForm');
  var err = $('#authError');
  var go = $('#authGo');
  var goLabel = $('#authGoLabel');

  var nameRow = $('#nameRow');
  var first = $('#a-first');
  var last = $('#a-last');
  var email = $('#a-email');
  var passField = $('#passField');
  var pass = $('#a-pass');
  var confirmField = $('#confirmField');
  var confirm = $('#a-confirm');
  var codeField = $('#codeField');
  var code = $('#a-code');
  var newPassField = $('#newPassField');
  var newPass = $('#a-newpass');

  var next = CV.param('next', '');

  /* An open redirect would let a crafted link bounce a freshly signed-in
     visitor to another site, so only same-directory pages are honoured. */
  function safeNext() {
    if (!next) return 'index.html';
    if (/^[a-z0-9_-]+\.html(\?[^#]*)?$/i.test(next)) return next;
    return 'index.html';
  }

  var COPY = {
    in: {
      title: 'Welcome back',
      sub: 'Sign in to book seats and see your reservations.',
      go: 'Sign in',
      alt: 'New to CineVault? <a href="#" data-go="up">Create an account</a>',
      hint: '<a href="#" data-go="reset">Forgot your password?</a>'
    },
    up: {
      title: 'Create account',
      sub: 'One account for every screening — you will need to confirm your email before booking.',
      go: 'Create account',
      alt: 'Already have an account? <a href="#" data-go="in">Sign in</a>',
      hint: 'At least 8 characters, and not entirely numeric.'
    },
    reset: {
      title: 'Reset password',
      sub: 'We will email you a six-digit code. Enter it below with your new password.',
      go: 'Send reset code',
      alt: 'Remembered it? <a href="#" data-go="in">Back to sign in</a>',
      hint: ''
    }
  };

  var mode = 'in';
  var resetSent = false;

  function setMode(m) {
    mode = COPY[m] ? m : 'in';
    resetSent = false;
    var c = COPY[mode];

    $$('.seg', tabs).forEach(function (b) {
      var on = b.dataset.mode === mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });

    $('#authTitle').textContent = c.title;
    $('#authSub').textContent = c.sub;
    goLabel.textContent = c.go;
    $('#authAlt').innerHTML = c.alt;
    $('#passHint').innerHTML = c.hint;

    nameRow.hidden = mode !== 'up';
    first.required = last.required = mode === 'up';

    passField.hidden = mode === 'reset';
    pass.required = mode !== 'reset';
    pass.setAttribute('autocomplete', mode === 'up' ? 'new-password' : 'current-password');

    confirmField.hidden = mode !== 'up';
    confirm.required = mode === 'up';

    /* the reset code and new password only appear once a code is sent */
    codeField.hidden = true;
    newPassField.hidden = true;
    code.required = newPass.required = false;

    CV.hideMsg(err);
    document.title = c.title + ' — CineVault';
  }

  function setResetStep2() {
    resetSent = true;
    codeField.hidden = false;
    newPassField.hidden = false;
    confirmField.hidden = false;
    code.required = newPass.required = confirm.required = true;
    goLabel.textContent = 'Set new password';
    $('#authSub').textContent = 'Check your inbox for the six-digit code, then choose a new password.';
    code.focus();
  }

  tabs.addEventListener('click', function (e) {
    var b = e.target.closest('.seg');
    if (b) setMode(b.dataset.mode);
  });

  /* the switcher links under the form and in the password hint */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-go]');
    if (!a) return;
    e.preventDefault();
    setMode(a.dataset.go);
  });


  /* ── submit ──────────────────────────────────────────────── */
  function busy(on, label) {
    go.disabled = on;
    goLabel.textContent = on ? (label || 'One moment…') : COPY[mode].go;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    CV.hideMsg(err);

    if (!form.checkValidity()) {
      CV.showError(err, { message: 'Please fill in every field with a valid value.' });
      return;
    }

    if (mode === 'in') return doLogin();
    if (mode === 'up') return doRegister();
    return resetSent ? doResetConfirm() : doResetRequest();
  });


  function doLogin() {
    busy(true, 'Signing in…');

    API.login(email.value.trim(), pass.value).then(function () {
      location.href = safeNext();
    }, function (e2) {
      busy(false);
      /* SimpleJWT answers a wrong password and an unknown address with
         the same message, which is the correct thing for it to do. */
      CV.showError(err, e2);
    });
  }


  function doRegister() {
    if (pass.value !== confirm.value) {
      CV.showError(err, { message: 'Passwords do not match.' });
      return;
    }
    busy(true, 'Creating account…');

    var address = email.value.trim();

    API.register({
      first_name: first.value.trim(),
      last_name: last.value.trim(),
      email: address,
      password: pass.value,
      confirm_password: confirm.value
    }).then(function () {
      /* The account exists but cannot book yet: reservations sit behind
         the IsVerified permission, so the next stop is the code screen. */
      location.href = 'verify.html?email=' + encodeURIComponent(address) +
                      (next ? '&next=' + encodeURIComponent(next) : '');
    }, function (e2) {
      busy(false);
      CV.showError(err, e2);
    });
  }


  function doResetRequest() {
    busy(true, 'Sending…');

    API.passwordResetRequest(email.value.trim()).then(function () {
      busy(false);
      setResetStep2();
    }, function (e2) {
      busy(false);
      CV.showError(err, e2);
    });
  }


  function doResetConfirm() {
    if (newPass.value !== confirm.value) {
      CV.showError(err, { message: 'Passwords do not match.' });
      return;
    }
    busy(true, 'Saving…');

    API.passwordResetConfirm({
      email: email.value.trim(),
      code: code.value.trim(),
      new_password: newPass.value,
      confirm_password: confirm.value
    }).then(function () {
      setMode('in');
      CV.showOk(err, 'Password changed. You can sign in now.');
    }, function (e2) {
      busy(false);
      CV.showError(err, e2);
    });
  }


  /* already signed in? nothing here applies */
  if (API.isLoggedIn()) {
    location.replace(safeNext());
    return;
  }

  setMode(CV.param('mode', 'in'));

})();
