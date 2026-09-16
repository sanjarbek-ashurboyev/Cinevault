from django.urls import path

from reservations.views import ReservationListCreateAPIView, ReservationDetailView

urlpatterns = [
    path('reservations/', ReservationListCreateAPIView.as_view()),
    path('reservations/<int:id>/', ReservationDetailView.as_view()),
]
