from django.urls import path

from movies.views import (
    GenresListView,
    MovieCreateAPIView,
    MoviesDetailAPIView,
    MoviesListAPIView,
)

urlpatterns = [
    path('movies/', MoviesListAPIView.as_view()),
    path('movies/<int:id>', MoviesDetailAPIView.as_view()),
    path('movies/create', MovieCreateAPIView.as_view()),
    path('genres/', GenresListView.as_view()),
]