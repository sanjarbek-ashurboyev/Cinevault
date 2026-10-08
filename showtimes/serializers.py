from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.fields import CharField, SerializerMethodField
from rest_framework.serializers import ModelSerializer

from halls.models import Seat
from showtimes.models import NO_OVERLAP_CONSTRAINT, Showtime


def _local(moment):
    return timezone.localtime(moment).strftime('%Y-%m-%d %H:%M')


class ShowtimeSerialer(ModelSerializer):
    class Meta:
        model = Showtime
        fields = '__all__'

    def validate(self, attrs):
        def value(name):
            return attrs[name] if name in attrs else getattr(self.instance, name)

        start, end, hall = value('start_time'), value('end_time'), value('hall')
        if end <= start:
            raise ValidationError({'end_time': "The end time must be after the start time."})

        # Touching is fine: a show may start the minute the previous one ends.
        clashes = Showtime.objects.filter(hall=hall, start_time__lt=end, end_time__gt=start)
        if self.instance is not None:
            clashes = clashes.exclude(pk=self.instance.pk)
        clash = clashes.select_related('movie').order_by('start_time').first()
        if clash:
            raise ValidationError(
                f"{hall.name} already shows {clash.movie.title} from {_local(clash.start_time)} "
                f"to {_local(clash.end_time)}."
            )
        return attrs

    def save(self, **kwargs):
        try:
            with transaction.atomic():
                return super().save(**kwargs)
        except IntegrityError as error:
            # Two requests passed validate() at once; PostgreSQL let only the first one in.
            if NO_OVERLAP_CONSTRAINT not in str(error):
                raise
            raise ValidationError("Another showtime was just scheduled in this hall at this time.") from None


class SeatMapSerializer(ModelSerializer):
    status = SerializerMethodField()
    label = CharField(read_only=True)

    class Meta:
        model = Seat
        fields = ['id', 'row', 'number', 'label', 'status']

    def get_status(self, seat):
        booked_seat_ids = self.context.get('booked_seat_ids', set())
        return 'booked' if seat.id in booked_seat_ids else 'available'