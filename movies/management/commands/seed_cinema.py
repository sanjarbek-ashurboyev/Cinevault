"""Fill the database with a believable multiplex: films, screens, schedule.

The catalogue in movies/fixtures/catalog.json is real data — titles, runtimes,
synopses, certificates and TMDB scores for films actually in release, each
paired with its studio's own YouTube trailer and the art distributed with it:
a portrait poster for the cards and a landscape backdrop for the hero banner.
Both live under media/ and are referenced, not copied.

Showtimes are generated rather than fixed, because a schedule that was written
down once starts reading as stale the day after: every run lays out the next
`--days` days from today so the "now showing" listing is never empty.
"""

import json
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from halls.models import Hall
from movies.models import Genre, Movie
from reservations.models import Reservation
from showtimes.models import Showtime

CATALOG = Path(__file__).resolve().parents[2] / "fixtures" / "catalog.json"

# name, rows, seats per row, base ticket price, minutes after opening.
#
# Sizes follow the shape of a real multiplex rather than a uniform grid: the
# premium-format houses are the big ones, the VIP screen is deliberately tiny,
# and the numbered screens taper off. Names stay inside Hall.name's 20 chars.
#
# The last column staggers each screen's first show. Without it every house
# would start at 10:30 and, because slots are packed by runtime, stay in step
# all day — six screens emptying into the same lobby at the same minute.
HALLS = [
    ("IMAX", 14, 20, 22, 0),
    ("Dolby Atmos", 11, 18, 18, 20),
    ("Screen 1", 10, 16, 13, 10),
    ("Screen 2", 9, 14, 13, 35),
    ("Screen 3", 8, 14, 12, 25),
    ("VIP Lounge", 5, 8, 30, 45),
]

# Which films a screen is willing to play. Event films open on the premium
# formats and hold there; the smaller screens carry the wide releases and the
# holdovers. A film in no screen's list simply is not showing, which is what
# puts the unreleased titles in the frontend's "coming soon" tab.
PROGRAMMING = {
    "IMAX": ["A"],
    "Dolby Atmos": ["A", "B"],
    "Screen 1": ["B"],
    "Screen 2": ["B", "C"],
    "Screen 3": ["C"],
    "VIP Lounge": ["A", "B"],
}

FIRST_SHOW = time(10, 30)  # doors earlier, but nothing starts before this
LAST_START = time(22, 30)  # a later start would run past closing
TURNAROUND = 25            # minutes to empty, clean and re-seat a house
PREROLL = 15               # adverts and trailers before the feature itself


class Command(BaseCommand):
    help = "Replace the demo catalogue with real films, screens and a live schedule."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days", type=int, default=10,
            help="How many days of showtimes to lay out, starting today (default: 10).",
        )
        parser.add_argument(
            "--noinput", "--no-input", action="store_true", dest="noinput",
            help="Do not prompt before deleting the existing catalogue.",
        )

    def handle(self, *args, **opts):
        if opts["days"] < 1:
            raise CommandError("--days must be at least 1.")
        if not CATALOG.exists():
            raise CommandError(f"Catalogue not found: {CATALOG}")

        catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
        self._check_posters(catalog)
        self._confirm(opts["noinput"])

        with transaction.atomic():
            self._wipe()
            genres = self._create_genres(catalog)
            movies = self._create_movies(catalog, genres)
            halls = self._create_halls()
            shows = self._create_showtimes(movies, halls, opts["days"])

        seats = sum(h.total_rows * h.total_seats_per_row for h in halls)
        self.stdout.write(self.style.SUCCESS(
            f"\nSeeded {len(movies)} films, {len(halls)} screens, {seats} seats "
            f"and {shows} showtimes across {opts['days']} days."
        ))

    # ── preflight ────────────────────────────────────────────────

    def _check_posters(self, catalog):
        """Fail before deleting anything if the artwork is missing.

        The image files are the one part of the catalogue that lives outside
        the JSON, so a checkout without them would otherwise wipe the database
        and rebuild it with every film blank.
        """
        root = Path(settings.MEDIA_ROOT)
        missing = [
            f"{m['title']} ({kind})"
            for m in catalog
            for kind, name in (("poster", m["poster_file"]), ("backdrop", m["backdrop_file"]))
            if not (root / f"movie_{kind}s" / name).is_file()
        ]
        if missing:
            raise CommandError(
                f"{len(missing)} image(s) missing from {root}: "
                + ", ".join(missing[:5]) + ("…" if len(missing) > 5 else "")
            )

    def _confirm(self, noinput):
        counts = {
            "films": Movie.objects.count(),
            "screens": Hall.objects.count(),
            "showtimes": Showtime.objects.count(),
            "reservations": Reservation.objects.count(),
        }
        if noinput or not any(counts.values()):
            return
        summary = ", ".join(f"{v} {k}" for k, v in counts.items() if v)
        self.stdout.write(self.style.WARNING(
            f"This deletes the existing catalogue ({summary}). Reservations hang "
            f"off showtimes and go with them."
        ))
        if input("Type 'yes' to continue: ").strip().lower() != "yes":
            raise CommandError("Cancelled.")

    # ── build ────────────────────────────────────────────────────

    def _wipe(self):
        Showtime.objects.all().delete()  # takes reservations with it
        Movie.objects.all().delete()
        Genre.objects.all().delete()
        Hall.objects.all().delete()  # takes seats with it

    def _create_genres(self, catalog):
        names = sorted({g for m in catalog for g in m["genres"]})
        Genre.objects.bulk_create([Genre(name=n) for n in names])
        return {g.name: g for g in Genre.objects.all()}

    def _create_movies(self, catalog, genres):
        movies = []
        for entry in catalog:
            movie = Movie.objects.create(
                title=entry["title"],
                description=entry["description"],
                poster=f"movie_posters/{entry['poster_file']}",
                backdrop=f"movie_backdrops/{entry['backdrop_file']}",
                trailer_url=entry["trailer_url"],
                duration_minutes=entry["duration_minutes"],
                release_date=date.fromisoformat(entry["release_date"]),
                age_rating=entry["age_rating"],
                rating=Decimal(str(entry["rating"])) if entry["rating"] else None,
            )
            movie.genres.set(genres[g] for g in entry["genres"])
            # Not a model field — just carried through to the scheduler below.
            movie.tier = entry["tier"]
            movies.append(movie)
            self.stdout.write(f"  film    {movie.title}")
        return movies

    def _create_halls(self):
        halls = []
        for name, rows, per_row, price, stagger in HALLS:
            hall = Hall.objects.create(
                name=name, total_rows=rows, total_seats_per_row=per_row
            )
            hall.generate_seats()
            # Neither is a model field; both are read by the scheduler below.
            hall.base_price = price
            hall.stagger = stagger
            halls.append(hall)
            self.stdout.write(
                f"  screen  {name} — {rows}×{per_row} = {rows * per_row} seats"
            )
        return halls

    def _create_showtimes(self, movies, halls, days):
        """Lay out `days` days of screenings, one hall at a time.

        Each hall works through the films it is programmed for in rotation, so
        a film showing twice in a day does not get two adjacent slots, and a
        hall carrying several films alternates them the way a real screen
        does. Slots are packed by runtime, so long films naturally end up with
        fewer showings a day than short ones.

        The rotation runs on across days instead of resetting at midnight, so
        tomorrow's schedule is not a copy of today's, and each hall enters it
        at a different point so that two screens programmed alike do not end
        up showing the same film at the same time.
        """
        today = timezone.localdate()
        shows = []
        per_hall = {}

        for index, hall in enumerate(halls):
            lineup = [m for m in movies if m.tier in PROGRAMMING[hall.name]]
            if not lineup:
                continue
            turn = index
            start_count = len(shows)
            for offset in range(days):
                day = today + timedelta(days=offset)
                cursor = self._aware(day, FIRST_SHOW) + timedelta(minutes=hall.stagger)
                limit = self._aware(day, LAST_START)
                while cursor <= limit:
                    movie = lineup[turn % len(lineup)]
                    turn += 1
                    runs = PREROLL + movie.duration_minutes
                    shows.append(Showtime(
                        movie=movie,
                        hall=hall,
                        start_time=cursor,
                        end_time=cursor + timedelta(minutes=runs),
                        price=self._price(hall.base_price, cursor),
                    ))
                    cursor = self._round_up(cursor + timedelta(minutes=runs + TURNAROUND))
            per_hall[hall.name] = len(shows) - start_count

        Showtime.objects.bulk_create(shows)
        for name, n in per_hall.items():
            self.stdout.write(f"  shows   {name} — {n} over {days} days")
        return len(shows)

    # ── helpers ──────────────────────────────────────────────────

    @staticmethod
    def _aware(day, at):
        """A local wall-clock time on `day`, as an aware datetime.

        Showtimes are advertised in the cinema's own time, so these are built
        in the project timezone and converted on the way out — not derived
        from UTC, which would slide the whole schedule by five hours.
        """
        return timezone.make_aware(datetime.combine(day, at))

    @staticmethod
    def _round_up(moment, step=5):
        """Push a start time up to the next 5-minute mark.

        Cinemas advertise round times; packing purely by runtime would
        otherwise produce starts like 16:37.
        """
        extra = (-moment.minute) % step
        return (moment + timedelta(minutes=extra)).replace(second=0, microsecond=0)

    @staticmethod
    def _price(base, start):
        """Ticket price for one screening.

        Cheap in the afternoon, dearest in the evening, discounted again for
        the last showing, and up a little at the weekend — the pattern every
        cinema prices on.
        """
        hour = timezone.localtime(start).hour
        price = base
        if hour < 16:
            price -= 3        # matinee
        elif hour >= 22:
            price -= 2        # late show
        elif hour >= 18:
            price += 3        # prime evening
        if start.weekday() >= 5:
            price += 2        # Saturday and Sunday
        return Decimal(max(price, 5))
