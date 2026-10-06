# payments/views.py
import logging

import stripe
from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from drf_spectacular.utils import extend_schema
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, permissions
from reservations.models import Reservation
from reservations.tasks import send_reservation_ticket
from .models import Payment


# Create your views here.
logger = logging.getLogger(__name__)

stripe.api_key = settings.STRIPE_SECRET_KEY

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

        intent = stripe.PaymentIntent.create(
            amount=amount_in_cents,
            currency="usd",
            metadata={"reservation_id": str(reservation.id)},
            automatic_payment_methods={
                "enabled": True,
                "allow_redirects": "never",
            },
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
        try:
            payment = Payment.objects.get(stripe_payment_intent_id=intent["id"])
        except Payment.DoesNotExist:
            return HttpResponse(status=200)  # nothing to do

        # Stripe retries a webhook until it gets a 2xx and can deliver the
        # same event more than once, so this branch has to be safe to run
        # twice. Confirming an already-confirmed reservation is harmless;
        # emailing a second ticket is not.
        already_handled = payment.status == "succeeded"

        reservation = payment.reservation

        # The money is real whatever else happened, so the payment row is
        # always updated. The booking is a different question: if the hold
        # already lapsed, its seats have been released and may since have
        # been sold to somebody else. Flipping it to CONFIRMED would hand
        # the customer a reservation with no seats behind it, so that case
        # is left alone and logged for a refund instead.
        payable = reservation.status in (
            Reservation.StatusType.PENDING,
            Reservation.StatusType.CONFIRMED,
        )

        if not payable:
            logger.error(
                "Payment %s succeeded for reservation %s, but that reservation is %s. "
                "Seats were already released — this needs refunding by hand.",
                intent["id"], reservation.id, reservation.status,
            )

        with transaction.atomic():
            payment.status = "succeeded"
            payment.save()

            if payable:
                reservation.status = Reservation.StatusType.CONFIRMED
                reservation.save()

            if payable and not already_handled:
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
        try:
            payment = Payment.objects.get(stripe_payment_intent_id=intent["id"])
        except Payment.DoesNotExist:
            return HttpResponse(status=200)

        payment.status = "failed"
        payment.save()
        # releases the ReservationSeat rows too, so the seats go back on sale
        payment.reservation.cancel()

    return HttpResponse(status=200)
