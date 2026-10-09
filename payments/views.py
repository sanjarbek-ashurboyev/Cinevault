# payments/views.py
import logging

import stripe
from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from reservations.models import Reservation
from reservations.tasks import send_reservation_ticket

from .models import Payment
from .tasks import refund_late_payment

# Create your views here.
logger = logging.getLogger(__name__)

stripe.api_key = settings.STRIPE_SECRET_KEY

# The customer can still pay an intent in these states with its existing client_secret.
REUSABLE_INTENT_STATUSES = {"requires_payment_method", "requires_confirmation", "requires_action"}
# The customer has paid, or the payment is clearing; the webhook will confirm the booking.
SETTLING_INTENT_STATUSES = {"processing", "succeeded"}


# The customer's money arrived; a late failure event must not mark these "failed".
SETTLED_PAYMENT_STATUSES = {"succeeded", "refunding", "refunded", "refund_failed"}


class PaymentAlreadyMade(Exception):
    pass


def _reusable_intent(payment, amount_in_cents):
    """The intent on file for this reservation, if the customer can still pay it.

    Raises PaymentAlreadyMade when that intent is paid or clearing, so a second
    tab cannot start a second charge for the same seats.
    """
    if payment is None or not payment.stripe_payment_intent_id:
        return None
    intent = stripe.PaymentIntent.retrieve(payment.stripe_payment_intent_id)
    if intent.status in SETTLING_INTENT_STATUSES:
        raise PaymentAlreadyMade
    if intent.status in REUSABLE_INTENT_STATUSES and intent.amount == amount_in_cents:
        return intent
    return None  # cancelled by Stripe, or for a different amount


def _idempotency_key(reservation, payment):
    """Same key for requests racing to create the same intent, so Stripe returns one intent.

    Keyed on the intent being replaced, not a counter, so concurrent requests agree on it.
    """
    replacing = payment.stripe_payment_intent_id if payment else "none"
    return f"cinevault-reservation-{reservation.id}-replacing-{replacing}"

@extend_schema(tags=['payments'])
class CreatePaymentIntentView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, reservation_id):
        try:
            reservation = Reservation.objects.get(id=reservation_id, user=request.user)
        except Reservation.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        if reservation.status != Reservation.StatusType.PENDING:
            return Response({"detail": "Reservation is not payable."}, status=status.HTTP_400_BAD_REQUEST)
        # A hold placed just before the start must not be paid for once the film is running.
        if reservation.showtime.start_time <= timezone.now():
            return Response({"detail": "This showtime has already started."}, status=status.HTTP_400_BAD_REQUEST)

        amount_in_cents = int(reservation.total_price * 100)
        payment = Payment.objects.filter(reservation=reservation).first()

        # Reopening checkout used to create a fresh intent and forget the old one, so a
        # payment made on the old one (in a second tab, say) never confirmed the booking.
        try:
            intent = _reusable_intent(payment, amount_in_cents)
            if intent is None:
                intent = stripe.PaymentIntent.create(
                    amount=amount_in_cents,
                    currency="usd",
                    metadata={"reservation_id": str(reservation.id)},
                    automatic_payment_methods={
                        "enabled": True,
                        "allow_redirects": "never",
                    },
                    idempotency_key=_idempotency_key(reservation, payment),
                )
        except PaymentAlreadyMade:
            return Response(
                {"detail": "This reservation has already been paid. Your ticket will arrive by email."},
                status=status.HTTP_409_CONFLICT,
            )
        except stripe.error.StripeError:
            logger.exception("Stripe request failed for reservation %s", reservation.id)
            return Response(
                {"detail": "The payment service is unavailable. Please try again in a moment."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        Payment.objects.update_or_create(
            reservation=reservation,
            defaults={
                "stripe_payment_intent_id": intent.id,
                "amount": reservation.total_price,
                "status": "pending",
            },
        )

        return Response({"client_secret": intent.client_secret})


@csrf_exempt
def stripe_webhook(request):
    payload = request.body
    sig_header = request.META.get("HTTP_STRIPE_SIGNATURE")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError):
        return HttpResponse(status=400)

    if event["type"] == "payment_intent.succeeded":
        intent = event["data"]["object"]
        with transaction.atomic():
            locked = _lock_payment(intent["id"])
            if locked is None:
                reservation_id = (intent.get("metadata") or {}).get("reservation_id")
                if reservation_id:
                    # Ours, but no longer the reservation's intent on file: paid in a tab
                    # opened before checkout was reopened (possible before intents were reused).
                    logger.error(
                        "Payment %s succeeded for reservation %s, but that reservation's payment "
                        "is a different intent. Match or refund it by hand.",
                        intent["id"], reservation_id,
                    )
                return HttpResponse(status=200)
            payment, reservation = locked

            # Stripe retries a webhook until it gets a 2xx and can deliver the
            # same event more than once, so this branch has to be safe to run
            # twice. Confirming an already-confirmed reservation is harmless;
            # emailing a second ticket is not.
            already_handled = payment.status == "succeeded"

            # If the hold already lapsed, its seats have been released and may
            # since have been sold to somebody else. Flipping the booking to
            # CONFIRMED would hand the customer a reservation with no seats
            # behind it, so the money goes back instead.
            payable = reservation.status in (
                Reservation.StatusType.PENDING,
                Reservation.StatusType.CONFIRMED,
            )

            if not payable:
                # A redelivered event queues the refund again unless it's done: if
                # queueing failed last time, this is how it gets another chance.
                # The task's idempotency key keeps it to one refund at Stripe.
                if payment.status != "refunded":
                    logger.warning(
                        "Payment %s succeeded for reservation %s, but that reservation is %s. "
                        "Seats were already released, so it is being refunded.",
                        intent["id"], reservation.id, reservation.status,
                    )
                    payment.status = "refunding"
                    payment.save(update_fields=["status"])
                    payment_id = payment.id
                    transaction.on_commit(lambda: refund_late_payment.delay(payment_id))
                return HttpResponse(status=200)

            payment.status = "succeeded"
            payment.save(update_fields=["status"])

            reservation.status = Reservation.StatusType.CONFIRMED
            reservation.save(update_fields=["status"])

            if not already_handled:
                # Queued rather than sent inline: Stripe expects an answer
                # within seconds and an SMTP round trip does not belong in
                # that budget. on_commit means the worker never picks up a
                # reservation this transaction has not written yet.
                reservation_id = reservation.id
                transaction.on_commit(
                    lambda: send_reservation_ticket.delay(reservation_id)
                )

    elif event["type"] == "payment_intent.payment_failed":
        intent = event["data"]["object"]
        with transaction.atomic():
            locked = _lock_payment(intent["id"])
            if locked is None:
                return HttpResponse(status=200)
            payment, reservation = locked

            # Stripe does not promise to deliver events in order. A declined
            # first card can be reported after a second card already paid on
            # the same intent; cancelling then would take the seats from a
            # paying customer.
            if payment.status in SETTLED_PAYMENT_STATUSES:
                return HttpResponse(status=200)

            payment.status = "failed"
            payment.save(update_fields=["status"])
            if reservation.status == Reservation.StatusType.PENDING:
                # releases the ReservationSeat rows too, so the seats go back on sale
                reservation.cancel()

    return HttpResponse(status=200)


def _lock_payment(intent_id):
    """Lock the reservation and payment behind a PaymentIntent, or None if it isn't ours.

    The hold-expiry task (reservations.tasks.cancel_reservation_if_unpaid)
    can be cancelling the same reservation at this very moment. Without the
    lock each side decides from a status it read before the other committed,
    and the last write wins: a paid booking gets cancelled, or a cancelled one
    gets confirmed with no seats behind it. Locked, one side waits and then
    sees what the other did.

    Always reservation first, then payment — the task locks in the same order,
    so the two can never deadlock. Call inside transaction.atomic().
    """
    reservation_id = (
        Payment.objects
        .filter(stripe_payment_intent_id=intent_id)
        .values_list("reservation_id", flat=True)
        .first()
    )
    if reservation_id is None:
        return None
    reservation = Reservation.objects.select_for_update().get(pk=reservation_id)
    payment = Payment.objects.select_for_update().get(stripe_payment_intent_id=intent_id)
    return payment, reservation
