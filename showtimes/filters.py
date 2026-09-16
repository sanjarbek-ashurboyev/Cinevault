from django_filters import DateFilter
from django_filters.rest_framework import FilterSet

from showtimes.models import Showtime


class ShowtimeFilterset(FilterSet):
    start_time = DateFilter(field_name='start_time', lookup_expr='date')

    class Meta:
        model = Showtime
        fields = ['movie', 'hall', 'start_time']