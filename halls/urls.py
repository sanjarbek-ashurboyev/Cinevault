from django.urls import path

from halls.views import HallSeatListView, HallsListAPIView

urlpatterns = [
    path('halls/', HallsListAPIView.as_view()),
    path('halls/<int:id>/seats', HallSeatListView.as_view()),
]