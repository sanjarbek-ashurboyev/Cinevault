from django.db import transaction
from django.db.models import CASCADE, SET_NULL, ForeignKey, Model
from django.db.models.enums import TextChoices
from django.db.models.fields import CharField, DateTimeField, DecimalField


# Create your models here.
class Reservation(Model):
    class StatusType(TextChoices):
        PENDING = 'pending', 'Pending'
        CONFIRMED = 'confirmed', 'Confirmed'
        CANCELLED = 'cancelled', 'Cancelled'

    user = ForeignKey('accounts.User', on_delete=SET_NULL, related_name='reservations', null=True)
    showtime = ForeignKey('showtimes.Showtime', on_delete=CASCADE, related_name='reservations')
    status = CharField(max_length=9, choices=StatusType, default=StatusType.PENDING)
    created_at = DateTimeField(auto_now_add=True)
    total_price = DecimalField(max_digits=12, decimal_places=0)

    def cancel(self):
        with transaction.atomic():
            self.status = self.StatusType.CANCELLED
            self.save(update_fields=['status'])
            self.seats.all().delete()

    def __str__(self):
        return f"Reservation #{self.id} - {self.user.email} - {self.status}"


class ReservationSeat(Model):
    reservation = ForeignKey('reservations.Reservation', on_delete=CASCADE, related_name='seats')
    seat = ForeignKey('halls.Seat', on_delete=CASCADE)
    showtime = ForeignKey('showtimes.Showtime', on_delete=CASCADE)

    class Meta:
        unique_together = ('seat', 'showtime')

    def __str__(self):
        return f"{self.seat} - {self.showtime}"
