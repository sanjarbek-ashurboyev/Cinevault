from django.urls import path

from showtimes.views import ShowtimesListAPIView, ShowtimeDetailAPIView, ShowtimeSeatMapView

urlpatterns = [
    path('showtimes/', ShowtimesListAPIView.as_view()),
    path('showtimes/<int:id>', ShowtimeDetailAPIView.as_view()),
    path('showtimes/<int:pk>/seats/', ShowtimeSeatMapView.as_view()),
]