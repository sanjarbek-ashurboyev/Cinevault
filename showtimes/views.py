from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema
from rest_framework.generics import (
    GenericAPIView,
    ListCreateAPIView,
    RetrieveUpdateDestroyAPIView,
    get_object_or_404,
)
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from halls.models import Seat
from permissions import IsSuperUser
from reservations.models import Reservation, ReservationSeat
from showtimes.filters import ShowtimeFilterset
from showtimes.models import Showtime
from showtimes.serializers import SeatMapSerializer, ShowtimeSerialer


# Create your views here.
@extend_schema(tags=['showtimes'])
class ShowtimesListAPIView(ListCreateAPIView):
    queryset = Showtime.objects.order_by('start_time', 'id')
    serializer_class = ShowtimeSerialer
    filter_backends = [DjangoFilterBackend]
    filterset_class = ShowtimeFilterset

    def get_permissions(self):
        if self.request.method == "GET":
            permission_classes = [AllowAny]
        else:
            permission_classes = [IsSuperUser]
        return [permission() for permission in permission_classes]



@extend_schema(tags=['showtimes'])
class ShowtimeDetailAPIView(RetrieveUpdateDestroyAPIView):
    queryset = Showtime.objects.all()
    serializer_class = ShowtimeSerialer
    http_method_names = ['get', 'put', 'delete']
    lookup_url_kwarg = 'id'

    def get_permissions(self):
        if self.request.method == "GET":
            permission_classes = [AllowAny]
        else:
            permission_classes = [IsSuperUser]
        return [permission() for permission in permission_classes]


@extend_schema(tags=['showtimes'])
class ShowtimeSeatMapView(GenericAPIView):
    serializer_class = SeatMapSerializer
    permission_classes = [AllowAny]

    def get(self, request, pk):
        showtime = get_object_or_404(Showtime, pk=pk)

        seats = list(Seat.objects.filter(hall=showtime.hall).order_by('row', 'number'))

        booked_seat_ids = set(
            ReservationSeat.objects.filter(
                showtime=showtime,
                reservation__status__in=[
                    Reservation.StatusType.PENDING,
                    Reservation.StatusType.CONFIRMED,
                ],
            ).values_list('seat_id', flat=True)
        )

        serializer = self.get_serializer(
            seats,
            many=True,
            context={'booked_seat_ids': booked_seat_ids},
        )
        return Response({
            'showtime_id': showtime.id,
            'hall': showtime.hall.name,
            'seats': serializer.data,
        })









