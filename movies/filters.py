from django_filters import CharFilter
from django_filters.rest_framework import FilterSet

from movies.models import Movie


class MovieModelFilterset(FilterSet):
    title = CharFilter(lookup_expr='icontains')
    class Meta:
        model = Movie
        fields = ['title', 'genres']