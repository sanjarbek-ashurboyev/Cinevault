from unittest import mock

from django.core import mail
from django.core.cache import cache
from django.test import TestCase

from payments.models import Payment
from reservations.models import Reservation, ReservationSeat
from reservations.tasks import cancel_reservation_if_unpaid, send_reservation_ticket
from test_helpers import client_for, make_hall, make_showtime, make_user
from utils import seat_lock_key

URL = '/api/v1/reservations/'


def book(user, showtime, seats, status=Reservation.StatusType.PENDING):
    reservation = Reservation.objects.create(
        user=user, showtime=showtime, status=status, total_price=showtime.price * len(seats),
    )
    ReservationSeat.objects.bulk_create(
        ReservationSeat(reservation=reservation, seat=s, showtime=showtime) for s in seats
    )
    return reservation


@mock.patch('reservations.serializers.cancel_reservation_if_unpaid')
class CreateReservationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = make_user()
        self.client = client_for(self.user)
        self.showtime = make_showtime(price=20)
        self.seats = list(self.showtime.hall.seats.order_by('row', 'number'))

    def reserve(self, seat_ids, client=None):
        return (client or self.client).post(
            URL, {'showtime': self.showtime.id, 'seat_ids': seat_ids}, format='json',
        )

    def test_reserving_seats_holds_them_and_schedules_the_10_minute_expiry(self, cancel_task):
        response = self.reserve([self.seats[0].id, self.seats[1].id])

        self.assertEqual(response.status_code, 201, response.data)
        reservation = Reservation.objects.get()
        self.assertEqual(reservation.status, Reservation.StatusType.PENDING)
        self.assertEqual(reservation.total_price, 40)
        self.assertEqual(reservation.seats.count(), 2)
        cancel_task.apply_async.assert_called_once_with(args=[reservation.id], countdown=600)

    def test_unverified_user_cannot_reserve(self, cancel_task):
        unverified = make_user(email='new@example.com', verified=False)
        response = self.reserve([self.seats[0].id], client=client_for(unverified))
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Reservation.objects.exists())

    def test_anonymous_user_cannot_reserve(self, cancel_task):
        response = self.client.__class__().post(URL, {}, format='json')
        self.assertEqual(response.status_code, 401)

    def test_a_booked_seat_cannot_be_booked_again(self, cancel_task):
        book(make_user(email='first@example.com'), self.showtime, [self.seats[0]])

        response = self.reserve([self.seats[0].id, self.seats[1].id])

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Reservation.objects.count(), 1, 'nothing partial may be created')

    def test_seats_from_a_cancelled_reservation_are_bookable_again(self, cancel_task):
        old = book(make_user(email='first@example.com'), self.showtime, [self.seats[0]])
        old.cancel()

        self.assertEqual(self.reserve([self.seats[0].id]).status_code, 201)

    def test_seat_being_reserved_by_someone_else_right_now_is_refused(self, cancel_task):
        # Another request holds the short-lived lock but has not written its rows yet.
        cache.add(seat_lock_key(self.showtime, self.seats[1].id), 999)

        response = self.reserve([self.seats[0].id, self.seats[1].id])

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Reservation.objects.exists())
        self.assertIsNone(
            cache.get(seat_lock_key(self.showtime, self.seats[0].id)),
            'locks taken before the conflict must be released',
        )

    def test_locks_are_released_after_a_successful_booking(self, cancel_task):
        self.reserve([self.seats[0].id])
        self.assertIsNone(cache.get(seat_lock_key(self.showtime, self.seats[0].id)))

    def test_seat_from_another_hall_is_refused(self, cancel_task):
        other_seat = make_hall(name='Hall 2').seats.first()
        self.assertEqual(self.reserve([other_seat.id]).status_code, 400)

    def test_duplicate_seat_ids_are_refused(self, cancel_task):
        self.assertEqual(self.reserve([self.seats[0].id, self.seats[0].id]).status_code, 400)

    def test_empty_seat_list_is_refused(self, cancel_task):
        self.assertEqual(self.reserve([]).status_code, 400)


class ReservationAccessTests(TestCase):
    def setUp(self):
        self.showtime = make_showtime()
        seat = self.showtime.hall.seats.first()
        self.owner = make_user(email='owner@example.com')
        self.reservation = book(self.owner, self.showtime, [seat])

    def test_list_shows_only_my_reservations(self):
        stranger = make_user(email='stranger@example.com')
        self.assertEqual([r['id'] for r in client_for(self.owner).get(URL).data], [self.reservation.id])
        self.assertEqual(client_for(stranger).get(URL).data, [])

    def test_owner_can_see_their_reservation(self):
        response = client_for(self.owner).get(f'{URL}{self.reservation.id}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['seats']), 1)

    def test_another_user_cannot_see_it(self):
        stranger = make_user(email='stranger@example.com')
        response = client_for(stranger).get(f'{URL}{self.reservation.id}/')
        self.assertEqual(response.status_code, 403)

    def test_staff_can_see_it(self):
        staff = make_user(email='staff@example.com', is_staff=True)
        self.assertEqual(client_for(staff).get(f'{URL}{self.reservation.id}/').status_code, 200)


class CancelUnpaidReservationTaskTests(TestCase):
    def setUp(self):
        self.showtime = make_showtime()
        self.seat = self.showtime.hall.seats.first()
        self.reservation = book(make_user(), self.showtime, [self.seat])

    def assert_status(self, expected):
        self.reservation.refresh_from_db()
        self.assertEqual(self.reservation.status, expected)

    def test_unpaid_reservation_is_cancelled_and_its_seats_released(self):
        cancel_reservation_if_unpaid(self.reservation.id)

        self.assert_status(Reservation.StatusType.CANCELLED)
        self.assertFalse(ReservationSeat.objects.exists())

    def test_paid_reservation_is_left_alone(self):
        Payment.objects.create(reservation=self.reservation, stripe_payment_intent_id='pi_1',
                               amount=20, status='succeeded')
        cancel_reservation_if_unpaid(self.reservation.id)
        self.assert_status(Reservation.StatusType.PENDING)

    @mock.patch('stripe.PaymentIntent.retrieve', return_value={'status': 'succeeded'})
    def test_paid_at_stripe_but_webhook_not_arrived_yet_is_left_alone(self, retrieve):
        Payment.objects.create(reservation=self.reservation, stripe_payment_intent_id='pi_1',
                               amount=20, status='pending')
        cancel_reservation_if_unpaid(self.reservation.id)

        retrieve.assert_called_once_with('pi_1')
        self.assert_status(Reservation.StatusType.PENDING)

    @mock.patch('stripe.PaymentIntent.retrieve', return_value={'status': 'requires_payment_method'})
    def test_unpaid_at_stripe_is_cancelled(self, retrieve):
        Payment.objects.create(reservation=self.reservation, stripe_payment_intent_id='pi_1',
                               amount=20, status='pending')
        cancel_reservation_if_unpaid(self.reservation.id)
        self.assert_status(Reservation.StatusType.CANCELLED)

    @mock.patch('stripe.PaymentIntent.retrieve', side_effect=ConnectionError('Stripe unreachable'))
    def test_stripe_outage_retries_instead_of_cancelling(self, retrieve):
        Payment.objects.create(reservation=self.reservation, stripe_payment_intent_id='pi_1',
                               amount=20, status='pending')
        with self.assertLogs('reservations.tasks', 'WARNING'), self.assertRaises(ConnectionError):
            cancel_reservation_if_unpaid(self.reservation.id)
        self.assert_status(Reservation.StatusType.PENDING)

    def test_confirmed_reservation_is_never_cancelled(self):
        self.reservation.status = Reservation.StatusType.CONFIRMED
        self.reservation.save()
        cancel_reservation_if_unpaid(self.reservation.id)
        self.assert_status(Reservation.StatusType.CONFIRMED)

    def test_missing_reservation_is_ignored(self):
        cancel_reservation_if_unpaid(999_999)


class TicketEmailTaskTests(TestCase):
    def setUp(self):
        self.showtime = make_showtime()
        self.user = make_user(first_name='Ali', last_name='Valiyev')
        seats = list(self.showtime.hall.seats.order_by('row', 'number')[:2])
        self.reservation = book(self.user, self.showtime, seats, status=Reservation.StatusType.CONFIRMED)

    def test_confirmed_reservation_gets_a_ticket(self):
        send_reservation_ticket(self.reservation.id)

        self.assertEqual(len(mail.outbox), 1)
        ticket = mail.outbox[0]
        self.assertEqual(ticket.to, ['user@example.com'])
        self.assertIn('Test Film', ticket.subject)
        self.assertIn('A1, A2', ticket.body)

    def test_pending_reservation_gets_no_ticket(self):
        self.reservation.status = Reservation.StatusType.PENDING
        self.reservation.save()
        with self.assertLogs('reservations.tasks', 'ERROR'):
            send_reservation_ticket(self.reservation.id)
        self.assertEqual(mail.outbox, [])

    def test_reservation_without_seats_gets_no_ticket(self):
        self.reservation.seats.all().delete()
        with self.assertLogs('reservations.tasks', 'ERROR'):
            send_reservation_ticket(self.reservation.id)
        self.assertEqual(mail.outbox, [])
