from datetime import timedelta
from io import StringIO
from types import SimpleNamespace
from unittest import mock

import stripe
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from payments.models import Payment
from payments.tasks import refund_late_payment
from reservations.models import Reservation, ReservationSeat
from test_helpers import client_for, make_showtime, make_user

WEBHOOK = '/api/v1/payments/webhook/'


def make_reservation(user, status=Reservation.StatusType.PENDING):
    showtime = make_showtime(price=20)
    reservation = Reservation.objects.create(user=user, showtime=showtime, status=status, total_price=40)
    ReservationSeat.objects.bulk_create(
        ReservationSeat(reservation=reservation, seat=s, showtime=showtime)
        for s in showtime.hall.seats.all()[:2]
    )
    return reservation


@mock.patch('payments.views.stripe.PaymentIntent.create',
            return_value=SimpleNamespace(id='pi_123', client_secret='pi_123_secret'))
class CreatePaymentIntentTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.reservation = make_reservation(self.user)

    def url(self, reservation_id=None):
        return f'/api/v1/payments/create-intent/{reservation_id or self.reservation.id}/'

    def test_creates_intent_for_the_reservation_total(self, create):
        response = client_for(self.user).post(self.url())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {'client_secret': 'pi_123_secret'})
        self.assertEqual(create.call_args.kwargs['amount'], 4000, 'Stripe amounts are in cents')
        self.assertEqual(create.call_args.kwargs['metadata'], {'reservation_id': str(self.reservation.id)})
        payment = Payment.objects.get()
        self.assertEqual((payment.stripe_payment_intent_id, payment.amount, payment.status), ('pi_123', 40, 'pending'))

    def retrieve_returns(self, intent_status, amount=4000):
        return mock.patch(
            'payments.views.stripe.PaymentIntent.retrieve',
            return_value=SimpleNamespace(id='pi_123', client_secret='pi_123_secret',
                                         status=intent_status, amount=amount),
        )

    def test_reopening_checkout_reuses_the_unpaid_intent(self, create):
        # Otherwise a customer who pays in an older tab pays an intent nobody tracks.
        client = client_for(self.user)
        client.post(self.url())

        with self.retrieve_returns('requires_payment_method') as retrieve:
            response = client.post(self.url())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {'client_secret': 'pi_123_secret'})
        retrieve.assert_called_once_with('pi_123')
        create.assert_called_once()
        self.assertEqual(Payment.objects.get().stripe_payment_intent_id, 'pi_123')

    def test_an_intent_needing_3d_secure_is_reused(self, create):
        client = client_for(self.user)
        client.post(self.url())

        with self.retrieve_returns('requires_action'):
            self.assertEqual(client.post(self.url()).data, {'client_secret': 'pi_123_secret'})
        create.assert_called_once()

    def test_a_paid_intent_is_not_replaced(self, create):
        client = client_for(self.user)
        client.post(self.url())

        for intent_status in ('succeeded', 'processing'):
            with self.subTest(intent_status), self.retrieve_returns(intent_status):
                response = client.post(self.url())
            self.assertEqual(response.status_code, 409)
        create.assert_called_once()
        self.assertEqual(Payment.objects.get().stripe_payment_intent_id, 'pi_123')

    def test_a_cancelled_intent_is_replaced(self, create):
        client = client_for(self.user)
        client.post(self.url())
        create.return_value = SimpleNamespace(id='pi_456', client_secret='pi_456_secret')

        with self.retrieve_returns('canceled'):
            response = client.post(self.url())

        self.assertEqual(response.data, {'client_secret': 'pi_456_secret'})
        self.assertEqual(Payment.objects.get().stripe_payment_intent_id, 'pi_456')
        self.assertEqual(
            create.call_args.kwargs['idempotency_key'],
            f'cinevault-reservation-{self.reservation.id}-replacing-pi_123',
        )

    def test_an_intent_for_a_different_amount_is_replaced(self, create):
        client = client_for(self.user)
        client.post(self.url())

        with self.retrieve_returns('requires_payment_method', amount=999):
            client.post(self.url())

        self.assertEqual(create.call_count, 2)

    def test_simultaneous_first_requests_get_the_same_idempotency_key(self, create):
        # Stripe returns the same intent for a repeated key, so a double click makes one intent.
        client_for(self.user).post(self.url())
        Payment.objects.all().delete()  # as seen by a request racing the first one
        client_for(self.user).post(self.url())

        first, second = (call.kwargs['idempotency_key'] for call in create.call_args_list)
        self.assertEqual(first, second)
        self.assertEqual(first, f'cinevault-reservation-{self.reservation.id}-replacing-none')

    def test_stripe_failure_returns_502_and_stores_nothing(self, create):
        create.side_effect = stripe.error.APIConnectionError('network down')

        with self.assertLogs('payments.views', 'ERROR'):
            response = client_for(self.user).post(self.url())

        self.assertEqual(response.status_code, 502)
        self.assertIn('try again', response.data['detail'])
        self.assertFalse(Payment.objects.exists())

    def test_stripe_failure_while_checking_the_old_intent_returns_502(self, create):
        client = client_for(self.user)
        client.post(self.url())

        with mock.patch('payments.views.stripe.PaymentIntent.retrieve',
                        side_effect=stripe.error.APIConnectionError('network down')), \
                self.assertLogs('payments.views', 'ERROR'):
            response = client.post(self.url())

        self.assertEqual(response.status_code, 502)
        create.assert_called_once()

    def test_cannot_pay_for_someone_elses_reservation(self, create):
        stranger = make_user(email='stranger@example.com')
        self.assertEqual(client_for(stranger).post(self.url()).status_code, 404)
        create.assert_not_called()

    def test_cannot_pay_for_a_cancelled_reservation(self, create):
        self.reservation.cancel()
        self.assertEqual(client_for(self.user).post(self.url()).status_code, 400)
        create.assert_not_called()

    def test_cannot_pay_once_the_showtime_has_started(self, create):
        showtime = self.reservation.showtime
        showtime.start_time = timezone.now() - timedelta(minutes=1)
        showtime.save()

        response = client_for(self.user).post(self.url())

        self.assertEqual(response.status_code, 400)
        create.assert_not_called()

    def test_requires_login(self, create):
        self.assertEqual(APIClient().post(self.url()).status_code, 401)


@mock.patch('payments.views.send_reservation_ticket')
@mock.patch('payments.views.stripe.Webhook.construct_event')
class StripeWebhookTests(TestCase):
    def setUp(self):
        self.reservation = make_reservation(make_user())
        self.payment = Payment.objects.create(
            reservation=self.reservation, stripe_payment_intent_id='pi_123', amount=40,
        )

    def deliver(self, construct_event, event_type, intent_id='pi_123', metadata=None):
        intent = {'id': intent_id, 'metadata': metadata or {}}
        construct_event.return_value = {'type': event_type, 'data': {'object': intent}}
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(WEBHOOK, b'{}', content_type='application/json',
                                    HTTP_STRIPE_SIGNATURE='t=1,v1=sig')

    def refresh(self):
        self.payment.refresh_from_db()
        self.reservation.refresh_from_db()

    def test_bad_signature_is_rejected(self, construct_event, ticket):
        construct_event.side_effect = stripe.error.SignatureVerificationError('bad', 't=1,v1=sig')
        response = self.client.post(WEBHOOK, b'{}', content_type='application/json',
                                    HTTP_STRIPE_SIGNATURE='t=1,v1=sig')

        self.assertEqual(response.status_code, 400)
        self.refresh()
        self.assertEqual(self.reservation.status, Reservation.StatusType.PENDING)

    def test_signature_is_checked_with_the_webhook_secret(self, construct_event, ticket):
        self.deliver(construct_event, 'payment_intent.succeeded')
        payload, header, secret = construct_event.call_args.args
        self.assertEqual((header, secret), ('t=1,v1=sig', 'whsec_dummy'))

    def test_successful_payment_confirms_and_sends_one_ticket(self, construct_event, ticket):
        response = self.deliver(construct_event, 'payment_intent.succeeded')

        self.assertEqual(response.status_code, 200)
        self.refresh()
        self.assertEqual(self.payment.status, 'succeeded')
        self.assertEqual(self.reservation.status, Reservation.StatusType.CONFIRMED)
        ticket.delay.assert_called_once_with(self.reservation.id)

    def test_duplicate_event_does_not_send_a_second_ticket(self, construct_event, ticket):
        self.deliver(construct_event, 'payment_intent.succeeded')
        self.deliver(construct_event, 'payment_intent.succeeded')

        ticket.delay.assert_called_once()
        self.refresh()
        self.assertEqual(self.reservation.status, Reservation.StatusType.CONFIRMED)

    def test_failed_payment_cancels_and_releases_seats(self, construct_event, ticket):
        response = self.deliver(construct_event, 'payment_intent.payment_failed')

        self.assertEqual(response.status_code, 200)
        self.refresh()
        self.assertEqual(self.payment.status, 'failed')
        self.assertEqual(self.reservation.status, Reservation.StatusType.CANCELLED)
        self.assertFalse(ReservationSeat.objects.exists())
        ticket.delay.assert_not_called()

    def test_late_failure_event_does_not_undo_a_successful_payment(self, construct_event, ticket):
        # Stripe does not guarantee event order: a declined first card can be
        # reported after a second card on the same intent already paid.
        self.deliver(construct_event, 'payment_intent.succeeded')
        response = self.deliver(construct_event, 'payment_intent.payment_failed')

        self.assertEqual(response.status_code, 200)
        self.refresh()
        self.assertEqual(self.payment.status, 'succeeded')
        self.assertEqual(self.reservation.status, Reservation.StatusType.CONFIRMED)
        self.assertEqual(ReservationSeat.objects.count(), 2)

    def test_unknown_payment_intent_is_acknowledged(self, construct_event, ticket):
        with self.assertNoLogs('payments.views', 'ERROR'):
            response = self.deliver(construct_event, 'payment_intent.succeeded', intent_id='pi_unknown')
        self.assertEqual(response.status_code, 200, 'Stripe would retry forever on a non-2xx')
        ticket.delay.assert_not_called()

    def test_payment_on_a_replaced_intent_is_flagged(self, construct_event, ticket):
        # A tab opened before checkout was reopened can still pay the old intent.
        metadata = {'reservation_id': str(self.reservation.id)}
        with self.assertLogs('payments.views', 'ERROR') as logs:
            response = self.deliver(construct_event, 'payment_intent.succeeded',
                                    intent_id='pi_old', metadata=metadata)

        self.assertEqual(response.status_code, 200)
        self.assertIn('pi_old', logs.output[0])
        self.refresh()
        self.assertEqual(self.reservation.status, Reservation.StatusType.PENDING)
        ticket.delay.assert_not_called()

    def test_other_event_types_are_ignored(self, construct_event, ticket):
        self.assertEqual(self.deliver(construct_event, 'charge.refunded').status_code, 200)
        self.refresh()
        self.assertEqual(self.reservation.status, Reservation.StatusType.PENDING)


REFUND_CREATE = 'payments.tasks.stripe.Refund.create'


def refund(refund_id='re_123'):
    return SimpleNamespace(id=refund_id)


@mock.patch('payments.views.send_reservation_ticket')
@mock.patch('payments.views.stripe.Webhook.construct_event')
class LatePaymentRefundTests(TestCase):
    """A payment that lands after the 10-minute hold lapsed and the seats went back on sale."""

    def setUp(self):
        self.reservation = make_reservation(make_user())
        self.payment = Payment.objects.create(
            reservation=self.reservation, stripe_payment_intent_id='pi_late', amount=40,
        )
        self.reservation.cancel()

    def deliver(self, construct_event, event_type='payment_intent.succeeded'):
        construct_event.return_value = {'type': event_type, 'data': {'object': {'id': 'pi_late', 'metadata': {}}}}
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(WEBHOOK, b'{}', content_type='application/json',
                                        HTTP_STRIPE_SIGNATURE='t=1,v1=sig')
        self.assertEqual(response.status_code, 200)
        self.payment.refresh_from_db()

    def run_refunds_inline(self):
        """Run queued refund tasks in the test, the way a worker would."""
        return mock.patch('payments.views.refund_late_payment.delay',
                          side_effect=lambda payment_id: refund_late_payment.apply(args=[payment_id]))

    def test_late_payment_is_refunded_without_a_ticket(self, construct_event, ticket):
        with self.run_refunds_inline(), mock.patch(REFUND_CREATE, return_value=refund()) as create, \
                self.assertLogs('payments', 'WARNING'):
            self.deliver(construct_event)

        create.assert_called_once_with(
            payment_intent='pi_late', metadata={'reservation_id': str(self.reservation.id)},
            idempotency_key='cinevault-refund-pi_late',
        )
        self.assertEqual((self.payment.status, self.payment.stripe_refund_id), ('refunded', 're_123'))
        self.reservation.refresh_from_db()
        self.assertEqual(self.reservation.status, Reservation.StatusType.CANCELLED)
        ticket.delay.assert_not_called()

    def test_refund_is_queued_only_after_the_webhook_commits(self, construct_event, ticket):
        with mock.patch('payments.views.refund_late_payment') as task:
            construct_event.return_value = {'type': 'payment_intent.succeeded',
                                            'data': {'object': {'id': 'pi_late', 'metadata': {}}}}
            with self.captureOnCommitCallbacks() as callbacks:
                self.client.post(WEBHOOK, b'{}', content_type='application/json', HTTP_STRIPE_SIGNATURE='t=1,v1=sig')
            task.delay.assert_not_called()
            for callback in callbacks:
                callback()
            task.delay.assert_called_once_with(self.payment.id)

    def test_duplicate_deliveries_refund_once(self, construct_event, ticket):
        with self.run_refunds_inline(), mock.patch(REFUND_CREATE, return_value=refund()) as create:
            self.deliver(construct_event)
            self.deliver(construct_event)
            # A copy of the task running late (queued twice before either finished) stops too.
            refund_late_payment.apply(args=[self.payment.id])
        create.assert_called_once()
        self.assertEqual(self.payment.status, 'refunded')

    def test_redelivery_requeues_a_refund_that_never_ran(self, construct_event, ticket):
        # The first delivery committed "refunding", but queueing the task failed (say Redis
        # was down), so the webhook answered 500 and Stripe sends the event again.
        Payment.objects.filter(pk=self.payment.pk).update(status='refunding')
        with self.run_refunds_inline(), mock.patch(REFUND_CREATE, return_value=refund()) as create:
            self.deliver(construct_event)
        create.assert_called_once()
        self.assertEqual(self.payment.status, 'refunded')

    def test_stripe_outage_is_retried_with_the_same_key(self, construct_event, ticket):
        outage = stripe.error.APIConnectionError('Stripe is unreachable')
        with self.run_refunds_inline(), \
                mock.patch(REFUND_CREATE, side_effect=[outage, outage, refund('re_456')]) as create:
            self.deliver(construct_event)
        self.assertEqual(create.call_count, 3)
        self.assertEqual({c.kwargs['idempotency_key'] for c in create.call_args_list}, {'cinevault-refund-pi_late'})
        self.assertEqual((self.payment.status, self.payment.stripe_refund_id), ('refunded', 're_456'))

    def test_a_refund_still_failing_after_every_retry_is_marked_not_lost(self, construct_event, ticket):
        outage = stripe.error.APIConnectionError('Stripe is unreachable')
        with self.run_refunds_inline(), mock.patch(REFUND_CREATE, side_effect=outage) as create, \
                self.assertLogs('payments.tasks', 'ERROR') as logs:
            self.deliver(construct_event)
        self.assertEqual(create.call_count, refund_late_payment.max_retries + 1)
        self.assertEqual(self.payment.status, 'refund_failed')
        self.assertIn('refund_late_payments', logs.output[-1])

    def test_a_charge_already_refunded_in_the_dashboard_counts_as_refunded(self, construct_event, ticket):
        done = stripe.error.InvalidRequestError('Charge has already been refunded.', None,
                                                code='charge_already_refunded')
        with self.run_refunds_inline(), mock.patch(REFUND_CREATE, side_effect=done):
            self.deliver(construct_event)
        self.assertEqual(self.payment.status, 'refunded')

    def test_a_refused_refund_is_marked_failed(self, construct_event, ticket):
        refused = stripe.error.InvalidRequestError('No such payment_intent', None, code='resource_missing')
        with self.run_refunds_inline(), mock.patch(REFUND_CREATE, side_effect=refused), \
                self.assertLogs('payments.tasks', 'ERROR'):
            self.deliver(construct_event)
        self.assertEqual(self.payment.status, 'refund_failed')

    def test_a_late_failure_event_does_not_overwrite_the_refund(self, construct_event, ticket):
        with self.run_refunds_inline(), mock.patch(REFUND_CREATE, return_value=refund()):
            self.deliver(construct_event)
        self.deliver(construct_event, 'payment_intent.payment_failed')
        self.assertEqual(self.payment.status, 'refunded')

    def test_command_queues_every_late_payment_that_is_not_refunded(self, construct_event, ticket):
        # Logged for a manual refund before refunds were automatic.
        Payment.objects.filter(pk=self.payment.pk).update(status='succeeded')
        stuck = Payment.objects.create(reservation=make_reservation(make_user(email='b@example.com'),
                                                                    status=Reservation.StatusType.CANCELLED),
                                       stripe_payment_intent_id='pi_stuck', amount=40, status='refund_failed')
        Payment.objects.create(reservation=make_reservation(make_user(email='c@example.com'),
                                                              status=Reservation.StatusType.CONFIRMED),
                               stripe_payment_intent_id='pi_paid', amount=40, status='succeeded')

        with mock.patch('payments.management.commands.refund_late_payments.refund_late_payment') as task:
            call_command('refund_late_payments', stdout=StringIO())

        self.assertEqual(sorted(c.args[0] for c in task.delay.call_args_list), sorted([self.payment.id, stuck.id]))
        self.assertEqual(
            dict(Payment.objects.values_list('stripe_payment_intent_id', 'status')),
            {'pi_late': 'refunding', 'pi_stuck': 'refunding', 'pi_paid': 'succeeded'},
        )
