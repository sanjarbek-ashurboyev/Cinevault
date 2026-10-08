from drf_spectacular.utils import extend_schema
from rest_framework.generics import ListCreateAPIView, RetrieveAPIView
from rest_framework.permissions import IsAuthenticated

from permissions import IsOwnerOrAdmin, IsVerified
from reservations.models import Reservation
from reservations.serializers import ReservationCreateSerializer, ReservationSerializer


# Create your views here.
@extend_schema(tags=['reservations'])
class ReservationListCreateAPIView(ListCreateAPIView):
    def get_serializer_class(self):
        if self.request.method == 'POST':
            return ReservationCreateSerializer
        return ReservationSerializer

    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsVerified()]
        return [IsAuthenticated()]

    def get_queryset(self):
        return (
            Reservation.objects
            .filter(user=self.request.user)
            .select_related('showtime')
            .prefetch_related('seats__seat')
            .order_by('-created_at')
        )


@extend_schema(tags=['reservations'])
class ReservationDetailView(RetrieveAPIView):
    serializer_class = ReservationSerializer
    queryset = Reservation.objects.select_related('showtime').prefetch_related('seats__seat')
    lookup_url_kwarg = 'id'
    permission_classes = [IsOwnerOrAdmin]






