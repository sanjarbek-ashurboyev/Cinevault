/* ═══════════════════════════════════════════════════════════════
   CineVault — deployment settings.
   This is the only file that should need editing when the backend
   moves, so nothing else hard-codes a host or a key.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* In production nginx serves these pages and proxies /api/ to Django,
     so both live on one origin and a relative path is correct — and stays
     correct whatever domain or scheme the site is reached on.

     Locally `make front` serves the pages on their own port while Django
     runs on 8000, so those two ports need the absolute URL instead. The
     port is what distinguishes them: nothing else about the page differs. */
  var DEV_FRONTEND_PORTS = ['5500', '63342'];
  var DEV_API_ORIGIN = 'http://127.0.0.1:8000';

  var origin = DEV_FRONTEND_PORTS.indexOf(window.location.port) === -1
    ? ''
    : DEV_API_ORIGIN;

  window.CV_CONFIG = {

    /* No trailing slash — api.js adds the paths. */
    API_BASE: origin + '/api/v1',

    /* Where Django serves uploaded posters from. Only used to turn the
       relative `poster` path the API returns into an absolute URL; empty
       in production, which leaves it a same-origin /media/… path. */
    MEDIA_BASE: origin,

    /* Stripe publishable key — designed to be public, it can only create
       payment intents, never read or move money. The secret key stays in
       the backend's .env and must never appear in this file.

       This is the TEST key. Going live means replacing it here as well as
       setting STRIPE_PUBLISHABLE_KEY in .env — the browser reads this file
       directly and nothing templates it. */
    STRIPE_PUBLISHABLE_KEY: 'pk_test_51UE3wvAaCN1m527oUH6ULhdjbfYztwP79UZ1JytlLWCOf3ABgE96TkVwin39wwJUuLTmFYlhfoBl6NAKvz7Ia5ar004Rd49zg3'
  };
})();
