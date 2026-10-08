from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.fields import IntegerField, ListField
from rest_framework.serializers import ModelSerializer

from halls.models import Seat
from halls.serializers import SeatSerializer
from reservations.models import Reservation, ReservationSeat
from utils import seat_lock_key

from .tasks import cancel_reservation_if_unpaid

SEAT_LOCK_TTL = 600



class ReservationCreateSerializer(ModelSerializer):
    seat_ids = ListField(
        child=IntegerField(),
        write_only=True,
        allow_empty=False,
    )

    class Meta:
        model = Reservation
        fields = ['id', 'showtime', 'seat_ids', 'status', 'total_price', 'created_at']
        read_only_fields = ['id', 'status', 'total_price', 'created_at']

    def validate(self, attrs):
        showtime = attrs['showtime']
        seat_ids = attrs['seat_ids']
        if showtime.start_time <= timezone.now():
            raise ValidationError("This showtime has already started.")

        if len(seat_ids) != len(set(seat_ids)):
            raise ValidationError("Duplicate seat IDs in request.")

        seats = Seat.objects.filter(id__in=seat_ids, hall=showtime.hall)
        if seats.count() != len(seat_ids):
            raise ValidationError("One or more seats are invalid for this showtime's hall.")

        # Only count seats as taken if their reservation is still pending or confirmed —
        # a cancelled reservation's seats should be bookable again.
        already_booked = ReservationSeat.objects.filter(
            showtime=showtime,
            seat__id__in=seat_ids,
            reservation__status__in=[
                Reservation.StatusType.PENDING,
                Reservation.StatusType.CONFIRMED,
            ],
        )
        if already_booked.exists():
            taken_ids = list(already_booked.values_list('seat_id', flat=True))
            raise ValidationError(f"Seat(s) already booked: {taken_ids}")

        attrs['seats'] = seats
        return attrs

    def create(self, validated_data):
        seats = list(validated_data.pop('seats'))
        validated_data.pop('seat_ids')
        showtime = validated_data['showtime']
        user = self.context['request'].user

        acquired_keys = []
        for seat in seats:
            key = seat_lock_key(showtime, seat.id)
            if cache.add(key, user.id, timeout=SEAT_LOCK_TTL):
                acquired_keys.append(key)
            else:
                cache.delete_many(acquired_keys)
                raise ValidationError(
                    f"Seat {seat.id} is currently being reserved by another user."
                )

        total_price = showtime.price * len(seats)
        try:
            with transaction.atomic():
                reservation = Reservation.objects.create(
                    user=user,
                    showtime=showtime,
                    status=Reservation.StatusType.PENDING,
                    total_price=total_price,
                )
                ReservationSeat.objects.bulk_create([
                    ReservationSeat(reservation=reservation, seat=seat, showtime=showtime)
                    for seat in seats
                ])
        except IntegrityError:
            cache.delete_many(acquired_keys)
            raise ValidationError(
                "One or more seats were just booked by someone else. Please choose different seats."
            ) from None

        # DB commit succeeded — the ReservationSeat rows themselves are now
        # what future validate() calls check, so the Redis lock has done its job.
        cache.delete_many(acquired_keys)

        # Schedule auto-cancel in case the user never pays (Step 3)
        cancel_reservation_if_unpaid.apply_async(
            args=[reservation.id], countdown=600  # 10 minutes
        )

        return reservation


class ReservationSeatSerializer(ModelSerializer):
    seat = SeatSerializer(
        read_only=True)

    class Meta:
        model = ReservationSeat
        fields = ['id', 'seat']


class ReservationSerializer(ModelSerializer):
    seats = ReservationSeatSerializer(many=True, read_only=True)

    class Meta:
        model = Reservation
        fields = ['id', 'showtime', 'status', 'total_price', 'created_at', 'seats']

