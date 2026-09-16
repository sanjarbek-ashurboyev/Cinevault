from django.db import migrations


def release_cancelled_seats(apps, schema_editor):
    """Drop seat rows held by reservations that were already cancelled.

    Until Reservation.cancel() existed, cancelling a reservation left its
    ReservationSeat rows in place. Because of unique_together('seat',
    'showtime') those rows keep their seats unbookable for good, while the
    seat map still advertises the seats as available. This clears the ones
    already stranded; new cancellations release their own seats.
    """
    ReservationSeat = apps.get_model('reservations', 'ReservationSeat')
    ReservationSeat.objects.filter(reservation__status='cancelled').delete()


def noop(apps, schema_editor):
    """Deleting the rows is not reversible — the seats are simply free again."""


class Migration(migrations.Migration):

    dependencies = [
        ('reservations', '0002_alter_reservation_status'),
    ]

    operations = [
        migrations.RunPython(release_cancelled_seats, noop),
    ]
