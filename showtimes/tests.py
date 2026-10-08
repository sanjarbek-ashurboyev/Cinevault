from datetime import timedelta
from unittest import mock, skipUnless

from django.db import IntegrityError, connection, transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from reservations.models import Reservation, ReservationSeat
from showtimes.models import Showtime
from showtimes.serializers import ShowtimeSerialer
from test_helpers import client_for, count_queries, make_hall, make_showtime, make_user


class SeatMapTests(TestCase):
    def setUp(self):
        self.showtime = make_showtime()
        self.seats = list(self.showtime.hall.seats.order_by('row', 'number'))

    def seat_statuses(self):
        response = APIClient().get(f'/api/v1/showtimes/{self.showtime.id}/seats/')
        self.assertEqual(response.status_code, 200)
        return {s['label']: s['status'] for s in response.data['seats']}

    def hold(self, seat, status):
        reservation = Reservation.objects.create(
            user=make_user(email=f'{status}{seat.id}@example.com'), showtime=self.showtime,
            status=status, total_price=20,
        )
        ReservationSeat.objects.create(reservation=reservation, seat=seat, showtime=self.showtime)
        return reservation

    def test_every_seat_is_listed_in_order(self):
        self.assertEqual(list(self.seat_statuses()), ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'])

    def test_pending_and_confirmed_seats_show_as_booked(self):
        self.hold(self.seats[0], Reservation.StatusType.PENDING)
        self.hold(self.seats[1], Reservation.StatusType.CONFIRMED)

        statuses = self.seat_statuses()
        self.assertEqual((statuses['A1'], statuses['A2'], statuses['A3']), ('booked', 'booked', 'available'))

    def test_cancelled_seats_show_as_available(self):
        self.hold(self.seats[0], Reservation.StatusType.PENDING).cancel()
        self.assertEqual(self.seat_statuses()['A1'], 'available')

    def test_unknown_showtime_is_404(self):
        self.assertEqual(APIClient().get('/api/v1/showtimes/999999/seats/').status_code, 404)


class ShowtimeListTests(TestCase):
    def test_filter_by_date(self):
        today = make_showtime(starts_in=timedelta(hours=1))
        make_showtime(hall=today.hall, starts_in=timedelta(days=3))

        day = timezone.localtime(today.start_time).date().isoformat()
        response = APIClient().get('/api/v1/showtimes/', {'start_time': day})

        self.assertEqual([s['id'] for s in response.data['results']], [today.id])

    def test_start_after_skips_screenings_that_have_begun(self):
        past = make_showtime(starts_in=-timedelta(hours=3))
        upcoming = make_showtime(hall=past.hall, starts_in=timedelta(hours=1))

        response = APIClient().get('/api/v1/showtimes/', {'start_after': timezone.now().isoformat()})

        self.assertEqual([s['id'] for s in response.data['results']], [upcoming.id])

    def test_only_superusers_can_create_showtimes(self):
        existing = make_showtime()
        start = timezone.now() + timedelta(days=2)
        data = {'movie': existing.movie.id, 'hall': existing.hall.id, 'price': 25,
                'start_time': start.isoformat(), 'end_time': (start + timedelta(hours=2)).isoformat()}

        self.assertEqual(client_for(make_user()).post('/api/v1/showtimes/', data).status_code, 403)
        admin = make_user(email='admin@example.com', is_superuser=True, is_staff=True)
        self.assertEqual(client_for(admin).post('/api/v1/showtimes/', data).status_code, 201)
        self.assertEqual(Showtime.objects.count(), 2)


class ShowtimeQueryTests(TestCase):
    def test_list_query_count_does_not_grow_with_the_number_of_showtimes(self):
        hall = make_hall()
        make_showtime(hall=hall)
        few = count_queries(lambda: APIClient().get('/api/v1/showtimes/'))
        for n in range(10):
            make_showtime(hall=hall, starts_in=timedelta(days=n + 2))
        self.assertEqual(count_queries(lambda: APIClient().get('/api/v1/showtimes/')), few)

    def test_seat_map_query_count_does_not_grow_with_bookings(self):
        showtime = make_showtime()
        url = f'/api/v1/showtimes/{showtime.id}/seats/'
        few = count_queries(lambda: APIClient().get(url))
        for n, seat in enumerate(showtime.hall.seats.all()):
            reservation = Reservation.objects.create(
                user=make_user(email=f'u{n}@example.com'), showtime=showtime, total_price=20,
            )
            ReservationSeat.objects.create(reservation=reservation, seat=seat, showtime=showtime)
        self.assertEqual(count_queries(lambda: APIClient().get(url)), few)


class ShowtimeScheduleTests(TestCase):
    """A hall shows one film at a time, and a showtime ends after it starts."""

    def setUp(self):
        self.existing = make_showtime()  # 2 hours, starting tomorrow
        self.hall, self.movie = self.existing.hall, self.existing.movie
        self.admin = client_for(make_user(email='admin@example.com', is_superuser=True, is_staff=True))

    def at(self, hours):
        return self.existing.start_time + timedelta(hours=hours)

    def body(self, start, end, hall=None):
        return {'movie': self.movie.id, 'hall': (hall or self.hall).id, 'price': 25,
                'start_time': start.isoformat(), 'end_time': end.isoformat()}

    def create(self, start, end, hall=None):
        return self.admin.post('/api/v1/showtimes/', self.body(start, end, hall))

    def test_end_must_be_after_start(self):
        for end in (self.at(5), self.at(4)):
            response = self.create(self.at(5), end)
            self.assertEqual(response.status_code, 400)
            self.assertIn('end_time', response.data)
        self.assertEqual(Showtime.objects.count(), 1)

    def test_overlap_in_the_same_hall_is_refused(self):
        # Starts during, ends during, and wraps the existing 0h-2h show.
        for start, end in ((1, 3), (-1, 1), (0.5, 1.5), (-1, 3)):
            response = self.create(self.at(start), self.at(end))
            self.assertEqual(response.status_code, 400, (start, end))
            self.assertIn('Hall 1 already shows Test Film', str(response.data))
        self.assertEqual(Showtime.objects.count(), 1)

    def test_back_to_back_and_other_halls_are_allowed(self):
        self.assertEqual(self.create(self.at(2), self.at(4)).status_code, 201)
        self.assertEqual(self.create(self.at(-2), self.at(0)).status_code, 201)
        self.assertEqual(self.create(self.at(0), self.at(2), hall=make_hall('Hall 2')).status_code, 201)

    def test_editing_checks_other_showtimes_but_not_itself(self):
        later = make_showtime(hall=self.hall, starts_in=timedelta(days=2))
        url = f'/api/v1/showtimes/{later.id}'
        moved = self.admin.put(url, self.body(later.start_time + timedelta(hours=1), later.end_time + timedelta(hours=1)))
        self.assertEqual(moved.status_code, 200)
        clashing = self.admin.put(url, self.body(self.at(1), self.at(3)))
        self.assertEqual(clashing.status_code, 400)

    def test_database_refuses_an_end_before_the_start(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Showtime.objects.create(movie=self.movie, hall=self.hall, price=20, start_time=self.at(5), end_time=self.at(4))


@skipUnless(connection.vendor == 'postgresql', 'exclusion constraints need PostgreSQL')
class ShowtimeOverlapConstraintTests(TestCase):
    """The database's own guard, for writes that skip the serializer or race it."""

    def setUp(self):
        self.existing = make_showtime()
        self.start = self.existing.start_time

    def add(self, start_hours, end_hours, hall=None):
        return Showtime.objects.create(
            movie=self.existing.movie, hall=hall or self.existing.hall, price=20,
            start_time=self.start + timedelta(hours=start_hours), end_time=self.start + timedelta(hours=end_hours),
        )

    def test_overlap_is_refused_by_the_database(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.add(1, 3)

    def test_touching_and_other_halls_pass_the_database(self):
        self.add(2, 4)
        self.add(1, 3, hall=make_hall('Hall 2'))
        self.assertEqual(Showtime.objects.count(), 3)

    def test_a_request_that_slips_past_validation_gets_a_400(self):
        # What the second of two simultaneous requests sees: its validate() ran before the first one saved.
        admin = client_for(make_user(email='admin@example.com', is_superuser=True, is_staff=True))
        body = {'movie': self.existing.movie.id, 'hall': self.existing.hall.id, 'price': 25,
                'start_time': (self.start + timedelta(hours=1)).isoformat(),
                'end_time': (self.start + timedelta(hours=3)).isoformat()}
        with mock.patch.object(ShowtimeSerialer, 'validate', lambda serializer, attrs: attrs):
            response = admin.post('/api/v1/showtimes/', body)
        self.assertEqual(response.status_code, 400)
        self.assertIn('just scheduled', str(response.data))
        self.assertEqual(Showtime.objects.count(), 1)
