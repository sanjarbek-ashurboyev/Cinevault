"""The Stripe webhook and the 10-minute hold expiry racing for the same reservation.

Both touch one reservation from different processes (a gunicorn worker and a
Celery worker). These tests hold a row lock in the test's own transaction, start
the other side in a thread, and check it waits for the lock and then acts on
what was committed, not on what it read before.

SQLite ignores SELECT ... FOR UPDATE, so they only run against PostgreSQL:

    TEST_DB=postgres POSTGRES_PASSWORD=... python manage.py test --settings=root.settings_test
"""
import threading
import time
from unittest import mock, skipUnless

from django.db import connection, transaction
from django.test import Client, TransactionTestCase

from payments.models import Payment
from reservations.models import Reservation, ReservationSeat
from reservations.tasks import cancel_reservation_if_unpaid
from test_helpers import make_showtime, make_user

WEBHOOK = '/api/v1/payments/webhook/'


def run_in_thread(target):
    """Start `target` on its own database connection; the returned join() re-raises its errors."""
    errors = []

    def wrapper():
        try:
            target()
        except Exception as exc:  # surfaced in the test thread by join()
            errors.append(exc)
        finally:
            connection.close()

    thread = threading.Thread(target=wrapper)
    thread.start()

    def join():
        thread.join(timeout=10)
        if thread.is_alive():
            raise AssertionError('the other transaction never finished')
        if errors:
            raise errors[0]

    return join


def wait_until_blocked_on_a_lock(timeout=5):
    """Return once another connection is waiting for a row lock this transaction holds."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with connection.cursor() as cursor:
            # Inside a transaction PostgreSQL keeps serving the first pg_stat_activity
            # snapshot it took, so throw it away on every poll.
            cursor.execute('SELECT pg_stat_clear_snapshot()')
            cursor.execute(
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE datname = current_database() AND wait_event_type = 'Lock'"
            )
            if cursor.fetchone()[0]:
                return
        time.sleep(0.02)
    raise AssertionError('the other transaction never waited for the row lock')


@skipUnless(connection.vendor == 'postgresql', 'row locks need PostgreSQL')
class WebhookVersusHoldExpiryTests(TransactionTestCase):
    def setUp(self):
        showtime = make_showtime(price=20)
        self.reservation = Reservation.objects.create(
            user=make_user(), showtime=showtime, total_price=40,
        )
        ReservationSeat.objects.bulk_create(
            ReservationSeat(reservation=self.reservation, seat=s, showtime=showtime)
            for s in showtime.hall.seats.all()[:2]
        )
        self.payment = Payment.objects.create(
            reservation=self.reservation, stripe_payment_intent_id='pi_123', amount=40,
        )

    def refresh(self):
        self.payment.refresh_from_db()
        self.reservation.refresh_from_db()

    @mock.patch('payments.views.refund_late_payment')
    @mock.patch('payments.views.send_reservation_ticket')
    @mock.patch('payments.views.stripe.Webhook.construct_event',
                return_value={'type': 'payment_intent.succeeded', 'data': {'object': {'id': 'pi_123'}}})
    def test_payment_landing_while_the_hold_expires_is_not_confirmed_without_seats(self, construct_event, ticket, refund):
        def deliver_webhook():
            Client().post(WEBHOOK, b'{}', content_type='application/json', HTTP_STRIPE_SIGNATURE='t=1,v1=sig')

        with self.assertLogs('payments.views', 'WARNING') as logs:
            with transaction.atomic():
                # The expiry task has locked the reservation and is mid-cancel.
                reservation = Reservation.objects.select_for_update().get(pk=self.reservation.pk)
                join = run_in_thread(deliver_webhook)
                wait_until_blocked_on_a_lock()
                reservation.cancel()
            join()

        self.refresh()
        self.assertEqual(self.reservation.status, Reservation.StatusType.CANCELLED,
                         'a confirmed booking with no seats behind it is the bug')
        self.assertFalse(ReservationSeat.objects.exists())
        self.assertEqual(self.payment.status, 'refunding', 'the seats are gone, so the money goes back')
        self.assertIn('being refunded', logs.output[0])
        refund.delay.assert_called_once_with(self.payment.pk)
        ticket.delay.assert_not_called()

    @mock.patch('stripe.PaymentIntent.retrieve', return_value={'status': 'requires_payment_method'})
    def test_hold_expiry_does_not_cancel_a_booking_the_webhook_just_confirmed(self, retrieve):
        # Stripe still said "unpaid" when the task asked; the customer paid a moment later.
        with transaction.atomic():
            # The webhook has locked the reservation and is confirming it.
            reservation = Reservation.objects.select_for_update().get(pk=self.reservation.pk)
            join = run_in_thread(lambda: cancel_reservation_if_unpaid(self.reservation.pk))
            wait_until_blocked_on_a_lock()
            Payment.objects.filter(pk=self.payment.pk).update(status='succeeded')
            reservation.status = Reservation.StatusType.CONFIRMED
            reservation.save(update_fields=['status'])
        join()

        self.refresh()
        self.assertEqual(self.reservation.status, Reservation.StatusType.CONFIRMED)
        self.assertEqual(ReservationSeat.objects.count(), 2, 'a paid customer keeps their seats')
