/* ═══════════════════════════════════════════════════════════════
   CineVault — demo catalogue.
   Swap this file for a fetch() (or a Django context) later; the
   render helpers in pages.js only depend on these shapes.
   ═══════════════════════════════════════════════════════════════ */
CV.FILMS = [
  {
    id: 'dune-2', title: 'Dune: Part Two', poster: ['#8a5a2b', '#150e07', '#d9a04b'],
    rating: 8.8, genres: 'Sci-Fi · Adventure', runtime: '2h 46m', cert: 'PG-13',
    formats: ['imax', 'dolby'], price: 12.5, cinemas: 12, status: 'showing',
    times: [{ t: '10:30' }, { t: '13:45' }, { t: '17:00' }, { t: '20:15', full: true }, { t: '22:40' }],
    synopsis: 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family. Facing a choice between the love of his life and the fate of the known universe, he strives to prevent a terrible future only he can foresee.'
  },
  {
    id: 'oppenheimer', title: 'Oppenheimer', poster: ['#b8452f', '#150807', '#e8703f'],
    rating: 8.9, genres: 'Drama · History', runtime: '3h 00m', cert: 'R',
    formats: ['imax'], price: 14.0, cinemas: 9, status: 'showing',
    times: [{ t: '11:15' }, { t: '15:00' }, { t: '18:30' }, { t: '21:45' }],
    synopsis: 'The story of J. Robert Oppenheimer and his pivotal role in developing the first nuclear weapons during World War II — a portrait of the man who moved the world and then could not stop it.'
  },
  {
    id: 'the-batman', title: 'The Batman', poster: ['#2f4d7a', '#070b14', '#4d7fc4'],
    rating: 8.2, genres: 'Action · Crime', runtime: '2h 56m', cert: 'PG-13',
    formats: ['dolby', 'vip'], price: 11.0, cinemas: 15, status: 'showing',
    times: [{ t: '12:00' }, { t: '16:20', full: true }, { t: '19:40' }, { t: '22:30' }],
    synopsis: 'Two years of stalking the streets as the Batman have driven Bruce Wayne deep into the shadows of Gotham. With a sadistic killer leaving behind a trail of cryptic clues, the hunt begins.'
  },
  {
    id: 'interstellar', title: 'Interstellar', poster: ['#1f5c5a', '#050f0f', '#3fa39c'],
    rating: 8.7, genres: 'Sci-Fi · Drama', runtime: '2h 49m', cert: 'PG-13',
    formats: ['imax', 'vip'], price: 13.5, cinemas: 6, status: 'showing',
    times: [{ t: '14:10' }, { t: '18:00' }, { t: '21:20' }],
    synopsis: 'With Earth becoming uninhabitable, a team of explorers travels through a wormhole near Saturn in a last attempt to ensure humanity’s survival. Back in 4K laser for a limited run.'
  },
  {
    id: 'poor-things', title: 'Poor Things', poster: ['#7a3f78', '#120711', '#c46bbf'],
    rating: 8.0, genres: 'Comedy · Drama', runtime: '2h 21m', cert: 'R',
    formats: ['dolby'], price: 10.5, cinemas: 8, status: 'showing',
    times: [{ t: '13:20' }, { t: '16:45' }, { t: '20:00' }],
    synopsis: 'The incredible tale of Bella Baxter, a young woman brought back to life by an unorthodox scientist, who runs away to discover the world on her own impossible terms.'
  },
  {
    id: 'godzilla-kong', title: 'Godzilla x Kong', poster: ['#4a6b25', '#0a1105', '#84b83f'],
    rating: 7.2, genres: 'Action · Sci-Fi', runtime: '1h 55m', cert: 'PG-13',
    formats: ['4dx'], price: 15.0, cinemas: 11, status: 'showing',
    times: [{ t: '11:40' }, { t: '14:50' }, { t: '17:55' }, { t: '21:00' }],
    synopsis: 'Two ancient titans collide in a spectacle built for the biggest screen and the loudest room you can find. Best seen in 4DX, if your stomach allows it.'
  },
  {
    id: 'the-holdovers', title: 'The Holdovers', poster: ['#6b5424', '#100c05', '#c0a04a'],
    rating: 8.1, genres: 'Comedy · Drama', runtime: '2h 13m', cert: 'R',
    formats: ['dolby'], price: 10.0, cinemas: 5, status: 'showing',
    times: [{ t: '12:30' }, { t: '15:40' }, { t: '19:10' }],
    synopsis: 'A cranky teacher at a New England prep school is forced to remain on campus over the holidays with a grieving cook and a troublemaking student.'
  },
  {
    id: 'past-lives', title: 'Past Lives', poster: ['#3a4a6b', '#070a12', '#6b83b8'],
    rating: 8.4, genres: 'Romance · Drama', runtime: '1h 45m', cert: 'PG-13',
    formats: ['vip'], price: 11.5, cinemas: 4, status: 'showing',
    times: [{ t: '14:00' }, { t: '17:30' }, { t: '20:40' }],
    synopsis: 'Two childhood friends are reunited in New York two decades after their family emigrated, confronting the lives they did and did not live.'
  },

  /* ── coming soon ─────────────────────────────────────────── */
  {
    id: 'br-2099', title: 'Blade Runner 2099', poster: ['#3b2f6b', '#08060f', '#7a63c9'],
    rating: null, genres: 'Sci-Fi · Thriller', runtime: '2h 30m', cert: 'R',
    formats: ['imax', 'dolby'], price: 14.0, cinemas: 0, status: 'soon',
    release: '2026-10-12', prebook: true, times: [],
    synopsis: 'Half a century after the events of 2049, the line between replicant and human has all but dissolved in a city that never stopped raining.'
  },
  {
    id: 'the-odyssey', title: 'The Odyssey', poster: ['#8a6a2b', '#0f0b05', '#d4a94a'],
    rating: null, genres: 'Epic · Adventure', runtime: '2h 58m', cert: 'PG-13',
    formats: ['imax'], price: 15.0, cinemas: 0, status: 'soon',
    release: '2026-11-07', prebook: true, times: [],
    synopsis: 'Homer’s epic, shot on location across the Mediterranean and mounted for the largest format available.'
  },
  {
    id: 'nocturne', title: 'Nocturne', poster: ['#1e4a6b', '#050c12', '#3d8ab8'],
    rating: null, genres: 'Mystery · Drama', runtime: '2h 08m', cert: 'R',
    formats: ['dolby'], price: 12.0, cinemas: 0, status: 'soon',
    release: '2026-12-19', prebook: false, times: [],
    synopsis: 'A concert pianist begins to suspect that the rival who died last winter is still finishing her compositions.'
  },
  {
    id: 'arrival-2', title: 'Arrival II', poster: ['#6b2438', '#12050a', '#c04a68'],
    rating: null, genres: 'Sci-Fi · Drama', runtime: '2h 14m', cert: 'PG-13',
    formats: ['imax', 'dolby'], price: 13.0, cinemas: 0, status: 'soon',
    release: '2027-01-23', prebook: false, times: [],
    synopsis: 'Twelve years after the shells departed, the language they left behind starts predicting things it should not be able to know.'
  }
];


CV.VENUES = [
  { id: 'vault-imax',   name: 'Vault IMAX — Downtown',  area: '241 Canal St',    distance: '1.2 mi', formats: ['IMAX', 'Dolby Atmos', 'VIP Recliner'], screens: 9,  price: 12.5, poster: ['#8a5a2b', '#150e07', '#d9a04b'] },
  { id: 'vault-nine',   name: 'Vault Nine — Midtown',   area: '870 8th Ave',     distance: '2.6 mi', formats: ['Dolby Atmos', '4DX'],                  screens: 12, price: 11.0, poster: ['#2f4d7a', '#070b14', '#4d7fc4'] },
  { id: 'grand-uptown', name: 'Grand Reserve — Uptown', area: '1440 Broadway',   distance: '3.8 mi', formats: ['VIP Recliner', 'Dolby Atmos'],         screens: 6,  price: 16.0, poster: ['#7a3f78', '#120711', '#c46bbf'] },
  { id: 'vault-harbor', name: 'Vault Harbour — Docks',  area: '12 Pier Walk',    distance: '5.1 mi', formats: ['IMAX', '4DX', 'Dolby Atmos'],          screens: 14, price: 13.0, poster: ['#1f5c5a', '#050f0f', '#3fa39c'] },
  { id: 'the-rialto',   name: 'The Rialto — Old Town',  area: '5 Rialto Square', distance: '6.4 mi', formats: ['Dolby Atmos'],                         screens: 4,  price: 9.5,  poster: ['#6b5424', '#100c05', '#c0a04a'] }
];


/* ── small shared helpers ──────────────────────────────────── */
CV.fmtName = function (k) {
  return { imax: 'IMAX', '4dx': '4DX', dolby: 'Dolby', vip: 'VIP' }[k] || k;
};

CV.shortDate = function (isoStr) {
  var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var d = new Date(isoStr + 'T00:00:00');
  if (isNaN(d)) return isoStr;
  return M[d.getMonth()] + ' ' + String(d.getDate()).padStart(2, '0');
};

CV.longDate = function (isoStr) {
  var D = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var d = new Date(isoStr + 'T00:00:00');
  if (isNaN(d)) return isoStr;
  return D[d.getDay()] + ', ' + M[d.getMonth()] + ' ' + d.getDate();
};

/* escape anything interpolated into markup */
CV.esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};

CV.poster = function (film, tall) {
  var p = film.poster;
  var badge = film.status === 'soon'
    ? '<span class="badge badge--date">' + CV.shortDate(film.release) + '</span>'
    : '<span class="badge badge--rate"><svg><use href="#i-star"/></svg>' + film.rating.toFixed(1) + '</span>';

  var fmt = film.formats.length
    ? '<span class="badge badge--fmt">' + CV.fmtName(film.formats[0]) + '</span>' : '';

  return '<div class="poster' + (tall ? ' poster--tall' : '') + '" style="--p1:' + p[0] + ';--p2:' + p[1] + ';--p3:' + p[2] + '">' +
           '<span class="poster__t">' + CV.esc(film.title).replace(/[:–]\s*/g, '<br>') + '</span>' +
           badge + fmt +
         '</div>';
};

CV.film = function (id) {
  return CV.FILMS.filter(function (f) { return f.id === id; })[0] || null;
};

CV.filmByTitle = function (title) {
  var t = (title || '').trim().toLowerCase();
  return CV.FILMS.filter(function (f) { return f.title.toLowerCase() === t; })[0] || null;
};

CV.venue = function (idOrName) {
  var v = (idOrName || '').trim().toLowerCase();
  return CV.VENUES.filter(function (x) {
    return x.id === v || x.name.toLowerCase() === v;
  })[0] || CV.VENUES[0];
};
