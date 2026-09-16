from rest_framework.fields import CharField
from rest_framework.serializers import ModelSerializer

from halls.models import Hall, Seat


class HallSerializer(ModelSerializer):
    class Meta:
        model = Hall
        fields = '__all__'

    def create(self, validated_data):
        hall = Hall.objects.create(**validated_data)
        hall.generate_seats()
        return hall


class SeatSerializer(ModelSerializer):
    label = CharField(read_only=True)

    class Meta:
        model = Seat
        fields = '__all__'

