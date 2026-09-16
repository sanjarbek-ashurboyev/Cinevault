/* ═══════════════════════════════════════════════════════════════
   CineVault — catalogue loader.

   The API exposes movies, showtimes and halls as three flat lists with
   no nesting, so the join has to happen here. Everything is fetched
   once per page load and cached for the life of the page, which keeps
   the listing, the detail page and the home grid on identical data.

   Whether a film is "showing" or "coming soon" is NOT a field on the
   model — it is derived from whether the film has a showtime still in
   the future. That is the honest reading: a film you cannot buy a
   ticket for is not showing, whatever its release date says.
   ═══════════════════════════════════════════════════════════════ */
window.CV_CAT = (function () {
  'use strict';

  var API = window.CV_API;
  var cache = null;

  function load() {
    if (cache) return cache;

    cache = Promise.all([
      API.movies(),
      API.showtimes(),
      /* GET /halls/ is public, but stay standing if it ever closes
         again — hall names are a nicety, not the point of the page. */
      API.halls().catch(function () { return []; })
    ]).then(function (res) {
      var movies = res[0], showtimes = res[1], halls = res[2];

      var hallById = {};
      halls.forEach(function (h) { hallById[h.id] = h; });

      var byMovie = {};
      showtimes.forEach(function (s) {
        (byMovie[s.movie] = byMovie[s.movie] || []).push(s);
      });

      var now = Date.now();

      movies.forEach(function (m) {
        var list = (byMovie[m.id] || []).slice().sort(function (a, b) {
          return new Date(a.start_time) - new Date(b.start_time);
        });

        list.forEach(function (s) {
          s.hallName = (hallById[s.hall] && hallById[s.hall].name) || ('Hall ' + s.hall);
        });

        var upcoming = list.filter(function (s) { return new Date(s.start_time).getTime() >= now; });

        m._showtimes = list;
        m._upcoming = upcoming;
        m._status = upcoming.length ? 'showing' : 'soon';

        m._price = upcoming.length
          ? Math.min.apply(null, upcoming.map(function (s) { return parseFloat(s.price) || 0; }))
          : null;

        var halllist = {};
        upcoming.forEach(function (s) { halllist[s.hall] = true; });
        m._cinemas = Object.keys(halllist).length;
      });

      return { movies: movies, halls: halls, hallById: hallById };
    }).catch(function (err) {
      cache = null;               // let the next attempt retry properly
      throw err;
    });

    return cache;
  }

  /* Showtimes for one film on one local calendar date.
     Filtering happens here rather than through the API's ?start_time=
     filter because that filter compares against the server's timezone
     (settings.TIME_ZONE = 'UTC') while the strip shows the viewer's
     local days — near midnight the two disagree. */
  function onDate(movie, isoDate) {
    return (movie._upcoming || []).filter(function (s) {
      return window.CV.dateKey(s.start_time) === isoDate;
    });
  }

  function find(movies, id) {
    id = parseInt(id, 10);
    return movies.filter(function (m) { return m.id === id; })[0] || null;
  }

  return { load: load, onDate: onDate, find: find };
})();
