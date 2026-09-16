from django.urls import path

from halls.views import HallsListAPIView, HallSeatListView

urlpatterns = [
    path('halls/', HallsListAPIView.as_view()),
    path('halls/<int:id>/seats', HallSeatListView.as_view()),
]