from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from reservations.models import Reservation, ReservationSeat
from showtimes.models import Showtime
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
