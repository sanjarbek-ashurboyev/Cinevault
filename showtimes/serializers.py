from rest_framework.fields import CharField, SerializerMethodField
from rest_framework.serializers import ModelSerializer

from halls.models import Seat
from showtimes.models import Showtime


class ShowtimeSerialer(ModelSerializer):
    class Meta:
        model = Showtime
        fields = '__all__'


class SeatMapSerializer(ModelSerializer):
    status = SerializerMethodField()
    label = CharField(read_only=True)

    class Meta:
        model = Seat
        fields = ['id', 'row', 'number', 'label', 'status']

    def get_status(self, seat):
        booked_seat_ids = self.context.get('booked_seat_ids', set())
        return 'booked' if seat.id in booked_seat_ids else 'available'