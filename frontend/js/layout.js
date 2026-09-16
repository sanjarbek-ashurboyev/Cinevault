/* ═══════════════════════════════════════════════════════════════
   CineVault — shared page chrome.

   Static hosting has no {% include %}, so the icon sprite, top nav,
   mobile drawer and footer live here and are injected into every page.
   One source of truth: edit this file, every page follows.

   The nav is injected synchronously, at the position of this script's
   own tag, so it paints with the rest of the document and never flashes
   in. The footer is appended on DOMContentLoaded — it is below the fold
   and nothing about the page jumps when it lands.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var API = window.CV_API;

  /* Which nav link to mark active. Pages set data-page on <body>;
     falling back to the filename keeps 404.html working. */
  var page = document.body.getAttribute('data-page') ||
             (location.pathname.split('/').pop() || 'index.html').replace('.html', '');

  var tab = new URLSearchParams(location.search).get('tab');

  function active(name, wantSoon) {
    if (name !== page) return '';
    if (name === 'movies') {
      var isSoon = tab === 'soon';
      if (wantSoon !== isSoon) return '';
    }
    return ' class="is-active"';
  }


  var SPRITE = "<svg class=\"sprite\" aria-hidden=\"true\">\n  <symbol id=\"i-search\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20.5 20.5-3.8-3.8\"/></symbol>\n  <symbol id=\"i-pin\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z\"/><circle cx=\"12\" cy=\"10\" r=\"2.4\"/></symbol>\n  <symbol id=\"i-chev\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m6 9 6 6 6-6\"/></symbol>\n  <symbol id=\"i-cal\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2.5\"/><path d=\"M3 10h18M8 3v4M16 3v4\"/></symbol>\n  <symbol id=\"i-star\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"m12 3.2 2.6 5.5 6 .9-4.3 4.2 1 6L12 17l-5.3 2.8 1-6-4.3-4.2 6-.9z\"/></symbol>\n  <symbol id=\"i-play\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M8 5.2v13.6L19 12z\"/></symbol>\n  <symbol id=\"i-ticket\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linejoin=\"round\"><path d=\"M4 8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5v1.2a2.3 2.3 0 0 0 0 4.6v1.2a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 15.5v-1.2a2.3 2.3 0 0 0 0-4.6z\"/><path d=\"M14.5 6.5v11\" stroke-dasharray=\"2.2 2.6\"/></symbol>\n  <symbol id=\"i-bell\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M18 9.5a6 6 0 1 0-12 0c0 5.5-2 6.5-2 6.5h16s-2-1-2-6.5z\"/><path d=\"M10.4 19.5a2 2 0 0 0 3.2 0\"/></symbol>\n  <symbol id=\"i-menu\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\"><path d=\"M4 7h16M4 12h16M4 17h16\"/></symbol>\n  <symbol id=\"i-close\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\"><path d=\"M6 6 18 18M18 6 6 18\"/></symbol>\n  <symbol id=\"i-up\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 19V6M6 12l6-6 6 6\"/></symbol>\n  <symbol id=\"i-arrow\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M5 12h13M12.5 6l6 6-6 6\"/></symbol>\n  <symbol id=\"i-clock\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"8.2\"/><path d=\"M12 7.6v4.8l3 1.8\"/></symbol>\n  <symbol id=\"i-user\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"8\" r=\"3.4\"/><path d=\"M5.2 20c0-3.5 3-5.8 6.8-5.8s6.8 2.3 6.8 5.8\"/></symbol>\n  <symbol id=\"i-screen\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"2.5\" y=\"4.5\" width=\"19\" height=\"13\" rx=\"2.5\"/><path d=\"M8 20.5h8\"/></symbol>\n  <symbol id=\"i-motion\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 8h10a2.8 2.8 0 1 0-2.8-2.8\"/><path d=\"M3 12h13a2.8 2.8 0 1 1-2.8 2.8\"/><path d=\"M3 16h6\"/></symbol>\n  <symbol id=\"i-sound\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M11 5 6.5 9H3v6h3.5L11 19z\"/><path d=\"M15 9.4a3.6 3.6 0 0 1 0 5.2M17.8 6.6a7.6 7.6 0 0 1 0 10.8\"/></symbol>\n  <symbol id=\"i-seat\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6.5 11V6.8A2.3 2.3 0 0 1 8.8 4.5h6.4a2.3 2.3 0 0 1 2.3 2.3V11\"/><path d=\"M4.2 11.8h15.6v5.4H4.2z\"/><path d=\"M6.5 17.2v2.3M17.5 17.2v2.3\"/></symbol>\n  <symbol id=\"i-tag\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12.6 3.5H20v7.4l-8.6 8.6a2 2 0 0 1-2.8 0l-4.6-4.6a2 2 0 0 1 0-2.8z\"/><circle cx=\"16.4\" cy=\"7.6\" r=\"1.3\"/></symbol>\n  <symbol id=\"i-fb\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M13.2 21v-7.5h2.5l.4-2.9h-2.9V8.7c0-.8.2-1.4 1.5-1.4h1.5V4.7c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.2H7.8v2.9h2.5V21z\"/></symbol>\n  <symbol id=\"i-x\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M3.8 3.5h5l4 5.5 4.6-5.5h2.6l-6 7.2 6.7 9.8h-5l-4.3-6.2-5.2 6.2H3.6l6.6-7.9z\"/></symbol>\n  <symbol id=\"i-ig\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\"><rect x=\"3.4\" y=\"3.4\" width=\"17.2\" height=\"17.2\" rx=\"5\"/><circle cx=\"12\" cy=\"12\" r=\"4\"/><circle cx=\"16.9\" cy=\"7.1\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/></symbol>\n  <symbol id=\"i-yt\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linejoin=\"round\"><rect x=\"2.6\" y=\"5.6\" width=\"18.8\" height=\"12.8\" rx=\"4.2\"/><path d=\"m10.4 9.6 4.6 2.4-4.6 2.4z\" fill=\"currentColor\" stroke=\"none\"/></symbol>\n  <symbol id=\"i-check\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m5 12.5 4.5 4.5L19 7.5\"/></symbol>\n  <symbol id=\"i-card\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linejoin=\"round\"><rect x=\"2.5\" y=\"5\" width=\"19\" height=\"14\" rx=\"2.5\"/><path d=\"M2.5 9.6h19\"/></symbol>\n  <symbol id=\"i-wallet\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3.5 8.5A2.5 2.5 0 0 1 6 6h12a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5z\"/><path d=\"M16.2 12.6h4.3\"/></symbol>\n  <symbol id=\"i-apple\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M16.1 12.7c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.15-2.7.8-3.4.8s-1.8-.79-2.9-.77c-1.5.02-2.9.87-3.7 2.2-1.6 2.76-.4 6.83 1.1 9.06.75 1.1 1.6 2.3 2.8 2.26 1.1-.04 1.5-.72 2.9-.72s1.7.72 2.9.7c1.2-.03 1.95-1.1 2.7-2.2.84-1.26 1.19-2.5 1.2-2.56-.03-.01-2.3-.89-2.3-3.5z\"/><path d=\"M14.2 6.2c.6-.75 1-1.8.9-2.85-.87.04-1.94.58-2.57 1.32-.56.65-1.05 1.7-.92 2.72.97.08 1.96-.5 2.59-1.19z\"/></symbol>\n  <symbol id=\"i-google\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3.9a8.1 8.1 0 1 0 7.9 9.9H12\"/></symbol>\n  <symbol id=\"i-sort\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"><path d=\"M4 7h14M4 12h9M4 17h5\"/></symbol>\n  <symbol id=\"i-film\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"4.5\" width=\"18\" height=\"15\" rx=\"2.5\"/><path d=\"M8 4.5v15M16 4.5v15M3 12h18\"/></symbol>\n  <symbol id=\"i-print\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M7 9.5V4h10v5.5\"/><path d=\"M7 17H5.5A2.5 2.5 0 0 1 3 14.5v-3A2.5 2.5 0 0 1 5.5 9h13a2.5 2.5 0 0 1 2.5 2.5v3a2.5 2.5 0 0 1-2.5 2.5H17\"/><rect x=\"7\" y=\"14\" width=\"10\" height=\"6\" rx=\"1.4\"/></symbol>\n  <symbol id=\"i-download\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14\"/></symbol>\n  <symbol id=\"i-lock\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"4.5\" y=\"10\" width=\"15\" height=\"10\" rx=\"2.5\"/><path d=\"M8 10V7.6a4 4 0 0 1 8 0V10\"/></symbol>\n  <symbol id=\"i-mail\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"2.8\" y=\"5\" width=\"18.4\" height=\"14\" rx=\"2.5\"/><path d=\"m3.6 7.2 8.4 5.9 8.4-5.9\"/></symbol>\n</svg>";


  var NAV =
    '<nav class="nav" id="nav">' +
      '<div class="nav__inner">' +
        '<button class="nav__burger" id="burger" aria-label="Open menu"><svg><use href="#i-menu"/></svg></button>' +

        '<a href="index.html" class="logo" aria-label="CineVault home">CINE<span>VAULT</span></a>' +

        '<ul class="nav__links">' +
          '<li><a href="movies.html"' + active('movies', false) + '>Now Showing</a></li>' +
          '<li><a href="movies.html?tab=soon"' + active('movies', true) + '>Coming Soon</a></li>' +
          '<li><a href="cinemas.html"' + active('cinemas') + '>Cinemas</a></li>' +
          /* Only for signed-in visitors: GET /reservations/ is
             IsAuthenticated, so the page would only bounce anyone else
             straight to the sign-in form. */
          (API.isLoggedIn()
            ? '<li><a href="tickets.html"' + active('tickets') + '>My Bookings</a></li>'
            : '') +
        '</ul>' +

        '<div class="nav__actions">' +
          '<div class="search">' +
            '<svg class="search__i"><use href="#i-search"/></svg>' +
            '<input type="search" id="q" placeholder="Search movies…" aria-label="Search">' +
          '</div>' +
          '<div id="authSlot" class="authslot"></div>' +
        '</div>' +
      '</div>' +
    '</nav>';


  var DRAWER =
    '<div class="drawer" id="drawer" aria-hidden="true">' +
      '<div class="drawer__panel">' +
        '<div class="drawer__top">' +
          '<a href="index.html" class="logo" aria-label="CineVault home">CINE<span>VAULT</span></a>' +
          '<button class="icon-btn" id="drawerClose" aria-label="Close menu"><svg><use href="#i-close"/></svg></button>' +
        '</div>' +
        '<a href="movies.html">Now Showing</a>' +
        '<a href="movies.html?tab=soon">Coming Soon</a>' +
        '<a href="cinemas.html">Cinemas</a>' +
        (API.isLoggedIn() ? '<a href="tickets.html">My Bookings</a>' : '') +
        '<div id="authSlotDrawer"></div>' +
      '</div>' +
    '</div>';


  var FOOTER =
    '<footer class="foot">' +
      '<div class="wrap foot__in">' +
        '<div class="foot__brand">' +
          '<a href="index.html" class="logo">CINE<span>VAULT</span></a>' +
          '<p>Browse what is on, pick your seat and pay in seconds.</p>' +
        '</div>' +
        '<div class="foot__col">' +
          '<h4>Browse</h4>' +
          '<a href="movies.html">Now Showing</a>' +
          '<a href="movies.html?tab=soon">Coming Soon</a>' +
          '<a href="movies.html?sort=rating">Top Rated</a>' +
        '</div>' +
        '<div class="foot__col">' +
          '<h4>Cinemas</h4>' +
          '<a href="cinemas.html">Find a cinema</a>' +
        '</div>' +
        '<div class="foot__col">' +
          '<h4>Account</h4>' +
          '<a href="signin.html">Sign in</a>' +
          '<a href="signin.html?mode=up">Create account</a>' +
          '<a href="tickets.html">My bookings</a>' +
        '</div>' +
      '</div>' +
      '<div class="foot__bar">' +
        '<div class="wrap foot__bar-in">' +
          '<p>© 2026 CineVault — student project.</p>' +
        '</div>' +
      '</div>' +
    '</footer>' +
    '<button class="to-top" id="toTop" aria-label="Back to top"><svg><use href="#i-up"/></svg></button>';


  /* ── inject ──────────────────────────────────────────────── */
  var here = document.currentScript;
  if (here) {
    here.insertAdjacentHTML('afterend', SPRITE + NAV + DRAWER);
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.body.insertAdjacentHTML('beforeend', FOOTER);
    paintAuth();
  });


  /* ── who is signed in ────────────────────────────────────── */
  /* Rendered from the presence of a token first so the button is
     never wrong on first paint, then refined with the real profile. */
  function paintAuth(profile) {
    var slot = document.getElementById('authSlot');
    var dslot = document.getElementById('authSlotDrawer');
    if (!slot) return;

    if (!API.isLoggedIn()) {
      slot.innerHTML = '<a href="signin.html" class="btn btn--accent btn--sm">' +
                       '<svg><use href="#i-user"/></svg>Sign In</a>';
      if (dslot) dslot.innerHTML = '<a href="signin.html" class="btn btn--accent drawer__cta">' +
                                   '<svg><use href="#i-user"/></svg>Sign In</a>';
      return;
    }

    var name = profile
      ? ((profile.first_name || '') + ' ' + (profile.last_name || '')).trim() || profile.email
      : 'My account';

    var warn = profile && profile.is_verified === false
      ? '<a href="verify.html?email=' + encodeURIComponent(profile.email) +
        '" class="authslot__warn" title="Verify your email to book">Verify email</a>'
      : '';

    slot.innerHTML =
      warn +
      '<span class="authslot__me"><svg><use href="#i-user"/></svg>' + escape2(name) + '</span>' +
      '<button class="btn btn--ghost btn--sm" type="button" id="signOut">Sign out</button>';

    if (dslot) {
      dslot.innerHTML = '<button class="btn btn--ghost drawer__cta" type="button" id="signOutD">Sign out</button>';
    }

    [document.getElementById('signOut'), document.getElementById('signOutD')].forEach(function (b) {
      if (b) b.addEventListener('click', function () {
        API.logout();
        location.href = 'index.html';
      });
    });
  }

  function escape2(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Confirm the session is real and find out whether the account is
     verified — booking is refused by IsVerified until it is. A failure
     here is not worth surfacing: the token has already been cleared by
     api.js, and paintAuth() will simply show Sign In. */
  if (API.isLoggedIn()) {
    API.me().then(function (profile) {
      try { sessionStorage.setItem('cv.me', JSON.stringify(profile)); } catch (e) {}
      paintAuth(profile);
    }, function () {
      paintAuth();
    });
  }

  window.CV_LAYOUT = { paintAuth: paintAuth };
})();
