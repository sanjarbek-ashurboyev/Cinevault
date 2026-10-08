from django_filters import DateFilter, IsoDateTimeFilter
from django_filters.rest_framework import FilterSet

from showtimes.models import Showtime


class ShowtimeFilterset(FilterSet):
    start_time = DateFilter(field_name='start_time', lookup_expr='date')
    # Lets a listing skip screenings that have already begun instead of paging through them.
    start_after = IsoDateTimeFilter(field_name='start_time', lookup_expr='gte')

    class Meta:
        model = Showtime
        fields = ['movie', 'hall', 'start_time']
