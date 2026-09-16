/* ═══════════════════════════════════════════════════════════════
   CineVault — API client.

   One place that knows how to talk to the Django backend: base URL,
   JWT storage, silent access-token refresh, and error shapes.

   Trailing slashes are copied exactly from the backend's urls.py and
   are NOT interchangeable — Django's APPEND_SLASH turns a missing
   slash into a 301, and a redirected POST is downgraded to GET by the
   browser, which would silently drop the request body. So '/auth/login/'
   keeps its slash and '/auth/register' keeps its absence.
   ═══════════════════════════════════════════════════════════════ */
window.CV_API = (function () {
  'use strict';

  var CFG = window.CV_CONFIG;
  var BASE = CFG.API_BASE;

  var ACCESS_KEY = 'cv.access';
  var REFRESH_KEY = 'cv.refresh';


  /* ── token storage ───────────────────────────────────────── */
  /* localStorage throws outright in some privacy modes, so every
     access is guarded rather than assumed. */
  function read(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function write(k, v) {
    try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {}
  }

  function accessToken()  { return read(ACCESS_KEY); }
  function refreshToken() { return read(REFRESH_KEY); }
  function isLoggedIn()   { return !!accessToken(); }

  function setTokens(access, refresh) {
    write(ACCESS_KEY, access || null);
    if (refresh !== undefined) write(REFRESH_KEY, refresh || null);
  }

  function logout() {
    write(ACCESS_KEY, null);
    write(REFRESH_KEY, null);
    try { sessionStorage.removeItem('cv.booking'); } catch (e) {}
  }


  /* ── errors ──────────────────────────────────────────────── */
  /* DRF answers in several shapes depending on where the error came
     from: {"detail": "..."} from permissions, {"field": ["..."]} from
     serializer validation, and a bare list for non_field_errors. This
     flattens all of them into one readable sentence while keeping the
     per-field detail available for form highlighting. */
  function ApiError(status, payload) {
    this.name = 'ApiError';
    this.status = status;
    this.fields = {};
    this.message = flatten(status, payload, this.fields);
  }
  ApiError.prototype = Object.create(Error.prototype);

  function flatten(status, payload, fieldsOut) {
    if (payload == null || payload === '') {
      return status === 0
        ? 'Could not reach the server. Is Django running on ' + BASE + '?'
        : 'Request failed (HTTP ' + status + ').';
    }
    if (typeof payload === 'string') return payload;

    if (Array.isArray(payload)) return payload.join(' ');

    if (payload.detail) return String(payload.detail);

    var parts = [];
    Object.keys(payload).forEach(function (k) {
      var v = payload[k];
      var text = Array.isArray(v) ? v.join(' ') : String(v);
      if (fieldsOut) fieldsOut[k] = text;
      parts.push(k === 'non_field_errors' ? text : label(k) + ': ' + text);
    });
    return parts.join('\n') || 'Request failed (HTTP ' + status + ').';
  }

  function label(k) {
    return k.replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
  }


  /* ── the request pipeline ────────────────────────────────── */
  function send(method, path, body, opts) {
    opts = opts || {};

    var headers = {};
    if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';

    var token = accessToken();
    if (token && opts.auth !== false) headers.Authorization = 'Bearer ' + token;

    return fetch(BASE + path, {
      method: method,
      headers: headers,
      body: body === undefined || body === null ? undefined : JSON.stringify(body)
    }).then(function (res) {
      return parse(res).then(function (payload) {

        if (res.ok) return payload;

        /* One shot at a silent refresh, then replay the original call.
           opts.retried stops this recursing if the refresh itself 401s. */
        if (res.status === 401 && refreshToken() && !opts.retried && opts.auth !== false) {
          return refresh().then(function () {
            return send(method, path, body, { retried: true });
          }, function () {
            logout();
            throw new ApiError(401, { detail: 'Your session has expired. Please sign in again.' });
          });
        }

        throw new ApiError(res.status, payload);
      });
    }, function () {
      /* fetch() only rejects for network-level failures — the server
         being down, or CORS blocking the response before it is read. */
      throw new ApiError(0, null);
    });
  }

  function parse(res) {
    if (res.status === 204) return Promise.resolve(null);
    var type = res.headers.get('content-type') || '';
    if (type.indexOf('application/json') > -1) return res.json().catch(function () { return null; });
    return res.text().catch(function () { return null; });
  }

  function refresh() {
    return send('POST', '/auth/token/refresh/', { refresh: refreshToken() }, { auth: false })
      .then(function (data) {
        /* ROTATE_REFRESH_TOKENS is off in settings.py, so only the
           access token comes back and the refresh token is left alone. */
        setTokens(data.access);
        return data;
      });
  }


  /* ── query strings ───────────────────────────────────────── */
  function qs(params) {
    if (!params) return '';
    var p = new URLSearchParams();
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v !== undefined && v !== null && v !== '') p.set(k, v);
    });
    var s = p.toString();
    return s ? '?' + s : '';
  }

  /* The project has no DEFAULT_PAGINATION_CLASS, so list endpoints
     return a bare array today. Reading through `results` anyway means
     switching pagination on later will not break every page. */
  function rows(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.results)) return payload.results;
    return [];
  }


  /* ── endpoints ───────────────────────────────────────────── */
  return {

    /* auth */
    register: function (data) { return send('POST', '/auth/register', data, { auth: false }); },
    verifyEmail: function (email, code) {
      return send('POST', '/auth/verify-email', { email: email, code: code }, { auth: false });
    },
    resendVerification: function (email) {
      return send('POST', '/auth/resend-verification', { email: email }, { auth: false });
    },
    login: function (email, password) {
      return send('POST', '/auth/login/', { email: email, password: password }, { auth: false })
        .then(function (data) {
          setTokens(data.access, data.refresh);
          return data;
        });
    },
    me: function () { return send('GET', '/auth/me'); },
    updateMe: function (data) { return send('PATCH', '/auth/me', data); },
    passwordResetRequest: function (email) {
      return send('POST', '/auth/password-reset/', { email: email }, { auth: false });
    },
    passwordResetConfirm: function (data) {
      return send('POST', '/auth/password-reset-confirm/', data, { auth: false });
    },

    /* catalogue */
    movies: function (params) { return send('GET', '/movies/' + qs(params)).then(rows); },
    movie: function (id) { return send('GET', '/movies/' + id); },
    genres: function () { return send('GET', '/genres/').then(rows); },
    halls: function () { return send('GET', '/halls/').then(rows); },

    /* showtimes */
    showtimes: function (params) { return send('GET', '/showtimes/' + qs(params)).then(rows); },
    showtime: function (id) { return send('GET', '/showtimes/' + id); },
    seatMap: function (id) { return send('GET', '/showtimes/' + id + '/seats/'); },

    /* booking */
    createReservation: function (showtimeId, seatIds) {
      return send('POST', '/reservations/', { showtime: showtimeId, seat_ids: seatIds });
    },

    /* The backend scopes this to the caller — get_queryset() filters by
       request.user — so there is no user id to pass and no way to ask
       for somebody else's. Newest first, decided server-side. */
    myReservations: function () { return send('GET', '/reservations/').then(rows); },

    /* Owner-or-staff only. A reservation belonging to someone else
       answers 403, and a missing one 404, so callers should treat the
       two differently only if they want to admit the row exists. */
    reservation: function (id) { return send('GET', '/reservations/' + id + '/'); },
    createPaymentIntent: function (reservationId) {
      return send('POST', '/payments/create-intent/' + reservationId + '/');
    },

    /* session */
    isLoggedIn: isLoggedIn,
    logout: logout,
    ApiError: ApiError,

    /* Absolute URL for an uploaded poster. The API returns either a
       full URL or a MEDIA_URL-relative path depending on whether the
       request carried a host, so both are handled. */
    mediaUrl: function (path) {
      if (!path) return null;
      if (/^https?:\/\//i.test(path)) return path;
      return CFG.MEDIA_BASE + (path.charAt(0) === '/' ? '' : '/') + path;
    }
  };
})();
