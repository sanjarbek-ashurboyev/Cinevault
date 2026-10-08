from drf_spectacular.utils import extend_schema
from rest_framework.generics import ListAPIView, ListCreateAPIView
from rest_framework.permissions import AllowAny

from halls.models import Hall, Seat
from halls.serializers import HallSerializer, SeatSerializer
from permissions import IsSuperUser


# Create your views here.
@extend_schema(tags=['halls'])
class HallsListAPIView(ListCreateAPIView):
    queryset = Hall.objects.order_by('id')
    serializer_class = HallSerializer

    def get_permissions(self):
        if self.request.method == "GET":
            permission_classes = [AllowAny]
        else:
            permission_classes = [IsSuperUser]
        return [permission() for permission in permission_classes]


@extend_schema(tags=['halls'])
class HallSeatListView(ListAPIView):
    serializer_class = SeatSerializer
    permission_classes = [IsSuperUser]

    def get_queryset(self):
        hall_id = self.kwargs['id']
        return Seat.objects.filter(hall_id=hall_id).order_by('row', 'number')






