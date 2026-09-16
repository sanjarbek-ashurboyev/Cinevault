from django.urls import path
from rest_framework.views import APIView

from movies.views import MoviesListAPIView, MoviesDetailAPIView, MovieCreateAPIView, GenresListView

urlpatterns = [
    path('movies/', MoviesListAPIView.as_view()),
    path('movies/<int:id>', MoviesDetailAPIView.as_view()),
    path('movies/create', MovieCreateAPIView.as_view()),
    path('genres/', GenresListView.as_view()),
]