"""Queue refunds that never finished, and late payments from before refunds were automatic.

    python manage.py refund_late_payments

Safe to run any time: the refund task's idempotency key means Stripe refunds a payment
once, however often it is queued.
"""
from django.core.management.base import BaseCommand
from django.db.models import Q

from payments.models import Payment
from payments.tasks import refund_late_payment
from reservations.models import Reservation


class Command(BaseCommand):
    help = "Queue a refund for every late payment that hasn't been refunded."

    def handle(self, *args, **options):
        payments = Payment.objects.filter(
            Q(status__in=["refunding", "refund_failed"])
            # Before automatic refunds the webhook marked these "succeeded" and logged them.
            | Q(status="succeeded", reservation__status=Reservation.StatusType.CANCELLED)
        )
        ids = list(payments.values_list("id", flat=True))
        Payment.objects.filter(id__in=ids).update(status="refunding")
        for payment_id in ids:
            refund_late_payment.delay(payment_id)
        self.stdout.write(f"Queued {len(ids)} refund(s).")
