
# Create your models here.
from django.db.models import (
    CASCADE,
    CharField,
    DateTimeField,
    DecimalField,
    Model,
    OneToOneField,
)

from reservations.models import Reservation


class Payment(Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("succeeded", "Succeeded"),
        ("failed", "Failed"),
        # Paid after the seat hold expired: the seats were gone, so the money goes back.
        ("refunding", "Refunding"),
        ("refunded", "Refunded"),
        ("refund_failed", "Refund failed"),
    ]

    reservation = OneToOneField(Reservation, on_delete=CASCADE, related_name="payment")
    stripe_payment_intent_id = CharField(max_length=255, unique=True)
    stripe_refund_id = CharField(max_length=255, blank=True)
    amount = DecimalField(max_digits=10, decimal_places=2)
    status = CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    created_at = DateTimeField(auto_now_add=True)